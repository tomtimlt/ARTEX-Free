import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Mock OpenCode server (session API)
let script = []; const seen = []; const deleted = []; let retryStatus = {}; let desktop = false;
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const json = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith('/api/model')) {
      return json(200, { location: {}, data: [
        { providerID: 'opencode', id: 'deepseek-v4.1-flash-free', cost: [{ input: 0, output: 0 }], capabilities: { tools: true }, status: 'active' },
        { providerID: 'opencode', id: 'big-pickle', cost: [{ input: 0, output: 0 }], capabilities: { tools: true }, status: 'active' },
        { providerID: 'opencode', id: 'paid-model', cost: [{ input: 1, output: 3 }], capabilities: { tools: true }, status: 'active' },
      ] });
    }
    if (req.url === '/experimental/tool/ids') return json(200, ['bash', 'edit', 'webfetch']);
    if (desktop && req.url === '/session') { res.statusCode = 405; return res.end(); }
    if (desktop && req.url === '/api/experimental/generate/text' && req.method === 'POST') {
      const body = JSON.parse(b); seen.push({ body });
      const step = script.shift() || { text: '{"type":"final","content":"default"}' };
      if (step.status) return json(step.status, step.body || {});
      return json(200, { data: { text: step.text } });
    }
    if (req.url === '/session' && req.method === 'POST') return json(200, { id: 'ses_' + (seen.length + 1) + '_' + Math.random().toString(36).slice(2, 6) });
    if (req.url === '/session/status') return json(200, retryStatus);
    if (/^\/session\/[^/]+\/abort$/.test(req.url)) return json(200, true);
    if (/^\/session\/[^/]+$/.test(req.url) && req.method === 'DELETE') { deleted.push(req.url.split('/')[2]); return json(200, true); }
    const m = /^\/session\/([^/]+)\/message$/.exec(req.url);
    if (m && req.method === 'POST') {
      const sid = m[1];
      const body = JSON.parse(b); seen.push({ body, sid });
      const step = script.shift() || { text: '{"type":"final","content":"default"}' };
      if (step.retry) { retryStatus = { [sid]: { type: 'retry', attempt: step.attempt ?? 1, message: step.retry, action: { reason: step.reason }, next: Date.now() + step.nextIn } }; return; } // hang like OpenCode
      if (step.status) return json(step.status, step.body || {});
      if (step.error) return json(200, { info: { role: 'assistant', error: step.error }, parts: [] });
      return json(200, { info: { role: 'assistant' }, parts: [{ type: 'step-start' }, { type: 'text', text: step.text }] });
    }
    json(404, {});
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
process.env.OPENCODE_URL = `http://127.0.0.1:${mock.address().port}`;
process.env.BRIDGE_STATUS_POLL_MS = '50';
process.env.BRIDGE_AGENT = 'bridge';
const B = await import('./bridge.mjs');
const server = B.createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); mock.close(); });
test.beforeEach(() => { B.resetState(); script = []; seen.length = 0; deleted.length = 0; retryStatus = {}; desktop = false; });

const tools = [{ type: 'function', function: { name: 'search_assets', description: 'search', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } } }];
const post = (body, headers = {}) => fetch(base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const req = (extra = {}) => ({ model: 'opencode/deepseek-v4.1-flash-free', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], tools, ...extra });

test('models: free + tool-capable only', async () => {
  const j = await (await fetch(base + '/v1/models')).json();
  assert.deepEqual(j.data.map(m => m.id), ['opencode/deepseek-v4.1-flash-free', 'opencode/big-pickle']);
});

test('tool call is mapped to OpenAI tool_calls', async () => {
  script = [{ text: '```json\n{"type":"tool_call","name":"search_assets","arguments":{"q":"x"}}\n```' }];
  const r = await post(req(), { 'x-opencode-session': 'S1' });
  const j = await r.json();
  assert.equal(r.status, 200);
  const c = j.choices[0];
  assert.equal(c.finish_reason, 'tool_calls'); assert.equal(c.message.content, null);
  assert.equal(c.message.tool_calls[0].function.name, 'search_assets');
  assert.deepEqual(JSON.parse(c.message.tool_calls[0].function.arguments), { q: 'x' });
  assert.ok(j.usage.total_tokens > 0);
  assert.deepEqual(seen[0].body.model, { providerID: 'opencode', modelID: 'deepseek-v4.1-flash-free' });
  assert.equal(seen[0].body.agent, 'bridge');
  // every OpenCode tool is switched off: ARTEX runs the tools, not OpenCode
  for (const id of ['bash', 'edit', 'webfetch', 'read', 'task']) assert.equal(seen[0].body.tools[id], false);
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(deleted, [seen[0].sid]);
});

test('final answer, prose around JSON tolerated', async () => {
  script = [{ text: 'Sure! {"type":"final","content":"done {ok}"} bye' }];
  const j = await (await post(req())).json();
  assert.equal(j.choices[0].finish_reason, 'stop'); assert.equal(j.choices[0].message.content, 'done {ok}');
});

test('tool result history is flattened', async () => {
  script = [{ text: '{"type":"final","content":"k"}' }];
  await post(req({ messages: [{ role: 'user', content: 'go' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_assets', arguments: '{"q":"a"}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'RESULT' }] }));
  const p = seen[0].body.parts[0].text;
  assert.match(p, /\[assistant tool_call id=call_1 name=search_assets\]/);
  assert.match(p, /\[tool result id=call_1 name=search_assets\]\nRESULT/);
});

test('invalid JSON -> one repair, then success', async () => {
  script = [{ text: 'not json' }, { text: '{"type":"final","content":"fixed"}' }];
  const j = await (await post(req())).json();
  assert.equal(j.choices[0].message.content, 'fixed'); assert.equal(seen.length, 2);
});

test('invalid twice -> 502', async () => {
  script = [{ text: 'nope' }, { text: '{"type":"tool_call","name":"ghost","arguments":{}}' }];
  assert.equal((await post(req())).status, 502);
});

test('missing required arg is rejected', async () => {
  script = [{ text: '{"type":"tool_call","name":"search_assets","arguments":{}}' }, { text: '{"type":"tool_call","name":"search_assets","arguments":{}}' }];
  assert.equal((await post(req())).status, 502);
});

test('stream:true -> 400', async () => {
  assert.equal((await post(req({ stream: true }))).status, 400);
});

test('free-tier retry status rotates to next model fast, reports real model', async () => {
  script = [{ retry: 'Free usage exceeded, subscribe to Go', reason: 'free_tier_limit', nextIn: 3600000 }, { text: '{"type":"final","content":"via pickle"}' }];
  const t0 = Date.now();
  const j = await (await post(req())).json();
  assert.ok(Date.now() - t0 < 2000, 'quota detected from /session/status, not after the timeout');
  assert.equal(j.model, 'opencode/big-pickle'); assert.equal(seen[1].body.model.modelID, 'big-pickle');
  // deepseek is now cooling down: next request goes straight to big-pickle
  script = [{ text: '{"type":"final","content":"again"}' }];
  await post(req()); assert.equal(seen.at(-1).body.model.modelID, 'big-pickle');
});

test('model error FreeUsageLimitError counts as quota', async () => {
  script = [{ error: { name: 'APIError', data: { message: 'Free usage limit reached. Free models work in OpenCode' } } }, { text: '{"type":"final","content":"ok"}' }];
  const j = await (await post(req())).json();
  assert.equal(j.model, 'opencode/big-pickle');
});

test('all exhausted, short retry -> 429 + Retry-After', async () => {
  script = [{ retry: 'Rate limited', reason: 'rate_limit', nextIn: 20000 }, { retry: 'Rate limited', reason: 'rate_limit', nextIn: 20000 }];
  const r = await post(req()); assert.equal(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) > 0);
});

test('all exhausted, long retry -> 402 quota exceeded', async () => {
  script = [{ retry: 'Free usage exceeded', reason: 'free_tier_limit', nextIn: 3 * 3600000 }, { status: 429, body: { retryAfterMs: 3 * 3600000 } }];
  const r = await post(req()); const j = await r.json();
  assert.equal(r.status, 402); assert.match(j.error.message, /quota exceeded/);
});

test('model OpenCode keeps retrying is skipped, next model answers', async () => {
  script = [{ retry: 'Upstream request failed: Model is unavailable.', reason: '', nextIn: 2000, attempt: 3 }, { text: '{"type":"final","content":"next"}' }];
  const r = await post(req()); const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.model, 'opencode/big-pickle');
  assert.equal(j.choices[0].message.content, 'next');
});

test('invalid Zen key -> 401 with a clear message', async () => {
  script = [{ error: { name: 'APIError', data: { message: 'Invalid credential' } } }];
  const r = await post(req()); const j = await r.json();
  assert.equal(r.status, 401); assert.match(j.error.message, /OPENCODE_ZEN_API_KEY/);
});

test('desktop app without session API falls back to generate/text', async () => {
  desktop = true;
  script = [{ text: '{"type":"tool_call","name":"search_assets","arguments":{"q":"y"}}' }];
  const j = await (await post(req())).json();
  assert.equal(j.choices[0].message.tool_calls[0].function.name, 'search_assets');
  assert.deepEqual(seen[0].body.model, { providerID: 'opencode', id: 'deepseek-v4.1-flash-free' });
  assert.match(seen[0].body.prompt, /\[user\]\nhi/);
  // remembered: next call goes straight to generate/text
  script = [{ status: 429, body: { retryAfterMs: 3600000 } }, { text: '{"type":"final","content":"ok"}' }];
  const k = await (await post(req())).json();
  assert.equal(k.model, 'opencode/big-pickle');
});

test('other model error -> 502', async () => {
  script = [{ error: { name: 'APIError', data: { message: 'context length exceeded' } } }];
  assert.equal((await post(req())).status, 502);
});

test('upstream 401 -> 401, 5xx -> 502', async () => {
  script = [{ status: 401 }]; assert.equal((await post(req())).status, 401);
  script = [{ status: 500 }]; assert.equal((await post(req())).status, 502);
});

test('no tools -> final only; unknown route 404', async () => {
  script = [{ text: '{"type":"final","content":"plain"}' }];
  const j = await (await post({ model: 'x', messages: [{ role: 'user', content: 'a' }] })).json();
  assert.equal(j.choices[0].message.content, 'plain');
  assert.equal((await fetch(base + '/nope')).status, 404);
});

test('extractJsonObject handles fences and braces in strings', () => {
  assert.deepEqual(B.extractJsonObject('```json\n{"a":"}{"}\n```'), { a: '}{' });
});
