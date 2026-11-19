// DentaGest DZ : application + API de synchronisation chiffrée du cabinet
import APP from "../build/index.html";
import GUIDE from "./installer-android.html";
import FILES from "../build/assets.js";
import { WA_ROUTES, WaError, webhook } from "./assistant.js";

const TYPES = { woff2: "font/woff2", png: "image/png", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", webmanifest: "application/manifest+json" };
const PAGES = { "/": APP, "/index.html": APP, "/installer-android": GUIDE, "/installer-android.html": GUIDE };

/* Collections synchronisées et droit nécessaire pour les lire / écrire.
   f = caisse et devis, o = ordonnances, certificats, modèles, médicaments, p = paramètres (écriture). */
const COLS = { patients: "", rdv: "", ordos: "o", certifs: "o", modeles: "o", meds: "o", paiements: "f", devis: "f", config: "" };
const PERMS = /^[fop]*$/;
const LOGIN = /^[a-z0-9][a-z0-9._-]{2,39}$/;
const B64 = /^[A-Za-z0-9_-]{16,200}$/;
const MAX_REC = 1_500_000;
const PAGE = 200;

const enc = new TextEncoder();
const NOSTORE = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: NOSTORE });
const fail = (status, error, extra) => json({ error, ...extra }, status);
class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
const bad = (msg = "Demande invalide") => { throw new HttpError(400, msg); };

const b64u = (buf) => {
  let s = ""; const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const rnd = (n = 16) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hmac(secret, s) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(s)));
}
function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const pepper = (env) => env.PEPPER || "dentagest-dev-pepper";
const authHash = (env, auth) => sha(pepper(env) + ":" + auth);
const str = (v, max = 4000) => (typeof v === "string" && v.length <= max ? v : bad());
const b64f = (v) => (typeof v === "string" && B64.test(v) ? v : bad());
const wrappedF = (v) => (typeof v === "string" && /^[A-Za-z0-9_-]{40,400}$/.test(v) ? v : bad());
const loginF = (v) => { const l = String(v || "").trim().toLowerCase(); if (!LOGIN.test(l)) bad("Identifiant invalide : 3 à 40 caractères, lettres, chiffres, point, tiret."); return l; };
const deviceF = (v) => String(v || "Appareil").slice(0, 80);
const can = (u, col, write) => {
  if (!(col in COLS)) return false;
  if (u.role === "owner") return true;
  const need = col === "config" && write ? "p" : COLS[col];
  return !need || u.perms.includes(need);
};

async function newSession(env, user, device) {
  const token = rnd(32), now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (id, token_hash, user_id, cabinet_id, device, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)")
    .bind(crypto.randomUUID(), await sha(token), user.id, user.cabinet_id, deviceF(device), now).run();
  return token;
}
const me = (u) => ({ id: u.id, login: u.login, name: u.name_enc, role: u.role, perms: u.role === "owner" ? "fop" : u.perms, mustChange: !!u.must_change, cabinet: u.cabinet_id });

async function authed(req, env, ctx) {
  const h = req.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) throw new HttpError(401, "session");
  const row = await env.DB.prepare(
    "SELECT s.id AS sid, s.revoked, s.last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1"
  ).bind(await sha(h.slice(7).trim())).first();
  if (!row) throw new HttpError(401, "session");
  if (row.revoked || !row.active) throw new HttpError(401, "revoked");
  if (Date.now() - row.last_seen > 120_000)
    ctx.waitUntil(env.DB.prepare("UPDATE sessions SET last_seen = ?1 WHERE id = ?2").bind(Date.now(), row.sid).run());
  return row;
}
const ownerOnly = (u) => { if (u.role !== "owner") throw new HttpError(403, "Réservé au titulaire du cabinet"); };

/* ---------- Comptes ---------- */
async function register(env, b) {
  const login = loginF(b.login), now = Date.now();
  const cab = crypto.randomUUID(), uid = crypto.randomUUID();
  if (await env.DB.prepare("SELECT 1 FROM users WHERE login = ?1").bind(login).first()) bad("Cet identifiant est déjà utilisé, choisissez-en un autre.");
  const user = { id: uid, cabinet_id: cab, login, name_enc: str(b.name, 2000), role: "owner", perms: "fop", must_change: 0 };
  await env.DB.batch([
    env.DB.prepare("INSERT INTO cabinets (id, created_at, rec_salt, rec_auth, rec_wrapped) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(cab, now, b64f(b.rsalt), await authHash(env, b64f(b.rauth)), wrappedF(b.rwrapped)),
    env.DB.prepare("INSERT INTO users (id, cabinet_id, login, name_enc, role, perms, kdf_salt, auth_hash, wrapped, created_at) VALUES (?1, ?2, ?3, ?4, 'owner', 'fop', ?5, ?6, ?7, ?8)")
      .bind(uid, cab, login, user.name_enc, b64f(b.salt), await authHash(env, b64f(b.auth)), wrappedF(b.wrapped), now),
  ]);
  return { token: await newSession(env, user, b.device), me: me(user) };
}

async function fakeSalt(env, kind, login) { return b64u((await hmac(pepper(env), kind + ":" + login)).slice(0, 16)); }

async function prelogin(env, b) {
  const login = String(b.login || "").trim().toLowerCase();
  const u = LOGIN.test(login) ? await env.DB.prepare("SELECT kdf_salt FROM users WHERE login = ?1").bind(login).first() : null;
  return { salt: u ? u.kdf_salt : await fakeSalt(env, "k", login) };
}

async function checkLock(u) {
  if (u.locked_until > Date.now()) {
    const min = Math.ceil((u.locked_until - Date.now()) / 60000);
    throw new HttpError(429, "Trop d’essais. Réessayez dans " + min + " minute" + (min > 1 ? "s" : "") + ".");
  }
}
async function noteFail(env, u) {
  const f = u.fails + 1, lock = f >= 5 ? Date.now() + Math.min(60, 2 ** (f - 5)) * 60000 : 0;
  await env.DB.prepare("UPDATE users SET fails = ?1, locked_until = ?2 WHERE id = ?3").bind(f, lock, u.id).run();
}

async function login(env, b) {
  const l = String(b.login || "").trim().toLowerCase();
  const u = LOGIN.test(l) ? await env.DB.prepare("SELECT * FROM users WHERE login = ?1").bind(l).first() : null;
  const wrong = new HttpError(401, "Identifiant ou mot de passe incorrect");
  if (!u) throw wrong;
  await checkLock(u);
  if (!safeEq(await authHash(env, String(b.auth || "")), u.auth_hash)) { await noteFail(env, u); throw wrong; }
  if (!u.active) throw new HttpError(403, "Ce compte a été désactivé par le titulaire du cabinet.");
  if (u.fails) await env.DB.prepare("UPDATE users SET fails = 0, locked_until = 0 WHERE id = ?1").bind(u.id).run();
  return { token: await newSession(env, u, b.device), me: me(u), wrapped: u.wrapped };
}

async function changePassword(env, u, b) {
  if (!safeEq(await authHash(env, String(b.current || "")), u.auth_hash)) throw new HttpError(403, "Mot de passe actuel incorrect");
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET kdf_salt = ?1, auth_hash = ?2, wrapped = ?3, must_change = 0 WHERE id = ?4")
      .bind(b64f(b.salt), await authHash(env, b64f(b.auth)), wrappedF(b.wrapped), u.id),
    env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ?1 AND id != ?2").bind(u.id, u.sid),
  ]);
  return { ok: true };
}

/* Code de secours du titulaire : permet de retrouver l'accès sans perdre les données chiffrées */
async function ownerByLogin(env, login) {
  const l = String(login || "").trim().toLowerCase();
  if (!LOGIN.test(l)) return null;
  return env.DB.prepare("SELECT u.*, c.rec_salt, c.rec_auth, c.rec_wrapped FROM users u JOIN cabinets c ON c.id = u.cabinet_id WHERE u.login = ?1 AND u.role = 'owner'").bind(l).first();
}
async function recover(env, b, step) {
  const u = await ownerByLogin(env, b.login);
  if (step === "start") return { salt: u ? u.rec_salt : await fakeSalt(env, "r", String(b.login || "")) };
  const wrong = new HttpError(401, "Code de secours incorrect");
  if (!u) throw wrong;
  await checkLock(u);
  if (!safeEq(await authHash(env, String(b.rauth || "")), u.rec_auth)) { await noteFail(env, u); throw wrong; }
  if (step === "key") return { rwrapped: u.rec_wrapped };
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET kdf_salt = ?1, auth_hash = ?2, wrapped = ?3, must_change = 0, fails = 0, locked_until = 0, active = 1 WHERE id = ?4")
      .bind(b64f(b.salt), await authHash(env, b64f(b.auth)), wrappedF(b.wrapped), u.id),
    env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ?1").bind(u.id),
  ]);
  return { token: await newSession(env, u, b.device), me: me(u) };
}
async function setRecovery(env, u, b) {
  ownerOnly(u);
  if (!safeEq(await authHash(env, String(b.current || "")), u.auth_hash)) throw new HttpError(403, "Mot de passe incorrect");
  await env.DB.prepare("UPDATE cabinets SET rec_salt = ?1, rec_auth = ?2, rec_wrapped = ?3 WHERE id = ?4")
    .bind(b64f(b.rsalt), await authHash(env, b64f(b.rauth)), wrappedF(b.rwrapped), u.cabinet_id).run();
  return { ok: true };
}

/* ---------- Équipe ---------- */
async function team(env, u) {
  ownerOnly(u);
  const [users, sessions] = await env.DB.batch([
    env.DB.prepare("SELECT id, login, name_enc AS name, role, perms, active, must_change AS mustChange, created_at AS created FROM users WHERE cabinet_id = ?1 ORDER BY created_at").bind(u.cabinet_id),
    env.DB.prepare("SELECT id, user_id AS user, device, created_at AS created, last_seen AS seen FROM sessions WHERE cabinet_id = ?1 AND revoked = 0 ORDER BY last_seen DESC").bind(u.cabinet_id),
  ]);
  return { users: users.results, sessions: sessions.results.map((s) => ({ ...s, current: s.id === u.sid })) };
}
async function teamAdd(env, u, b) {
  ownerOnly(u);
  const login = loginF(b.login), perms = String(b.perms || "");
  if (!PERMS.test(perms)) bad();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE cabinet_id = ?1").bind(u.cabinet_id).first();
  if (n.n >= 25) bad("25 comptes au maximum par cabinet.");
  if (await env.DB.prepare("SELECT 1 FROM users WHERE login = ?1").bind(login).first()) bad("Cet identifiant est déjà utilisé, choisissez-en un autre.");
  await env.DB.prepare("INSERT INTO users (id, cabinet_id, login, name_enc, role, perms, kdf_salt, auth_hash, wrapped, must_change, created_at) VALUES (?1, ?2, ?3, ?4, 'member', ?5, ?6, ?7, ?8, 1, ?9)")
    .bind(crypto.randomUUID(), u.cabinet_id, login, str(b.name, 2000), perms, b64f(b.salt), await authHash(env, b64f(b.auth)), wrappedF(b.wrapped), Date.now()).run();
  return { ok: true };
}
async function teamUpdate(env, u, b) {
  ownerOnly(u);
  const t = await env.DB.prepare("SELECT * FROM users WHERE id = ?1 AND cabinet_id = ?2").bind(String(b.id || ""), u.cabinet_id).first();
  if (!t) throw new HttpError(404, "Membre introuvable");
  if (t.role === "owner") bad("Le compte du titulaire ne peut pas être modifié ici.");
  const q = [];
  if (b.perms !== undefined) { if (!PERMS.test(String(b.perms))) bad(); q.push(env.DB.prepare("UPDATE users SET perms = ?1 WHERE id = ?2").bind(String(b.perms), t.id)); }
  if (b.name !== undefined) q.push(env.DB.prepare("UPDATE users SET name_enc = ?1 WHERE id = ?2").bind(str(b.name, 2000), t.id));
  if (b.active !== undefined) {
    q.push(env.DB.prepare("UPDATE users SET active = ?1 WHERE id = ?2").bind(b.active ? 1 : 0, t.id));
    if (!b.active) q.push(env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ?1").bind(t.id));
  }
  if (b.reset) {
    q.push(env.DB.prepare("UPDATE users SET kdf_salt = ?1, auth_hash = ?2, wrapped = ?3, must_change = 1, fails = 0, locked_until = 0 WHERE id = ?4")
      .bind(b64f(b.reset.salt), await authHash(env, b64f(b.reset.auth)), wrappedF(b.reset.wrapped), t.id));
    q.push(env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE user_id = ?1").bind(t.id));
  }
  if (q.length) await env.DB.batch(q);
  return { ok: true };
}
async function revokeSession(env, u, b) {
  const s = await env.DB.prepare("SELECT * FROM sessions WHERE id = ?1 AND cabinet_id = ?2").bind(String(b.id || ""), u.cabinet_id).first();
  if (!s || (u.role !== "owner" && s.user_id !== u.id)) throw new HttpError(404, "Appareil introuvable");
  await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?1").bind(s.id).run();
  return { ok: true };
}
async function activity(env, u, b) {
  ownerOnly(u);
  const before = Number(b.before) || Date.now() + 1;
  const r = await env.DB.prepare("SELECT col, rid, user_id AS user, action, at FROM audit WHERE cabinet_id = ?1 AND at < ?2 ORDER BY at DESC, seq DESC LIMIT 100")
    .bind(u.cabinet_id, before).all();
  return { items: r.results };
}

/* ---------- Synchronisation ---------- */
async function sync(env, u, b) {
  const since = Math.max(0, Number(b.since) || 0);
  const changes = Array.isArray(b.changes) ? b.changes.slice(0, 100) : [];
  const rejected = [], denied = [];
  const ok = [];
  for (const c of changes) {
    if (!c || typeof c.col !== "string" || typeof c.id !== "string" || !c.id || c.id.length > 100) bad();
    if (!can(u, c.col, true)) { denied.push({ col: c.col, id: c.id }); continue; }
    const del = !!c.del, data = del ? null : c.data;
    if (!del && (typeof data !== "string" || data.length > MAX_REC)) bad("Fiche trop volumineuse");
    ok.push({ col: c.col, id: c.id, del, data, t: Math.min(Number(c.t) || Date.now(), Date.now() + 864e5) });
  }
  if (ok.length) {
    const exist = new Map();
    for (let i = 0; i < ok.length; i += 30) {
      const part = ok.slice(i, i + 30);
      const r = await env.DB.prepare("SELECT col, id, t FROM records WHERE cabinet_id = ? AND (" + part.map(() => "(col = ? AND id = ?)").join(" OR ") + ")")
        .bind(u.cabinet_id, ...part.flatMap((c) => [c.col, c.id])).all();
      r.results.forEach((x) => exist.set(x.col + "\u0001" + x.id, x.t));
    }
    const q = [], now = Date.now(), cab = u.cabinet_id;
    for (const c of ok) {
      const prev = exist.get(c.col + "\u0001" + c.id);
      if (prev !== undefined && prev > c.t) continue;
      const action = c.del ? "delete" : prev === undefined ? "create" : "update";
      q.push(env.DB.prepare("UPDATE cabinets SET seq = seq + 1 WHERE id = ?1").bind(cab));
      q.push(env.DB.prepare(
        "INSERT INTO records (cabinet_id, col, id, seq, data, deleted, t, by_user) VALUES (?1, ?2, ?3, (SELECT seq FROM cabinets WHERE id = ?1), ?4, ?5, ?6, ?7) " +
        "ON CONFLICT (cabinet_id, col, id) DO UPDATE SET seq = excluded.seq, data = excluded.data, deleted = excluded.deleted, t = excluded.t, by_user = excluded.by_user WHERE excluded.t >= records.t"
      ).bind(cab, c.col, c.id, c.data, c.del ? 1 : 0, c.t, u.id));
      q.push(env.DB.prepare(
        "INSERT INTO audit (cabinet_id, seq, col, rid, user_id, action, at) SELECT ?1, seq, col, id, ?4, ?5, ?6 FROM records WHERE cabinet_id = ?1 AND col = ?2 AND id = ?3 AND seq = (SELECT seq FROM cabinets WHERE id = ?1)"
      ).bind(cab, c.col, c.id, u.id, action, now));
    }
    if (q.length) await env.DB.batch(q);
    // Ce qui n'a pas été appliqué (version plus récente déjà sur le serveur) est renvoyé à l'appareil
    for (let i = 0; i < ok.length; i += 30) {
      const part = ok.slice(i, i + 30);
      const r = await env.DB.prepare("SELECT col, id, seq, data, deleted, t, by_user FROM records WHERE cabinet_id = ? AND (" + part.map(() => "(col = ? AND id = ?)").join(" OR ") + ")")
        .bind(cab, ...part.flatMap((c) => [c.col, c.id])).all();
      const sent = new Map(part.map((c) => [c.col + "\u0001" + c.id, c.t]));
      r.results.forEach((x) => { if (x.t > sent.get(x.col + "\u0001" + x.id)) rejected.push(row(x)); });
    }
  }
  const readable = Object.keys(COLS).filter((c) => can(u, c, false));
  const [cabRow, recs] = await env.DB.batch([
    env.DB.prepare("SELECT seq FROM cabinets WHERE id = ?1").bind(u.cabinet_id),
    env.DB.prepare("SELECT col, id, seq, data, deleted, t, by_user FROM records WHERE cabinet_id = ?1 AND seq > ?2 AND col IN (" + readable.map((c) => "'" + c + "'").join(",") + ") ORDER BY seq LIMIT " + (PAGE + 1)).bind(u.cabinet_id, since),
  ]);
  const top = cabRow.results[0].seq;
  let list = recs.results.filter((x) => x.seq <= top);
  const more = list.length > PAGE;
  if (more) list = list.slice(0, PAGE);
  return { seq: more ? list[list.length - 1].seq : Math.max(top, since), more, changes: list.map(row), rejected, denied, me: me(u), now: Date.now() };
}
const row = (x) => ({ col: x.col, id: x.id, seq: x.seq, data: x.deleted ? null : x.data, del: !!x.deleted, t: x.t, by: x.by_user });

/* ---------- Routeur ---------- */
const ROUTES = {
  "/api/register": (env, b) => register(env, b),
  "/api/prelogin": (env, b) => prelogin(env, b),
  "/api/login": (env, b) => login(env, b),
  "/api/recover/start": (env, b) => recover(env, b, "start"),
  "/api/recover/key": (env, b) => recover(env, b, "key"),
  "/api/recover/finish": (env, b) => recover(env, b, "finish"),
};
const AUTHED = {
  "/api/sync": sync,
  "/api/me": async (env, u) => ({ me: me(u) }),
  "/api/password": changePassword,
  "/api/recovery": setRecovery,
  "/api/team": team,
  "/api/team/add": teamAdd,
  "/api/team/update": teamUpdate,
  "/api/sessions/revoke": revokeSession,
  "/api/activity": activity,
  "/api/logout": async (env, u) => { await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?1").bind(u.sid).run(); return { ok: true }; },
};

async function api(req, env, ctx, path) {
  if (req.method !== "POST") return fail(405, "POST attendu");
  if (!env.DB) return fail(503, "Synchronisation non configurée");
  const len = Number(req.headers.get("content-length") || 0);
  if (len > 20_000_000) return fail(413, "Envoi trop volumineux");
  try {
    const b = await req.json().catch(() => bad());
    if (!b || typeof b !== "object") bad();
    if (ROUTES[path]) return json(await ROUTES[path](env, b));
    if (AUTHED[path]) { const u = await authed(req, env, ctx); return json(await AUTHED[path](env, u, b)); }
    if (WA_ROUTES[path] && env.ASSISTANT === "1") { const u = await authed(req, env, ctx); return json(await WA_ROUTES[path](env, u, b, req)); }
    return fail(404, "Inconnu");
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.message, e.extra);
    if (e instanceof WaError) return fail(e.status, e.message);
    console.error(e);
    return fail(500, "Erreur serveur, réessayez.");
  }
}

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname.startsWith("/api/")) return api(req, env, ctx, u.pathname.replace(/\/+$/, ""));
    if (u.pathname === "/wa/webhook" && env.ASSISTANT === "1") return webhook(req, env, ctx);
    if (u.pathname.startsWith("/downloads/")) return Response.redirect(u.origin + "/installer-android", 302);
    const html = PAGES[u.pathname];
    if (html && (req.method === "GET" || req.method === "HEAD"))
      return new Response(req.method === "HEAD" ? null : html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" } });
    const f = FILES[u.pathname];
    if (f !== undefined && (req.method === "GET" || req.method === "HEAD")) {
      const ext = u.pathname.split(".").pop();
      return new Response(req.method === "HEAD" ? null : f, { headers: { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": ext === "js" && u.pathname === "/sw.js" ? "no-cache" : "public, max-age=86400" } });
    }
    return new Response("Introuvable", { status: 404 });
  },
};
