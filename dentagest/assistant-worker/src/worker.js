/* DentaGest DZ — Assistante IA WhatsApp (formule Pro)

   Application DentaGest (en-tête X-DG-Licence : code d'activation Pro de l'appareil)
     POST /api/sync              {profile, busy, enabled} -> enregistre la fiche et les créneaux occupés
     GET  /api/requests          -> demandes créées par l'assistante, pas encore récupérées
     POST /api/requests/ack      {ids} -> marque les demandes comme récupérées

   WhatsApp Cloud API (Meta)
     GET  /webhook               vérification (hub.challenge)
     POST /webhook               messages entrants (signature X-Hub-Signature-256)

   Administration (Authorization: Bearer ADMIN_KEY)
     GET  /admin/cabinets        liste des cabinets Pro
     POST /admin/connect         {device, wa_phone_id, wa_display} -> relie un numéro WhatsApp à un cabinet
     POST /admin/disconnect      {device}

   Secrets : ANTHROPIC_API_KEY, WA_TOKEN, WA_APP_SECRET, WA_VERIFY_TOKEN, ADMIN_KEY
   Variables : CLAUDE_MODEL (défaut claude-opus-5-5), CLAUDE_EFFORT (défaut low), WA_GRAPH_VERSION, APP_ORIGIN
   Base D1 : DB (schema.sql) */
import { verifyLicence, isPro, DEV, LIC_PUB } from './licence.js';
import { nowLocal, isDate, toMin, waToLocal } from './slots.js';
import { reply, userPrefix } from './agent.js';
import { incoming, validSignature, sendText, markRead } from './whatsapp.js';

const SESSION_GAP = 12 * 3600e3; // une nouvelle conversation commence après 12 h de silence
const MAX_HISTORY = 80; // au-delà, on repart d'une conversation neuve
const LOCK_MS = 120e3;

const cors = (env) => ({
  'Access-Control-Allow-Origin': env.APP_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-DG-Licence',
  'Access-Control-Max-Age': '86400',
});
const json = (env, o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(env) } });
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function safeEq(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (!a || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Licence Pro valide de l'appareil qui appelle, sinon null */
async function proLicence(env, req) {
  const pub = env.LIC_PUB_JWK ? JSON.parse(env.LIC_PUB_JWK) : LIC_PUB;
  const lic = await verifyLicence(req.headers.get('X-DG-Licence'), pub);
  if (!lic || !isPro(lic.p) || lic.e < nowLocal().date) return null;
  return lic;
}

/* ---------- Nettoyage de ce que l'application envoie ---------- */
const str = (v, n) => String(v ?? '').slice(0, n).trim();
function cleanProfile(p = {}) {
  const horaires = {};
  for (let wd = 0; wd < 7; wd++) {
    const h = Array.isArray(p.horaires?.[wd]) ? p.horaires[wd] : [];
    horaires[wd] = h.filter((r) => Array.isArray(r) && toMin(r[0]) >= 0 && toMin(r[1]) > toMin(r[0])).slice(0, 4).map((r) => [str(r[0], 5), str(r[1], 5)]);
  }
  return {
    cabinet: str(p.cabinet, 120), praticien: str(p.praticien, 120), specialite: str(p.specialite, 80),
    adresse: str(p.adresse, 200), ville: str(p.ville, 80), tel: str(p.tel, 40), urgence: str(p.urgence, 40),
    soins: str(p.soins, 4000), infos: str(p.infos, 2000),
    creneau: Math.max(10, Math.min(120, Number(p.creneau) || 30)),
    delai_min: Math.max(0, Math.min(72, Number(p.delai_min ?? 2))),
    jours_max: Math.max(1, Math.min(90, Number(p.jours_max) || 30)),
    conges: (Array.isArray(p.conges) ? p.conges : []).filter((c) => Array.isArray(c) && isDate(c[0])).slice(0, 20).map((c) => [c[0], isDate(c[1]) ? c[1] : c[0]]),
    horaires,
  };
}
function cleanBusy(b) {
  const today = nowLocal().date;
  return (Array.isArray(b) ? b : [])
    .filter((x) => x && isDate(x.d) && x.d >= today && toMin(x.h) >= 0)
    .slice(0, 3000)
    .map((x) => ({ d: x.d, h: str(x.h, 5), m: Math.max(5, Math.min(480, Number(x.m) || 30)) }));
}

/* ---------- Accès aux données d'un cabinet pour l'assistante ---------- */
function storeFor(env, cab, waUser) {
  return {
    async busy() {
      const today = nowLocal().date;
      const { results } = await env.DB.prepare(
        "SELECT date, heure, duree FROM requests WHERE device=? AND kind='rdv' AND date>=? AND (pulled_at IS NULL OR pulled_at > ?)"
      ).bind(cab.device, today, cab.synced_at || 0).all();
      return JSON.parse(cab.busy || '[]').concat(results.map((r) => ({ d: r.date, h: r.heure, m: r.duree })));
    },
    async addRequest(r) {
      await env.DB.prepare('INSERT INTO requests (id, device, kind, nom, tel, wa_user, date, heure, duree, motif, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(newId(), cab.device, r.kind, r.nom || null, r.tel || null, waUser, r.date || null, r.heure || null, r.duree || null, r.motif || null, r.note || null, Date.now())
        .run();
    },
  };
}

/* ---------- Traitement des messages d'un patient (un seul à la fois par conversation) ---------- */
async function lock(env, device, waUser) {
  const now = Date.now();
  await env.DB.prepare('INSERT OR IGNORE INTO conversations (device, wa_user, messages, lock_until, updated_at) VALUES (?,?,?,0,?)').bind(device, waUser, '[]', now).run();
  const r = await env.DB.prepare('UPDATE conversations SET lock_until=? WHERE device=? AND wa_user=? AND lock_until<?').bind(now + LOCK_MS, device, waUser, now).run();
  return r.meta.changes > 0;
}

export async function processUser(env, device, waUser, deps = {}) {
  for (let round = 0; round < 5; round++) {
    if (!(await lock(env, device, waUser))) return; // un autre traitement est en cours : il lira aussi ces messages
    try {
      for (;;) {
        const { results: pending } = await env.DB.prepare('SELECT wa_msg_id, body, name, at FROM inbox WHERE device=? AND wa_user=? AND done=0 ORDER BY at').bind(device, waUser).all();
        if (!pending.length) break;
        const cab = await env.DB.prepare('SELECT * FROM cabinets WHERE device=?').bind(device).first();
        const conv = await env.DB.prepare('SELECT messages, updated_at FROM conversations WHERE device=? AND wa_user=?').bind(device, waUser).first();
        let messages = JSON.parse(conv?.messages || '[]');
        if (Date.now() - (conv?.updated_at || 0) > SESSION_GAP || messages.length > MAX_HISTORY) messages = [];
        const profile = JSON.parse(cab.profile || '{}');
        const userText = userPrefix(waUser, pending[pending.length - 1].name) + '\n' + pending.map((m) => m.body).join('\n');
        let text = '';
        try {
          const r = await reply({ env, profile, messages, userText, waUser, store: storeFor(env, cab, waUser), client: deps.client });
          text = r.text;
        } catch (e) {
          console.error('claude', e && e.message);
        }
        if (!text) text = 'Désolé, l’assistante est momentanément indisponible. Merci d’appeler le cabinet' + (profile.tel ? ' au ' + profile.tel : '') + '.\nعذرًا، المساعدة غير متاحة حاليًا. يرجى الاتصال بالعيادة' + (profile.tel ? ' على ' + profile.tel : '') + '.';
        try {
          await (deps.send || sendText)(env, cab.wa_phone_id, waUser, text);
        } catch (e) {
          console.error('whatsapp', e && e.message);
        }
        const ids = pending.map((m) => m.wa_msg_id);
        await env.DB.batch([
          env.DB.prepare('UPDATE conversations SET messages=?, updated_at=?, lock_until=? WHERE device=? AND wa_user=?').bind(JSON.stringify(messages), Date.now(), Date.now() + LOCK_MS, device, waUser),
          env.DB.prepare('UPDATE inbox SET done=1 WHERE wa_msg_id IN (' + ids.map(() => '?').join(',') + ')').bind(...ids),
        ]);
      }
    } finally {
      await env.DB.prepare('UPDATE conversations SET lock_until=0 WHERE device=? AND wa_user=?').bind(device, waUser).run();
    }
    // un message a pu arriver juste avant la libération du verrou
    const more = await env.DB.prepare('SELECT 1 FROM inbox WHERE device=? AND wa_user=? AND done=0 LIMIT 1').bind(device, waUser).first();
    if (!more) return;
  }
}

async function handleWebhook(env, req, ctx, deps) {
  const raw = await req.text();
  if (!(await validSignature(env.WA_APP_SECRET, raw, req.headers.get('X-Hub-Signature-256')))) return new Response('bad signature', { status: 403 });
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response('ok');
  }
  const today = nowLocal().date;
  const todo = new Map();
  for (const m of incoming(payload)) {
    const cab = await env.DB.prepare('SELECT device, enabled, lic_end FROM cabinets WHERE wa_phone_id=?').bind(m.phoneId).first();
    if (!cab || !cab.enabled || cab.lic_end < today) continue; // assistante coupée ou formule Pro expirée : le dentiste répond lui-même
    const r = await env.DB.prepare('INSERT OR IGNORE INTO inbox (wa_msg_id, device, wa_user, name, body, at) VALUES (?,?,?,?,?,?)').bind(m.id, cab.device, m.from, m.name, m.body, m.at).run();
    if (!r.meta.changes) continue; // déjà reçu (Meta renvoie parfois le même webhook)
    ctx.waitUntil((deps.markRead || markRead)(env, m.phoneId, m.id));
    todo.set(cab.device + '|' + m.from, [cab.device, m.from]);
  }
  for (const [device, from] of todo.values()) ctx.waitUntil(processUser(env, device, from, deps).catch((e) => console.error('process', e && e.message)));
  return new Response('ok');
}

/* ---------- API de l'application ---------- */
async function handleApi(env, req, path) {
  const lic = await proLicence(env, req);
  if (!lic) return json(env, { error: 'Formule Pro requise ou expirée' }, 403);
  const device = lic.d;

  if (path === '/api/sync' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const profile = JSON.stringify(cleanProfile(b.profile));
    const busy = JSON.stringify(cleanBusy(b.busy));
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO cabinets (device, lic_end, profile, busy, enabled, synced_at, created_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(device) DO UPDATE SET lic_end=excluded.lic_end, profile=excluded.profile, busy=excluded.busy, enabled=excluded.enabled, synced_at=excluded.synced_at`
    ).bind(device, lic.e, profile, busy, b.enabled ? 1 : 0, now, now).run();
    const cab = await env.DB.prepare('SELECT wa_phone_id, wa_display FROM cabinets WHERE device=?').bind(device).first();
    return json(env, { ok: true, whatsapp: cab.wa_phone_id ? { connected: true, numero: cab.wa_display || '' } : { connected: false }, lic_end: lic.e });
  }
  if (path === '/api/requests' && req.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, kind, nom, tel, wa_user, date, heure, duree, motif, note, created_at FROM requests WHERE device=? AND pulled_at IS NULL ORDER BY created_at LIMIT 200').bind(device).all();
    return json(env, { requests: results.map((r) => ({ ...r, tel: r.tel || waToLocal(r.wa_user) })) });
  }
  if (path === '/api/requests/ack' && req.method === 'POST') {
    const { ids } = await req.json().catch(() => ({}));
    const list = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string').slice(0, 200);
    if (list.length) await env.DB.prepare('UPDATE requests SET pulled_at=? WHERE device=? AND id IN (' + list.map(() => '?').join(',') + ')').bind(Date.now(), device, ...list).run();
    return json(env, { ok: true });
  }
  return json(env, { error: 'not found' }, 404);
}

async function handleAdmin(env, req, path) {
  const auth = req.headers.get('Authorization') || '';
  if (!env.ADMIN_KEY || !safeEq(auth.replace(/^Bearer\s+/, ''), env.ADMIN_KEY)) return json(env, { error: 'forbidden' }, 403);
  if (path === '/admin/cabinets') {
    const { results } = await env.DB.prepare('SELECT device, lic_end, enabled, wa_phone_id, wa_display, synced_at, json_extract(profile, "$.cabinet") AS cabinet, json_extract(profile, "$.ville") AS ville FROM cabinets ORDER BY created_at DESC').all();
    return json(env, { cabinets: results });
  }
  const b = await req.json().catch(() => ({}));
  if (!DEV.test(b.device || '')) return json(env, { error: 'device invalide' }, 400);
  if (path === '/admin/connect' && req.method === 'POST') {
    if (!/^\d{6,20}$/.test(String(b.wa_phone_id || ''))) return json(env, { error: 'wa_phone_id invalide' }, 400);
    const r = await env.DB.prepare('UPDATE cabinets SET wa_phone_id=?, wa_display=? WHERE device=?').bind(String(b.wa_phone_id), str(b.wa_display, 40), b.device).run();
    return r.meta.changes ? json(env, { ok: true }) : json(env, { error: 'cabinet inconnu : il doit d’abord activer l’assistante dans l’application' }, 404);
  }
  if (path === '/admin/disconnect' && req.method === 'POST') {
    await env.DB.prepare('UPDATE cabinets SET wa_phone_id=NULL, wa_display=NULL WHERE device=?').bind(b.device).run();
    return json(env, { ok: true });
  }
  return json(env, { error: 'not found' }, 404);
}

export function makeWorker(deps = {}) {
  return {
    async fetch(req, env, ctx) {
      const url = new URL(req.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
      try {
        if (path === '/webhook' && req.method === 'GET') {
          const ok = url.searchParams.get('hub.mode') === 'subscribe' && safeEq(url.searchParams.get('hub.verify_token'), env.WA_VERIFY_TOKEN);
          return ok ? new Response(url.searchParams.get('hub.challenge') || '') : new Response('forbidden', { status: 403 });
        }
        if (path === '/webhook' && req.method === 'POST') return await handleWebhook(env, req, ctx, deps);
        if (path.startsWith('/api/')) return await handleApi(env, req, path);
        if (path.startsWith('/admin/')) return await handleAdmin(env, req, path);
        return json(env, { service: 'DentaGest DZ assistante', ok: true });
      } catch (e) {
        console.error(e && e.stack);
        return json(env, { error: 'Erreur serveur' }, 500);
      }
    },
    // Nettoyage quotidien : on ne garde pas les conversations des patients plus longtemps que nécessaire
    async scheduled(_ev, env) {
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM inbox WHERE done=1 AND at<?').bind(now - 7 * 864e5),
        env.DB.prepare('DELETE FROM conversations WHERE updated_at<?').bind(now - 30 * 864e5),
        env.DB.prepare('DELETE FROM requests WHERE pulled_at IS NOT NULL AND pulled_at<?').bind(now - 30 * 864e5),
      ]);
    },
  };
}

export default makeWorker();
