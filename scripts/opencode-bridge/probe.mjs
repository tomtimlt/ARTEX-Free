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
