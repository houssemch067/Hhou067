import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker } from '../src/worker.js';
import { nowLocal, addDays, weekday } from '../src/slots.js';
import { makeDB, makeKeys, fakeClaude, say, use, waPayload, waSig, makeCtx, PROFILE } from './helpers.js';

const DEVICE = 'DG-ABCD-EF23';
const PHONE_ID = '1234567890';
const PATIENT = '213555987654';
let keys, env, sent, worker, claude;

const today = nowLocal().date;
const inDays = (n) => addDays(today, n);
// prochain mardi (ouvert 09:00-12:00) à au moins 2 jours
let mardi = inDays(2);
while (weekday(mardi) !== 2) mardi = addDays(mardi, 1);

function setup(steps) {
  sent = [];
  claude = fakeClaude(steps);
  worker = makeWorker({ client: claude, send: async (_e, phoneId, to, text) => sent.push({ phoneId, to, text }), markRead: async () => {} });
}
const api = async (path, { licence, body, method } = {}) => {
  const res = await worker.fetch(new Request('https://x.dev' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'X-DG-Licence': licence || '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, makeCtx());
  return { status: res.status, body: await res.json() };
};
async function wa(text, id, { secret = 'appsecret', from = PATIENT } = {}) {
  const raw = JSON.stringify(waPayload(PHONE_ID, from, id, text));
  const ctx = makeCtx();
  const res = await worker.fetch(new Request('https://x.dev/webhook', { method: 'POST', headers: { 'X-Hub-Signature-256': waSig(secret, raw) }, body: raw }), env, ctx);
  await ctx.done();
  if (claude.errors.length) throw claude.errors[0];
  return res.status;
}

let PRO, STD, OLD;
before(async () => {
  keys = await makeKeys();
  env = { DB: makeDB(), LIC_PUB_JWK: JSON.stringify(keys.pub), WA_APP_SECRET: 'appsecret', WA_VERIFY_TOKEN: 'verif', ADMIN_KEY: 'admin', WA_TOKEN: 'x', ANTHROPIC_API_KEY: 'x' };
  PRO = await keys.sign({ d: DEVICE, e: inDays(30), p: 'pm', i: today });
  STD = await keys.sign({ d: DEVICE, e: inDays(30), p: 'm', i: today });
  OLD = await keys.sign({ d: DEVICE, e: inDays(-1), p: 'py', i: inDays(-366) });
  setup([]);
});

test('API réservée à la formule Pro valide', async () => {
  assert.equal((await api('/api/requests')).status, 403);
  assert.equal((await api('/api/requests', { licence: STD })).status, 403);
  assert.equal((await api('/api/requests', { licence: OLD })).status, 403);
  assert.equal((await api('/api/requests', { licence: PRO.slice(0, -4) + 'AAAA' })).status, 403);
  assert.equal((await api('/api/requests', { licence: PRO })).status, 200);
});

test('synchronisation de la fiche et de l’agenda, puis liaison WhatsApp par l’admin', async () => {
  const r = await api('/api/sync', { licence: PRO, body: { enabled: true, profile: { ...PROFILE, intrus: 'x' }, busy: [{ d: mardi, h: '09:00', m: 30, nom: 'NE DOIT PAS ÊTRE STOCKÉ' }] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.whatsapp.connected, false);
  const row = await env.DB.prepare('SELECT * FROM cabinets WHERE device=?').bind(DEVICE).first();
  assert.ok(!row.busy.includes('NE DOIT PAS'), 'pas de nom de patient sur le serveur');
  assert.ok(!row.profile.includes('intrus'));

  const noAuth = await worker.fetch(new Request('https://x.dev/admin/connect', { method: 'POST', body: JSON.stringify({ device: DEVICE, wa_phone_id: PHONE_ID }) }), env, makeCtx());
  assert.equal(noAuth.status, 403);
  const ok = await worker.fetch(new Request('https://x.dev/admin/connect', { method: 'POST', headers: { Authorization: 'Bearer admin' }, body: JSON.stringify({ device: DEVICE, wa_phone_id: PHONE_ID, wa_display: '+213 555 12 34 56' }) }), env, makeCtx());
  assert.equal(ok.status, 200);
  assert.deepEqual((await api('/api/sync', { licence: PRO, body: { enabled: true, profile: PROFILE, busy: [{ d: mardi, h: '09:00', m: 30 }] } })).body.whatsapp, { connected: true, numero: '+213 555 12 34 56' });
});

test('vérification du webhook Meta', async () => {
  const ok = await worker.fetch(new Request('https://x.dev/webhook?hub.mode=subscribe&hub.verify_token=verif&hub.challenge=42'), env, makeCtx());
  assert.equal(await ok.text(), '42');
  const ko = await worker.fetch(new Request('https://x.dev/webhook?hub.mode=subscribe&hub.verify_token=faux&hub.challenge=42'), env, makeCtx());
  assert.equal(ko.status, 403);
  assert.equal(await wa('salam', 'w0', { secret: 'mauvais' }), 403);
});

test('conversation : créneaux puis réservation qui arrive dans l’agenda', async () => {
  let toolResult;
  setup([
    use('chercher_creneaux', { du: mardi, au: mardi }, 'tu1'),
    (p) => {
      toolResult = JSON.parse(p.messages.at(-1).content[0].content);
      return say('Salam ! Je suis l’assistante virtuelle du Cabinet El Amel. Mardi : 09:30 ou 10:00 ?');
    },
  ]);
  assert.equal(await wa('salam bghit rendez-vous mardi', 'w1'), 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /assistante virtuelle/);
  assert.equal(sent[0].to, PATIENT);
  assert.ok(!toolResult.creneaux.some((c) => c.heure === '09:00'), '09:00 est déjà pris dans l’agenda');
  assert.equal(toolResult.creneaux[0].heure, '09:30');
  // le message du patient est précédé de la date et de son numéro
  const first = claude.calls[0];
  assert.match(first.messages[0].content, /WhatsApp du patient : 0555987654/);
  assert.equal(first.model, 'claude-opus-5-5');
  assert.equal(first.fallbacks, 'default');

  // même message renvoyé par Meta : ignoré
  assert.equal(await wa('salam bghit rendez-vous mardi', 'w1'), 200);
  assert.equal(sent.length, 1);

  // réservation : l'historique précédent est renvoyé tel quel (y compris les blocs de réflexion)
  setup([
    (p) => {
      assert.equal(p.messages.length, 5, 'user, assistant(tool), user(result), assistant, user');
      assert.equal(p.messages[1].content[1].type, 'tool_use');
      return use('reserver_rendez_vous', { nom: 'Karim Haddad', date: mardi, heure: '09:30', motif: 'Douleur' }, 'tu2');
    },
    (p) => {
      assert.equal(JSON.parse(p.messages.at(-1).content[0].content).ok, true);
      return say('C’est noté *mardi à 09:30*.');
    },
  ]);
  await wa('9h30 svp, Karim Haddad', 'w2');
  assert.match(sent[0].text, /09:30/);

  // le créneau n'est plus proposé
  setup([use('reserver_rendez_vous', { nom: 'Autre Patient', date: mardi, heure: '09:30', motif: 'Contrôle' }), (p) => {
    const r = JSON.parse(p.messages.at(-1).content[0].content);
    assert.equal(r.ok, false);
    assert.match(r.raison, /déjà pris/);
    return say('Ce créneau vient d’être pris.');
  }]);
  await wa('je veux mardi 9h30', 'w3', { from: '213661111111' });

  // l'application récupère la demande
  const reqs = (await api('/api/requests', { licence: PRO })).body.requests;
  assert.equal(reqs.length, 1);
  assert.deepEqual({ kind: reqs[0].kind, nom: reqs[0].nom, tel: reqs[0].tel, date: reqs[0].date, heure: reqs[0].heure, duree: reqs[0].duree }, { kind: 'rdv', nom: 'Karim Haddad', tel: '0555987654', date: mardi, heure: '09:30', duree: 30 });
  await api('/api/requests/ack', { licence: PRO, body: { ids: [reqs[0].id] } });
  assert.equal((await api('/api/requests', { licence: PRO })).body.requests.length, 0);
});

test('message urgent transmis au dentiste', async () => {
  setup([use('transmettre_message', { type: 'urgence', nom: 'Amina', message: 'Joue gonflée depuis hier, douleur forte' }), say('Le dentiste est prévenu. En cas d’urgence : 0661 00 00 00.')]);
  await wa('khedi m3amra w waj3etni bzaf', 'w4', { from: '213770000000' });
  const reqs = (await api('/api/requests', { licence: PRO })).body.requests;
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].kind, 'urgence');
  assert.equal(reqs[0].tel, '0770000000');
});

test('si Claude est indisponible, le patient reçoit le numéro du cabinet', async () => {
  setup([new Error('503')]);
  await wa('bonjour', 'w5', { from: '213550000001' });
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /0555 12 34 56/);
});

test('messages envoyés pendant une réponse : traités ensemble ensuite', async () => {
  const from = '213550000002';
  await env.DB.prepare('INSERT INTO conversations (device, wa_user, messages, lock_until, updated_at) VALUES (?,?,?,?,?)').bind(DEVICE, from, '[]', Date.now() + 60e3, Date.now()).run();
  setup([say('réponse groupée')]);
  await wa('salam', 'w6', { from });
  await wa('bghit nchouf tbib', 'w7', { from });
  assert.equal(sent.length, 0, 'conversation verrouillée : rien envoyé');
  await env.DB.prepare('UPDATE conversations SET lock_until=0 WHERE wa_user=?').bind(from).run();
  await wa('wach kayen rdv?', 'w8', { from });
  assert.equal(sent.length, 1);
  assert.match(claude.calls[0].messages[0].content, /salam\nbghit nchouf tbib\nwach kayen rdv\?/);
});

test('assistante désactivée ou formule expirée : aucune réponse', async () => {
  await api('/api/sync', { licence: PRO, body: { enabled: false, profile: PROFILE, busy: [] } });
  setup([say('ne doit pas être envoyé')]);
  await wa('allo', 'w9', { from: '213550000003' });
  assert.equal(sent.length, 0);
  await api('/api/sync', { licence: PRO, body: { enabled: true, profile: PROFILE, busy: [] } });
  await env.DB.prepare('UPDATE cabinets SET lic_end=? WHERE device=?').bind(inDays(-1), DEVICE).run();
  await wa('allo', 'w10', { from: '213550000003' });
  assert.equal(sent.length, 0);
});
