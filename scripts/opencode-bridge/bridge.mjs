#!/usr/bin/env node
// OpenCode -> OpenAI-compatible bridge (zero dependency, Node >= 18).
// Exposes GET /health, GET /v1/models, POST /v1/chat/completions on top of
// OpenCode's experimental POST /api/experimental/generate/text, emulating
// tool calling through a strict JSON protocol. See README.md.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const env = process.env;
export const CFG = {
  host: env.BRIDGE_HOST || '127.0.0.1',
  port: Number(env.BRIDGE_PORT || 8789),
  token: env.BRIDGE_TOKEN || '',
  upstream: (env.OPENCODE_URL || 'http://127.0.0.1:28894').replace(/\/+$/, ''),
  serviceJson: env.OPENCODE_SERVICE_JSON || path.join(os.homedir(), '.config', 'opencode', 'service.json'),
  timeoutMs: Number(env.BRIDGE_TIMEOUT_MS || 180000),
  concurrency: Number(env.BRIDGE_CONCURRENCY || 2),
  maxQueue: Number(env.BRIDGE_MAX_QUEUE || 8),
  providerID: env.BRIDGE_PROVIDER || 'opencode',
  toolDescMax: Number(env.BRIDGE_TOOL_DESC_MAX || 240),
  discoveryTtlMs: 5 * 60 * 1000,
  statusPollMs: Number(env.BRIDGE_STATUS_POLL_MS || 1000),
  maxUpstreamRetries: Number(env.BRIDGE_MAX_UPSTREAM_RETRIES || 2),
  unavailableCooldownMs: Number(env.BRIDGE_UNAVAILABLE_COOLDOWN_MS || 5 * 60 * 1000),
  agent: env.BRIDGE_AGENT || '',
};

export const FALLBACK_MODELS = [
  'deepseek-v4.1-flash-free',
  'mimo-v2.6-flash-free',
  'big-pickle',
  'nemotron-3.5-lightning-free',
  'flint-40b-free',
];

// ---------------------------------------------------------------- utilities
const log = (...a) => console.error(new Date().toISOString(), ...a); // never logs prompts

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

function openaiError(status, message, type = 'bridge_error') {
  return { error: { message, type, code: status } };
}

export function estimateTokens(s) { return Math.ceil((s || '').length / 4); }

function contentToText(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  return String(c);
}

// ------------------------------------------------------------ OpenCode auth
let authCache;
function upstreamAuth() {
  if (authCache !== undefined) return authCache;
  authCache = null;
  try {
    if (env.OPENCODE_USERNAME || env.OPENCODE_PASSWORD) {
      authCache = 'Basic ' + Buffer.from(`${env.OPENCODE_USERNAME || 'opencode'}:${env.OPENCODE_PASSWORD || ''}`).toString('base64');
    } else if (fs.existsSync(CFG.serviceJson)) {
      const j = JSON.parse(fs.readFileSync(CFG.serviceJson, 'utf8'));
      const pick = (o, ...k) => k.map(x => o?.[x]).find(v => typeof v === 'string' && v);
      const user = pick(j, 'username', 'user') ?? pick(j.auth, 'username', 'user') ?? 'opencode';
      const pass = pick(j, 'password', 'pass') ?? pick(j.auth, 'password', 'pass');
      const raw = pick(j, 'authorization', 'basic') ?? pick(j.auth, 'authorization', 'basic');
      if (raw) authCache = /^basic /i.test(raw) ? raw : 'Basic ' + raw;
      else if (pass) authCache = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    }
  } catch (e) { log('service.json unreadable:', e.message); }
  return authCache;
}

// -------------------------------------------------------- upstream plumbing
async function upstreamFetch(p, { method = 'GET', body, signal, session } = {}) {
  const headers = { accept: 'application/json' };
  const a = upstreamAuth(); if (a) headers.authorization = a;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (session) headers['x-opencode-session'] = session;
  return fetch(CFG.upstream + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
}

// --------------------------------------------------------- model discovery
let modelCache = { at: 0, ids: null };
export async function discoverModels(force = false) {
  if (!force && modelCache.ids && Date.now() - modelCache.at < CFG.discoveryTtlMs) return modelCache.ids;
  let ids = null;
  try {
    const r = await upstreamFetch('/api/model?types=chat', { signal: AbortSignal.timeout(5000) });
    if (r.ok && /json/.test(r.headers.get('content-type') || '')) {
      const j = await r.json();
      const list = Array.isArray(j) ? j : j.data || j.models || [];
      ids = list.filter(m => (m.providerID ?? m.provider) === CFG.providerID
        && Number((Array.isArray(m.cost) ? m.cost[0] : m.cost)?.output ?? 0) === 0
        && m.capabilities?.tools !== false
        && m.enabled !== false
        && (m.status == null || m.status === 'active'))
        .map(m => m.id).filter(Boolean);
      if (!ids.length) ids = null;
    }
  } catch (e) { log('model discovery failed, using fallback list:', e.message); }
  modelCache = { at: Date.now(), ids: ids || FALLBACK_MODELS };
  return modelCache.ids;
}

export function orderedModels(requested, discovered) {
  const bare = m => String(m || '').replace(/^opencode\//, '');
  const pref = FALLBACK_MODELS.filter(m => discovered.includes(m));
  const rest = discovered.filter(m => !pref.includes(m));
  const out = [];
  for (const m of [bare(requested), ...pref, ...rest]) if (m && !out.includes(m)) out.push(m);
  return out;
}

// ---------------------------------------------------- cooldowns / quotas
const cooldown = new Map(); // model -> epoch ms
const coolUntil = m => cooldown.get(m) || 0;
export function setCooldown(m, ms) { cooldown.set(m, Date.now() + Math.max(1000, ms)); }
export function resetState() { cooldown.clear(); authCache = undefined; modelCache = { at: 0, ids: null }; toolCache = { at: 0, ids: null }; }

function parseRetryAfterMs(res, bodyText) {
  const h = res.headers.get('retry-after');
  if (h && /^\d+$/.test(h)) return Number(h) * 1000;
  try {
    const j = JSON.parse(bodyText);
    const v = j.retryAfterMs ?? j.data?.retryAfterMs ?? j.error?.retryAfterMs;
    if (Number(v) > 0) return Number(v);
  } catch {}
  const m = /retry[^0-9]{0,20}(\d+)\s*(ms|s|sec|seconds|m|min|minutes|h|hours)?/i.exec(bodyText);
  if (m) {
    const n = Number(m[1]); const u = (m[2] || 's').toLowerCase();
    return n * (u === 'ms' ? 1 : u.startsWith('h') ? 3600e3 : u.startsWith('m') && u !== 'ms' ? 60e3 : 1000);
  }
  return null;
}
const isQuota = (res, text) => res.status === 429 || res.status === 402 || /quota|rate.?limit|too many requests/i.test(text);

// ----------------------------------------------------------- concurrency
let active = 0; const waiters = [];
async function acquire(signal) {
  if (active < CFG.concurrency) { active++; return; }
  if (waiters.length >= CFG.maxQueue) throw new HttpError(429, 'bridge queue full', { retryAfter: 5 });
  await new Promise((resolve, reject) => {
    const w = { resolve, reject };
    waiters.push(w);
    signal?.addEventListener('abort', () => {
      const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new HttpError(499, 'client closed request')); }
    }, { once: true });
  });
}
function release() { const w = waiters.shift(); if (w) w.resolve(); else active--; }

// ------------------------------------------------- request -> prompt (B)
export function buildPrompt(messages, tools) {
  const parts = [];
  const hasTools = Array.isArray(tools) && tools.length > 0;
  parts.push([
    'You are the language model behind an automated agent. You have no direct access to tools: the host executes them for you.',
    'Reply with EXACTLY ONE JSON object and nothing else (no markdown, no code fences, no commentary).',
    hasTools
      ? 'Protocol:\n- To call a tool: {"type":"tool_call","name":"<tool name>","arguments":{...}}\n- To give the final answer: {"type":"final","content":"<text>"}\nRules: call at most ONE tool per turn; "name" must be one of the available tools; "arguments" must be a JSON object that satisfies the tool\'s parameter schema. After a tool result is shown, either call another tool or give the final answer.'
      : 'Protocol:\n- {"type":"final","content":"<text>"}\nNo tools are available: always give a final answer.',
  ].join('\n'));
  if (hasTools) {
    const cat = tools.map(t => {
      const f = t.function || t;
      const d = String(f.description || '');
      return { name: f.name, description: d.length > CFG.toolDescMax ? d.slice(0, CFG.toolDescMax) + '…' : d, parameters: f.parameters || { type: 'object', properties: {} } };
    });
    parts.push('Available tools (JSON):\n' + JSON.stringify(cat));
  }
  parts.push('--- Conversation ---');
  const idToName = new Map();
  for (const m of messages || []) {
    const role = m.role;
    if (role === 'system' || role === 'developer') parts.push(`[system]\n${contentToText(m.content)}`);
    else if (role === 'user') parts.push(`[user]\n${contentToText(m.content)}`);
    else if (role === 'assistant') {
      const txt = contentToText(m.content);
      if (txt) parts.push(`[assistant]\n${txt}`);
      for (const tc of m.tool_calls || []) {
        idToName.set(tc.id, tc.function?.name);
        parts.push(`[assistant tool_call id=${tc.id} name=${tc.function?.name}]\n${tc.function?.arguments || '{}'}`);
      }
    } else if (role === 'tool') {
      parts.push(`[tool result id=${m.tool_call_id}${idToName.get(m.tool_call_id) ? ' name=' + idToName.get(m.tool_call_id) : ''}]\n${contentToText(m.content)}`);
    }
  }
  parts.push('--- End of conversation ---\nNow reply with the single JSON object.');
  return parts.join('\n\n');
}

// ------------------------------------------------- response -> OpenAI (B)
export function extractJsonObject(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  for (let start = s.indexOf('{'); start >= 0; start = s.indexOf('{', start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return null;
}

// Returns {ok:true, kind:'tool_call'|'final', ...} or {ok:false, reason}
export function interpret(text, tools) {
  const obj = extractJsonObject(text);
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'no JSON object found in the reply' };
  const hasTools = Array.isArray(tools) && tools.length > 0;
  if (obj.type === 'final' || (obj.type == null && typeof obj.content === 'string' && !obj.name)) {
    if (typeof obj.content !== 'string') return { ok: false, reason: '"final" requires a string "content"' };
    return { ok: true, kind: 'final', content: obj.content };
  }
  if (obj.type === 'tool_call' || obj.name) {
    if (!hasTools) return { ok: false, reason: 'no tools are available; reply with {"type":"final","content":"..."}' };
    const tool = tools.map(t => t.function || t).find(f => f.name === obj.name);
    if (!tool) return { ok: false, reason: `unknown tool "${obj.name}"; valid names: ${tools.map(t => (t.function || t).name).join(', ')}` };
    let args = obj.arguments ?? {};
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { return { ok: false, reason: '"arguments" is not valid JSON' }; } }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, reason: '"arguments" must be a JSON object' };
    const req = tool.parameters?.required || [];
    const missing = req.filter(k => !(k in args));
    if (missing.length) return { ok: false, reason: `missing required argument(s) for ${tool.name}: ${missing.join(', ')}` };
    return { ok: true, kind: 'tool_call', name: tool.name, arguments: args };
  }
  return { ok: false, reason: 'unknown "type"; expected "tool_call" or "final"' };
}

// ----------------------------------------------------- calling OpenCode
// OpenCode's own tools (bash, edit, webfetch…) are switched off on every call:
// the model must only describe tool calls, ARTEX executes them.
const FALLBACK_TOOL_IDS = ['invalid', 'question', 'bash', 'read', 'glob', 'grep', 'edit', 'write', 'task', 'webfetch', 'todowrite', 'websearch', 'skill', 'apply_patch'];
let toolCache = { at: 0, ids: null };
async function openCodeToolIds() {
  if (toolCache.ids && Date.now() - toolCache.at < CFG.discoveryTtlMs) return toolCache.ids;
  let ids = FALLBACK_TOOL_IDS;
  try {
    const r = await upstreamFetch('/experimental/tool/ids', { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j) && j.length) ids = [...new Set([...j, ...FALLBACK_TOOL_IDS])];
    }
  } catch {}
  toolCache = { at: Date.now(), ids };
  return ids;
}

const FREE_LIMIT = /free usage|free_tier_limit|freeusagelimit|quota|rate.?limit|too many requests|\b429\b/i;

// OpenCode retries a refused model call on its own (forever, for the free-tier
// limit) and only reports it in /session/status. Watch that status so a quota
// refusal comes back in about a second instead of after the bridge timeout.
async function watchRetry(sid, signal) {
  while (!signal.aborted) {
    await new Promise((r) => setTimeout(r, CFG.statusPollMs));
    if (signal.aborted) break;
    try {
      const r = await upstreamFetch('/session/status', { signal });
      if (!r.ok) continue;
      const st = (await r.json())?.[sid];
      if (st?.type !== 'retry') continue;
      const reason = `${st.action?.reason ?? ''} ${st.message ?? ''}`;
      if (FREE_LIMIT.test(reason)) {
        const next = Number(st.next);
        const ms = Number.isFinite(next) && next > Date.now() ? next - Date.now() : 15 * 60 * 1000;
        throw new HttpError(429, `quota exceeded: ${st.message || st.action?.reason}`, { quota: true, retryAfterMs: ms });
      }
      if (Number(st.attempt) >= CFG.maxUpstreamRetries) throw new HttpError(502, `OpenCode keeps retrying: ${st.message ?? 'unknown error'}`, { skip: true });
    } catch (e) {
      if (e instanceof HttpError) throw e;
    }
  }
  return new Promise(() => {}); // aborted: never settles, the race is already decided
}

async function readUpstream(res, what) {
  const text = await res.text();
  if (!res.ok) {
    if (FREE_LIMIT.test(text) || res.status === 429 || res.status === 402) {
      throw new HttpError(429, `quota exceeded (${what})`, { quota: true, retryAfterMs: parseRetryAfterMs(res, text) ?? 15 * 60 * 1000 });
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(401, 'OpenCode rejected the bridge credentials (check OPENCODE_PASSWORD)');
    if (res.status === 404) throw new HttpError(404, `OpenCode endpoint not found (${what})`);
    if (res.status === 400 || res.status === 422) throw new HttpError(400, `OpenCode rejected the request (${what}, ${res.status})`);
    throw new HttpError(502, `OpenCode error ${res.status} (${what})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, `OpenCode returned a non-JSON body (${what}); is OPENCODE_URL the OpenCode server?`);
  }
}

// One throwaway OpenCode session per request: ARTEX already sends the whole
// conversation, so nothing may accumulate on the OpenCode side.
async function generateText(model, prompt, _session, signal) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new HttpError(504, 'upstream timeout')), CFG.timeoutMs);
  const onAbort = () => ctl.abort(new HttpError(499, 'client closed request'));
  signal?.addEventListener('abort', onAbort, { once: true });
  const aborted = new Promise((_, reject) => ctl.signal.addEventListener('abort', () => reject(ctl.signal.reason), { once: true }));
  aborted.catch(() => {});
  let sid;
  try {
    let created;
    try {
      created = await readUpstream(await upstreamFetch('/session', { method: 'POST', body: { title: 'artex-bridge' }, signal: ctl.signal }), 'create session');
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (ctl.signal.aborted && ctl.signal.reason instanceof HttpError) throw ctl.signal.reason;
      throw new HttpError(502, `OpenCode unreachable: ${e.message}`);
    }
    sid = created?.id;
    if (!sid) throw new HttpError(502, 'OpenCode did not return a session id');
    const tools = Object.fromEntries((await openCodeToolIds()).map((id) => [id, false]));
    const body = { model: { providerID: CFG.providerID, modelID: model }, tools, parts: [{ type: 'text', text: prompt }] };
    if (CFG.agent) body.agent = CFG.agent;
    const send = upstreamFetch(`/session/${sid}/message`, { method: 'POST', body, signal: ctl.signal })
      .then((res) => readUpstream(res, 'message'), (e) => {
        if (ctl.signal.aborted && ctl.signal.reason instanceof HttpError) throw ctl.signal.reason;
        throw new HttpError(502, `OpenCode unreachable: ${e.message}`);
      });
    send.catch(() => {});
    const out = await Promise.race([send, watchRetry(sid, ctl.signal), aborted]);
    const err = out?.info?.error;
    if (err) {
      const msg = `${err.name ?? ''} ${err.data?.message ?? err.message ?? ''}`.trim();
      if (FREE_LIMIT.test(msg)) throw new HttpError(429, `quota exceeded: ${msg}`, { quota: true, retryAfterMs: 15 * 60 * 1000 });
      throw new HttpError(502, `OpenCode model error: ${msg || 'unknown'}`);
    }
    const text = (out?.parts ?? []).filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('');
    if (!text) throw new HttpError(502, 'OpenCode returned no text');
    return text;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (!ctl.signal.aborted) ctl.abort(new HttpError(499, 'done'));
    if (sid) {
      const quiet = { signal: AbortSignal.timeout(5000) };
      upstreamFetch(`/session/${sid}/abort`, { method: 'POST', body: {}, ...quiet })
        .catch(() => {})
        .finally(() => upstreamFetch(`/session/${sid}`, { method: 'DELETE', ...quiet }).catch(() => {}));
    }
  }
}

// --------------------------------------------------------- orchestration
export async function chatCompletion(body, { session, signal } = {}) {
  if (body.stream === true) throw new HttpError(400, 'stream:true is not supported by this bridge; set streaming=false in the ARTEX profile');
  if (!Array.isArray(body.messages) || !body.messages.length) throw new HttpError(400, 'messages is required');
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const prompt = buildPrompt(body.messages, tools);
  session = session || 'bridge-' + crypto.randomUUID();

  await acquire(signal);
  try {
    const order = orderedModels(body.model, await discoverModels());
    let lastQuota = null;
    let lastSkip = null;
    for (const model of order) {
      if (coolUntil(model) > Date.now()) continue;
      let reply;
      try {
        reply = await generateText(model, prompt, session, signal);
      } catch (e) {
        if (e.quota) { setCooldown(model, e.retryAfterMs); lastQuota = e; log(`model ${model} in cooldown for ${Math.round(e.retryAfterMs / 1000)}s`); continue; }
        // A model OpenCode cannot reach right now: park it briefly, try the next one.
        if (e.skip) { setCooldown(model, CFG.unavailableCooldownMs); lastSkip = e; log(`model ${model} unavailable, skipped: ${e.message}`); continue; }
        throw e;
      }
      let r = interpret(reply, tools);
      let completionText = reply;
      if (!r.ok) { // one repair attempt on the same model
        const repair = prompt + `\n\n[your previous reply was invalid: ${r.reason}]\nReply again with EXACTLY ONE valid JSON object, nothing else.`;
        try { completionText = await generateText(model, repair, session, signal); }
        catch (e) {
          if (e.quota) { setCooldown(model, e.retryAfterMs); lastQuota = e; continue; }
          if (e.skip) { setCooldown(model, CFG.unavailableCooldownMs); lastSkip = e; continue; }
          throw e;
        }
        r = interpret(completionText, tools);
        if (!r.ok) throw new HttpError(502, `model ${model} did not produce a valid reply: ${r.reason}`);
      }
      log(`served by ${model} (${r.kind}${r.name ? ':' + r.name : ''})`);
      return toOpenAI(r, model, prompt, completionText);
    }
    // everything exhausted / cooling down
    const wait = Math.min(...order.map(coolUntil).filter(t => t > Date.now()).concat(lastQuota ? [Date.now() + lastQuota.retryAfterMs] : [Infinity])) - Date.now();
    if (!isFinite(wait)) throw new HttpError(502, lastSkip ? `no model available: ${lastSkip.message}` : 'no model available');
    if (wait < 60000) throw new HttpError(429, 'all OpenCode free models are rate limited', { retryAfter: Math.ceil(wait / 1000) });
    throw new HttpError(402, `quota exceeded on all OpenCode free models${lastSkip ? ' (some are unavailable)' : ''}; next one usable around ${new Date(Date.now() + wait).toISOString()}`, { retryAfter: Math.ceil(wait / 1000) });
  } finally { release(); }
}

function toOpenAI(r, model, prompt, completionText) {
  const pt = estimateTokens(prompt), ct = estimateTokens(completionText);
  const message = r.kind === 'tool_call'
    ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_' + crypto.randomBytes(8).toString('hex'), type: 'function', function: { name: r.name, arguments: JSON.stringify(r.arguments) } }] }
    : { role: 'assistant', content: r.content };
  return {
    id: 'chatcmpl-' + crypto.randomBytes(8).toString('hex'), object: 'chat.completion',
    created: Math.floor(Date.now() / 1000), model: `${CFG.providerID}/${model}`,
    choices: [{ index: 0, message, finish_reason: r.kind === 'tool_call' ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct },
  };
}

// ------------------------------------------------------------ HTTP server
async function readBody(req, limit = 8 * 1024 * 1024) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new HttpError(413, 'body too large'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid JSON body'); }
}

function send(res, status, obj, headers = {}) {
  if (res.headersSent) return;
  const b = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b), ...headers });
  res.end(b);
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
    try {
      const url = new URL(req.url, 'http://x');
      if (CFG.token && url.pathname !== '/health') {
        const a = req.headers.authorization || '';
        const ok = a.length === ('Bearer ' + CFG.token).length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from('Bearer ' + CFG.token));
        if (!ok) throw new HttpError(401, 'invalid bridge token');
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        let upstream = 'down';
        try {
          const r = await upstreamFetch('/api/model?types=chat', { signal: AbortSignal.timeout(3000) });
          upstream = !r.ok ? `http_${r.status}` : /json/.test(r.headers.get('content-type') || '') ? 'ok' : 'not_opencode_api';
        } catch {}
        return send(res, 200, { status: 'ok', upstream, active, queued: waiters.length });
      }
      if (req.method === 'GET' && url.pathname === '/v1/models') {
        const ids = await discoverModels();
        return send(res, 200, { object: 'list', data: ids.map(id => ({ id: `${CFG.providerID}/${id}`, object: 'model', created: 0, owned_by: CFG.providerID })) });
      }
      if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const body = await readBody(req);
        const out = await chatCompletion(body, { session: req.headers['x-opencode-session'], signal: ctl.signal });
        return send(res, 200, out);
      }
      throw new HttpError(404, `no route for ${req.method} ${url.pathname}`);
    } catch (e) {
      if (e.status === 499) return res.destroy();
      const status = e instanceof HttpError ? e.status : 500;
      if (!(e instanceof HttpError)) log('internal error:', e.stack || e);
      send(res, status, openaiError(status, e instanceof HttpError ? e.message : 'internal bridge error'),
        e.retryAfter ? { 'retry-after': String(e.retryAfter) } : {});
    }
  });
}

export function isLoopback(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('bridge.mjs')) {
  // Listening beyond loopback (e.g. 0.0.0.0 so a Docker container can reach it)
  // without a token would hand your OpenCode account to anyone on the network.
  if (!isLoopback(CFG.host) && !CFG.token) {
    console.error(`refusing to listen on ${CFG.host} without BRIDGE_TOKEN; set BRIDGE_TOKEN or use BRIDGE_HOST=127.0.0.1`);
    process.exit(1);
  }
  createServer().listen(CFG.port, CFG.host, () => log(`opencode-bridge listening on http://${CFG.host}:${CFG.port} -> ${CFG.upstream}`));
}
