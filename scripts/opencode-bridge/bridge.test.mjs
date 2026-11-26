import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Mock OpenCode upstream
let script = []; const seen = [];
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    if (req.url.startsWith('/api/model')) {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify([
        { providerID: 'opencode', id: 'deepseek-v4.1-flash-free', cost: { output: 0 }, capabilities: { tools: true }, enabled: true, status: 'active' },
        { providerID: 'opencode', id: 'big-pickle', cost: { output: 0 }, capabilities: { tools: true }, enabled: true, status: 'active' },
        { providerID: 'opencode', id: 'paid-model', cost: { output: 3 }, capabilities: { tools: true }, enabled: true, status: 'active' },
      ]));
    }
    const body = JSON.parse(b); seen.push({ body, session: req.headers['x-opencode-session'] });
    const step = script.shift() || { status: 200, text: '{"type":"final","content":"default"}' };
    res.statusCode = step.status;
    res.setHeader('content-type', 'application/json');
    res.end(step.status === 200 ? JSON.stringify({ data: { text: step.text } }) : JSON.stringify(step.body || {}));
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
process.env.OPENCODE_URL = `http://127.0.0.1:${mock.address().port}`;
const B = await import('./bridge.mjs');
const server = B.createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); mock.close(); });
test.beforeEach(() => { B.resetState(); script = []; seen.length = 0; });

const tools = [{ type: 'function', function: { name: 'search_assets', description: 'search', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } } }];
const post = (body, headers = {}) => fetch(base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const req = (extra = {}) => ({ model: 'opencode/deepseek-v4.1-flash-free', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], tools, ...extra });

test('models: free + tool-capable only', async () => {
  const j = await (await fetch(base + '/v1/models')).json();
  assert.deepEqual(j.data.map(m => m.id), ['opencode/deepseek-v4.1-flash-free', 'opencode/big-pickle']);
});

test('tool call is mapped to OpenAI tool_calls', async () => {
  script = [{ status: 200, text: '```json\n{"type":"tool_call","name":"search_assets","arguments":{"q":"x"}}\n```' }];
  const r = await post(req(), { 'x-opencode-session': 'S1' });
  const j = await r.json();
  assert.equal(r.status, 200);
  const c = j.choices[0];
  assert.equal(c.finish_reason, 'tool_calls'); assert.equal(c.message.content, null);
  assert.equal(c.message.tool_calls[0].function.name, 'search_assets');
  assert.deepEqual(JSON.parse(c.message.tool_calls[0].function.arguments), { q: 'x' });
  assert.ok(j.usage.total_tokens > 0);
  assert.equal(seen[0].session, 'S1');
  assert.deepEqual(seen[0].body.model, { providerID: 'opencode', id: 'deepseek-v4.1-flash-free' });
});

test('final answer, prose around JSON tolerated', async () => {
  script = [{ status: 200, text: 'Sure! {"type":"final","content":"done {ok}"} bye' }];
  const j = await (await post(req())).json();
  assert.equal(j.choices[0].finish_reason, 'stop'); assert.equal(j.choices[0].message.content, 'done {ok}');
});

test('tool result history is flattened', async () => {
  script = [{ status: 200, text: '{"type":"final","content":"k"}' }];
  await post(req({ messages: [{ role: 'user', content: 'go' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_assets', arguments: '{"q":"a"}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'RESULT' }] }));
  const p = seen[0].body.prompt;
  assert.match(p, /\[assistant tool_call id=call_1 name=search_assets\]/);
  assert.match(p, /\[tool result id=call_1 name=search_assets\]\nRESULT/);
});

test('invalid JSON -> one repair, then success', async () => {
  script = [{ status: 200, text: 'not json' }, { status: 200, text: '{"type":"final","content":"fixed"}' }];
  const j = await (await post(req())).json();
  assert.equal(j.choices[0].message.content, 'fixed'); assert.equal(seen.length, 2);
});

test('invalid twice -> 502', async () => {
  script = [{ status: 200, text: 'nope' }, { status: 200, text: '{"type":"tool_call","name":"ghost","arguments":{}}' }];
  assert.equal((await post(req())).status, 502);
});

test('missing required arg is rejected', async () => {
  script = [{ status: 200, text: '{"type":"tool_call","name":"search_assets","arguments":{}}' }, { status: 200, text: '{"type":"tool_call","name":"search_assets","arguments":{}}' }];
  assert.equal((await post(req())).status, 502);
});

test('stream:true -> 400', async () => {
  assert.equal((await post(req({ stream: true }))).status, 400);
});

test('quota on first model rotates to next, reports real model', async () => {
  script = [{ status: 429, body: { retryAfterMs: 3600000 } }, { status: 200, text: '{"type":"final","content":"via pickle"}' }];
  const j = await (await post(req())).json();
  assert.equal(j.model, 'opencode/big-pickle'); assert.equal(seen[1].body.model.id, 'big-pickle');
  // deepseek is now cooling down: next request goes straight to big-pickle
  script = [{ status: 200, text: '{"type":"final","content":"again"}' }];
  await post(req()); assert.equal(seen.at(-1).body.model.id, 'big-pickle');
});

test('all exhausted, short retry -> 429 + Retry-After', async () => {
  script = [{ status: 429, body: { retryAfterMs: 20000 } }, { status: 429, body: { retryAfterMs: 20000 } }];
  const r = await post(req()); assert.equal(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) > 0);
});

test('all exhausted, long retry -> 402 quota exceeded', async () => {
  script = [{ status: 429, body: { retryAfterMs: 3 * 3600000 } }, { status: 429, body: { retryAfterMs: 3 * 3600000 } }];
  const r = await post(req()); const j = await r.json();
  assert.equal(r.status, 402); assert.match(j.error.message, /quota exceeded/);
});

test('upstream 401 -> 401, 5xx -> 502', async () => {
  script = [{ status: 401 }]; assert.equal((await post(req())).status, 401);
  script = [{ status: 500 }]; assert.equal((await post(req())).status, 502);
});

test('no tools -> final only; unknown route 404', async () => {
  script = [{ status: 200, text: '{"type":"final","content":"plain"}' }];
  const j = await (await post({ model: 'x', messages: [{ role: 'user', content: 'a' }] })).json();
  assert.equal(j.choices[0].message.content, 'plain');
  assert.equal((await fetch(base + '/nope')).status, 404);
});

test('extractJsonObject handles fences and braces in strings', () => {
  assert.deepEqual(B.extractJsonObject('```json\n{"a":"}{"}\n```'), { a: '}{' });
});
