// Outils de test : une base D1 en mémoire (node:sqlite), des licences signées avec une clé de test,
// un faux Claude qui suit un scénario et un faux WhatsApp qui enregistre les envois.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

export function makeDB() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async run() {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
    async all() {
      return { results: db.prepare(sql).all(...args).map((x) => ({ ...x })) };
    },
    async first() {
      const r = db.prepare(sql).get(...args);
      return r ? { ...r } : null;
    },
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => Promise.all(list.map((s) => s.run())), raw: db };
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
export async function makeKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const sign = async (payload) => {
    const data = b64u(new TextEncoder().encode(JSON.stringify(payload)));
    return data + '.' + b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(data)));
  };
  return { pub: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }, sign };
}

/** Faux client Anthropic : chaque appel renvoie l'étape suivante du scénario (fonction des paramètres reçus). */
export function fakeClaude(steps) {
  const calls = [], errors = [];
  return {
    calls,
    errors,
    beta: {
      messages: {
        async create(params) {
          calls.push(JSON.parse(JSON.stringify(params)));
          const s = steps.shift();
          if (!s) throw new Error('scénario épuisé');
          let out;
          try {
            out = typeof s === 'function' ? s(params) : s;
          } catch (e) {
            errors.push(e); // une assertion du test a échoué : on la remonte au test
            throw e;
          }
          if (out instanceof Error) throw out;
          return out;
        },
      },
    },
  };
}
export const say = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text }] });
export const use = (name, input, id = 'tu_' + Math.random().toString(36).slice(2, 8)) => ({ stop_reason: 'tool_use', content: [{ type: 'text', text: '' }, { type: 'tool_use', id, name, input }] });

export function waPayload(phoneId, from, id, text, name = 'Karim') {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneId }, contacts: [{ wa_id: from, profile: { name } }], messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }],
  };
}
export const waSig = (secret, raw) => 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');

/** ctx.waitUntil qui garde les promesses pour pouvoir les attendre dans le test */
export function makeCtx() {
  const p = [];
  return { waitUntil: (x) => p.push(x), done: () => Promise.all(p) };
}

export const PROFILE = {
  cabinet: 'Cabinet Dentaire El Amel', praticien: 'Dr Benali Sara', specialite: 'Chirurgien-dentiste',
  adresse: '12 rue Didouche Mourad', ville: 'Alger', tel: '0555 12 34 56', urgence: '0661 00 00 00',
  soins: 'Consultation : 1 500 DA\nDétartrage : 3 000 DA', creneau: 30, delai_min: 2, jours_max: 30,
  horaires: { 0: [['09:00', '12:00'], ['14:00', '17:00']], 1: [['09:00', '12:00'], ['14:00', '17:00']], 2: [['09:00', '12:00']], 3: [['09:00', '12:00'], ['14:00', '17:00']], 4: [['09:00', '12:00']], 5: [], 6: [['09:00', '13:00']] },
};
