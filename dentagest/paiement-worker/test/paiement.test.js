import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => m.set(k, v), list: async () => ({ keys: [], list_complete: true }) }; };
const dec = (code) => JSON.parse(Buffer.from(code.split('.')[0], 'base64url').toString());
const iso = (d) => d.toISOString().slice(0, 10);

async function setup() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { LICENCES: kv(), LICENCE_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey)), STATS_KEY: 'stats-secret', pub: kp.publicKey };
}
const admin = (env, body, key = 'stats-secret') => worker.fetch(new Request('https://p.dev/admin/licence', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: JSON.stringify(body) }), env, {});

test('code Pro émis et signé', async () => {
  const env = await setup();
  assert.equal((await admin(env, { device: 'DG-AAAA-BBBB', plan: 'pm' }, 'faux')).status, 403);
  assert.equal((await admin(env, { device: 'DG-AAAA-BBBB', plan: 'zz' })).status, 400);
  const r = await (await admin(env, { device: 'DG-AAAA-BBBB', plan: 'pm' })).json();
  const p = dec(r.code);
  assert.equal(p.p, 'pm');
  assert.equal(p.d, 'DG-AAAA-BBBB');
  const [data, sig] = r.code.split('.');
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, env.pub, Buffer.from(sig, 'base64url'), new TextEncoder().encode(data)));
});

test('même formule : prolonge ; passage à Pro : commence aujourd’hui', async () => {
  const env = await setup();
  const a = dec((await (await admin(env, { device: 'DG-AAAA-BBBB', plan: 'y' })).json()).code);
  const b = dec((await (await admin(env, { device: 'DG-AAAA-BBBB', plan: 'm' })).json()).code);
  assert.ok(b.e > a.e, 'Standard + Standard : prolongé');
  const c = dec((await (await admin(env, { device: 'DG-AAAA-BBBB', plan: 'pm' })).json()).code);
  const in1m = new Date(); in1m.setUTCMonth(in1m.getUTCMonth() + 1);
  assert.ok(Math.abs(Date.parse(c.e) - Date.parse(iso(in1m))) <= 3 * 864e5, 'Pro démarre aujourd’hui : ' + c.e);
  const d = dec((await (await admin(env, { device: 'DG-AAAA-BBBB', plan: 'py' })).json()).code);
  assert.ok(d.e > c.e, 'Pro + Pro : prolongé');
});
