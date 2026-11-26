// Lists the session API of the OpenCode server the bridge points at
// (OPENCODE_URL, with the bridge's credentials). Prints routes and field names
// only, never credentials. Run inside the bridge container:
//   Get-Content scripts\opencode-bridge\probe.mjs | docker compose exec -T opencode-bridge node --input-type=module -
const base = (process.env.OPENCODE_URL || 'http://127.0.0.1:4096').replace(/\/+$/, '');
const auth = process.env.OPENCODE_PASSWORD
  ? { authorization: 'Basic ' + Buffer.from(`${process.env.OPENCODE_USERNAME || 'opencode'}:${process.env.OPENCODE_PASSWORD}`).toString('base64') }
  : {};
const get = async (p) => {
  try {
    const r = await fetch(base + p, { headers: auth });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, json: ct.includes('json') ? await r.json() : null };
  } catch (e) {
    return { status: 'ERR ' + (e.cause?.code || e.message), json: null };
  }
};
for (const p of ['/global/health', '/api/health']) {
  const h = await get(p);
  console.log(`health ${p}: ${h.status} ${h.json ? JSON.stringify(h.json).slice(0, 120) : ''}`);
}
let doc = null;
for (const p of ['/doc', '/api/doc', '/openapi.json', '/api/openapi.json']) {
  const d = await get(p);
  if (d.json?.paths) { doc = d.json; console.log(`openapi at ${p}`); break; }
  console.log(`no openapi at ${p} (${d.status})`);
}
if (!doc) process.exit(0);
const refName = (x) => (x?.$ref ? x.$ref.split('/').pop() : null);
const resolve = (x) => (x?.$ref ? doc.components?.schemas?.[refName(x)] : x);
for (const [path, ops] of Object.entries(doc.paths)) {
  if (!/session|prompt|message/i.test(path)) continue;
  console.log(`${Object.keys(ops).join(',').toUpperCase().padEnd(16)} ${path}`);
  const post = ops.post;
  if (post && /message|prompt/i.test(path)) {
    const schema = resolve(post.requestBody?.content?.['application/json']?.schema);
    if (schema?.properties) console.log(`    body: ${Object.keys(schema.properties).join(', ')}  required: ${(schema.required || []).join(', ')}`);
  }
}

// Detailed request/response shapes for the routes the bridge needs.
const want = [
  ['post', '/api/session'],
  ['post', '/api/session/{sessionID}/model'],
  ['post', '/api/session/{sessionID}/agent'],
  ['post', '/api/session/{sessionID}/prompt'],
  ['post', '/api/session/{sessionID}/generate'],
  ['post', '/api/experimental/session/{sessionID}/wait'],
  ['get', '/api/session/{sessionID}/message'],
  ['get', '/api/session/{sessionID}/permission'],
  ['post', '/api/session/{sessionID}/permission/{requestID}/reply'],
  ['post', '/api/session/{sessionID}/interrupt'],
  ['get', '/api/session/active'],
];
const seenRefs = new Set();
function shape(x, depth = 0) {
  if (!x || depth > 4) return '…';
  if (x.$ref) {
    const n = refName(x);
    if (seenRefs.has(n) && depth > 0) return n;
    seenRefs.add(n);
    return `${n}=${shape(resolve(x), depth + 1)}`;
  }
  if (x.enum) return `enum(${x.enum.join('|')})`;
  if (x.const !== undefined) return JSON.stringify(x.const);
  for (const k of ['anyOf', 'oneOf', 'allOf']) if (x[k]) return `${k}[${x[k].map((y) => shape(y, depth + 1)).join(' ; ')}]`;
  if (x.type === 'array') return `[${shape(x.items, depth + 1)}]`;
  if (x.properties) {
    const req = new Set(x.required || []);
    return `{${Object.entries(x.properties).map(([k, v]) => `${k}${req.has(k) ? '' : '?'}:${shape(v, depth + 1)}`).join(', ')}}`;
  }
  return x.type || '?';
}
console.log('\n--- details ---');
for (const [m, p] of want) {
  const op = doc.paths[p]?.[m];
  if (!op) { console.log(`${m.toUpperCase()} ${p}: absent`); continue; }
  seenRefs.clear();
  const body = op.requestBody?.content?.['application/json']?.schema;
  const okResp = op.responses?.['200'] ?? op.responses?.['201'] ?? op.responses?.['204'];
  const out = okResp?.content?.['application/json']?.schema;
  console.log(`\n${m.toUpperCase()} ${p}${op.summary ? '  — ' + op.summary : ''}`);
  if (op.parameters?.length) console.log(`  params: ${op.parameters.map((x) => `${x.name}(${x.in})`).join(', ')}`);
  if (body) console.log(`  body: ${shape(body).slice(0, 1500)}`);
  if (out) console.log(`  200: ${shape(out).slice(0, 1500)}`);
  else if (okResp) console.log(`  ${Object.keys(op.responses).join(',')}: ${okResp.description ?? ''}`);
}
