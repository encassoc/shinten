// A fictional shop's order form encrypts in the browser; the shop's server keeps
// the postal code and the ciphertext; the shipping desk decrypts and writes the
// carrier's label file, then deletes it; every step is a record in a hash chain
// that two witnesses cosign. All real: shinten for encryption, shinten-ship for
// the desk, deedlog's dlog for checkpoints and witnesses.
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKey, thumbprint } from 'shinten';
import { makeLabels, carrier, decodeCsv, parseCsv } from 'shinten-ship';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8800);
const DLOG = process.env.DLOG ?? 'dlog';
const STATE = process.env.STATE ?? join(here, 'state');
const ORIGIN = 'shop.harukaze.example/forms';
const sha = (s) => createHash('sha256').update(s).digest('hex');

let S; // state
const witnesses = [];

async function setup() {
  await run(DLOG, ['help']).catch((e) => {
    if (e.code === 'ENOENT') { console.error(`dlog not found (${DLOG}). Build it from deedlog and set DLOG; see README.md.`); process.exit(1); }
  });
  const st = STATE;
  await rm(st, { recursive: true, force: true });
  await mkdir(st, { recursive: true });
  const desk = await generateKey();
  const backup = await generateKey();
  const thief = await generateKey();
  for (const [p, name, w] of [['operator', ORIGIN, false], ['wa', 'witness-a.example', true], ['wb', 'witness-b.example', true]]) {
    await run(DLOG, ['keygen', ...(w ? ['-witness'] : []), '-name', name, '-out', join(st, p)]);
  }
  for (const w of witnesses.splice(0)) w.proc.kill();
  for (const [p, port, label] of [['wa', 8811, '監査法人A（架空）'], ['wb', 8812, '消費者団体B（架空）']]) {
    const proc = spawn(DLOG, ['witness', '-key', join(st, `${p}.key`), '-log', join(st, 'operator.vkey'), '-state', join(st, `${p}.state`), '-listen', `127.0.0.1:${port}`], { stdio: 'ignore' });
    witnesses.push({ proc, p, port, label });
  }
  S = { st, desk, backup, thief, approved: [desk.publicJwk, backup.publicJwk], served: [desk.publicJwk, backup.publicJwk], orders: [], seq: 0, prev: undefined, events: [], labels: null, n: 0 };
  await new Promise((r) => setTimeout(r, 400));
}

// A deedlog record per event: the subject is the digest of the event body, which holds no personal data.
async function record(event, meta) {
  const body = JSON.stringify({ event, ...meta, at: new Date().toISOString() });
  const rec = {
    spec: 'deedlog/v0.1', chain: ORIGIN, seq: S.seq, ...(S.prev ? { prev: S.prev } : {}),
    collected_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: { type: 'web-form', id: 'shop.harukaze.example', collector: 'shinten-web-shop' },
    subject: { media_type: 'application/json', size: Buffer.byteLength(body), digest: { sha256: sha(body) } },
    meta: Object.fromEntries(Object.entries({ event, ...meta }).map(([k, v]) => [k, String(v)])),
  };
  const line = JSON.stringify(rec);
  await appendFile(join(S.st, 'chain.jsonl'), line + '\n');
  S.events.push({ seq: S.seq, event, ...meta, at: rec.collected_at, digest: sha(line) });
  S.seq++;
  S.prev = 'sha256:' + sha(line);
}

const json = (res, status, v) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)); };
const body = async (req) => { const c = []; for await (const x of req) c.push(x); return JSON.parse(Buffer.concat(c).toString('utf8') || '{}'); };
const files = { '/': 'app.html', '/title': 'title.html', '/logo.png': 'logo.png', '/shinten.browser.js': 'node_modules/shinten/dist/shinten.browser.js' };
const types = { html: 'text/html; charset=utf-8', png: 'image/png', js: 'text/javascript; charset=utf-8' };

const config = { sender: { name: 'はるかぜ雑貨店', postalCode: '1000001', address: '東京都千代田区千代田1-1', building: 'サンプルビル3F', phone: '03-0000-0000' }, yamato: { customerCode: '123456789', fareCode: '01' } };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (files[p]) {
      const f = files[p];
      res.writeHead(200, { 'content-type': types[f.split('.').pop()], 'cache-control': 'no-store' });
      return res.end(await readFile(join(here, f)));
    }
    if (p === '/.well-known/shinten.json') return json(res, 200, { keys: S.served });
    if (p === '/api/reset' && req.method === 'POST') { await setup(); return json(res, 200, { ok: true }); }
    if (p === '/api/orders' && req.method === 'POST') {
      const b = await body(req);
      const id = `H-${String(++S.n).padStart(4, '0')}`;
      const o = { id, at: new Date().toISOString(), postalCode: b.postalCode, item: b.item, count: Number(b.count) || 1, envelope: b.envelope, shipped: false };
      S.orders.push(o);
      await record('received', { order: id, envelope: sha(JSON.stringify(b.envelope)) });
      return json(res, 201, { id });
    }
    if (p === '/api/orders') return json(res, 200, { orders: S.orders.map((o) => ({ ...o, cipher: o.envelope.ciphertext })) });
    if (p === '/api/dump') return json(res, 200, { table: 'orders', rows: S.orders.map(({ id, at, postalCode, item, count, envelope }) => ({ id, at, postal_code: postalCode, item, count, delivery_encrypted: envelope })) });
    if (p === '/api/keys') return json(res, 200, { approved: await Promise.all(S.approved.map(thumbprint)), served: await Promise.all(S.served.map(thumbprint)) });
    if (p === '/api/hijack' && req.method === 'POST') { S.served = [S.desk.publicJwk, S.backup.publicJwk, S.thief.publicJwk]; return json(res, 200, { ok: true }); }
    if (p === '/api/labels' && req.method === 'POST') {
      const todo = S.orders.filter((o) => !o.shipped);
      const orders = todo.map((o) => ({ id: o.id, postalCode: o.postalCode, envelope: o.envelope, item: o.item, count: o.count }));
      const r = await makeLabels({ orders, carrier: carrier('yamato-b2'), config: { ...config, recipients: S.approved }, key: S.desk.privateJwk });
      if (r.alarm) {
        const bad = r.problems.map((x) => x.order);
        await record('stopped', { orders: bad.join(','), reason: 'sealed to an unapproved key' });
        return json(res, 200, { alarm: true, orders: bad });
      }
      const file = join(S.st, 'labels-yamato-b2.csv');
      await writeFile(file, r.file, { mode: 0o600 });
      const rows = parseCsv(decodeCsv(r.file)).slice(1).map((c) => ({ id: c[0], phone: c[8], postal: c[10], address: c[11], name: c[15] }));
      for (const o of todo) { o.shipped = true; await record('decrypted', { order: o.id, file: r.digest }); }
      S.labels = { file, digest: r.digest, count: rows.length };
      return json(res, 200, { rows, file: 'labels-yamato-b2.csv', bytes: r.file.length, digest: r.digest });
    }
    if (p === '/api/purge' && req.method === 'POST') {
      if (!S.labels) return json(res, 200, { ok: false });
      await rm(S.labels.file, { force: true });
      await record('purged', { file: S.labels.digest, orders: S.labels.count });
      S.labels = null;
      return json(res, 200, { ok: true });
    }
    if (p === '/api/trail') return json(res, 200, { events: S.events });
    if (p === '/api/verify' && req.method === 'POST') {
      const chain = join(S.st, 'chain.jsonl');
      const cp = join(S.st, 'checkpoint');
      const { stdout } = await run(DLOG, ['checkpoint', '-key', join(S.st, 'operator.key'), chain]);
      await writeFile(cp, stdout);
      const ws = witnesses.flatMap((w) => ['-witness', `${join(S.st, `${w.p}.vkey`)}=http://127.0.0.1:${w.port}`]);
      await run(DLOG, ['cosign', '-key', join(S.st, 'operator.vkey'), ...ws, '-quorum', '2', '-out', cp + '.cosigned', chain, cp]);
      const v = await run(DLOG, ['verify', '-checkpoint', cp + '.cosigned', '-key', join(S.st, 'operator.vkey'), ...witnesses.flatMap((w) => ['-witness', join(S.st, `${w.p}.vkey`)]), '-quorum', '2', chain]);
      const out = JSON.parse(v.stdout);
      return json(res, 200, { ok: true, count: out.count, head: out.head, witnesses: witnesses.map((w) => w.label), at: new Date().toISOString() });
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
}).listen(PORT, async () => { await setup(); console.log(`demo on http://127.0.0.1:${PORT}`); });
process.on('exit', () => witnesses.forEach((w) => w.proc.kill()));
process.on('SIGTERM', () => process.exit(0));
