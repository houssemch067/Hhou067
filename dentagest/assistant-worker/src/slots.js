// Calcul des créneaux libres à partir des horaires du cabinet et de l'agenda synchronisé.
// Heure de l'Algérie : UTC+1 toute l'année (pas d'heure d'été).

export const TZ_OFFSET_MIN = 60;
export const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Date et heure locales (Algérie) sous forme { date: 'AAAA-MM-JJ', min: minutes depuis minuit, wd: jour de semaine } */
export function nowLocal(ms = Date.now()) {
  const d = new Date(ms + TZ_OFFSET_MIN * 60e3);
  return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), wd: d.getUTCDay() };
}

export const toMin = (h) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
export const toHHMM = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z'));
export const weekday = (date) => new Date(date + 'T12:00:00Z').getUTCDay();
export const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const dateLongue = (date) => {
  const d = new Date(date + 'T12:00:00Z');
  return JOURS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MOIS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
};

/** Plages d'ouverture d'un jour : [[debut, fin], ...] en minutes */
export function openingRanges(profile, date) {
  const conges = Array.isArray(profile.conges) ? profile.conges : [];
  if (conges.some((c) => Array.isArray(c) && date >= c[0] && date <= (c[1] || c[0]))) return [];
  const h = (profile.horaires || {})[weekday(date)] || [];
  return h.map(([a, b]) => [toMin(a), toMin(b)]).filter(([a, b]) => a >= 0 && b > a);
}

const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

/**
 * Créneaux libres entre deux dates incluses.
 * busy : [{ d: 'AAAA-MM-JJ', h: 'HH:MM', m: durée en minutes }]
 * Renvoie [{ date, heure }] triés.
 */
export function freeSlots(profile, busy, from, to, { nowMs = Date.now(), moment = 'indifferent', limit = 12, perDay = 4 } = {}) {
  const step = Math.max(10, Math.min(120, Number(profile.creneau) || 30));
  const delai = Math.max(0, Number(profile.delai_min ?? 2)) * 60; // délai minimal avant un rendez-vous (minutes)
  const horizon = Math.max(1, Math.min(90, Number(profile.jours_max) || 30));
  const now = nowLocal(nowMs);
  const last = addDays(now.date, horizon);
  if (!isDate(from)) from = now.date;
  if (!isDate(to) || to < from) to = addDays(from, 6);
  if (from < now.date) from = now.date;
  if (to > last) to = last;

  const byDay = {};
  for (const b of busy || []) {
    const s = toMin(b.h);
    if (!isDate(b.d) || isNaN(s)) continue;
    (byDay[b.d] ||= []).push([s, s + Math.max(5, Number(b.m) || step)]);
  }

  const out = [];
  for (let date = from; date <= to && out.length < limit; date = addDays(date, 1)) {
    let n = 0;
    for (const [a, b] of openingRanges(profile, date)) {
      for (let t = a; t + step <= b && n < perDay && out.length < limit; t += step) {
        if (moment === 'matin' && t >= 12 * 60) continue;
        if (moment === 'apres-midi' && t < 12 * 60) continue;
        if (date === now.date && t < now.min + delai) continue;
        if ((byDay[date] || []).some(([x, y]) => overlaps(t, t + step, x, y))) continue;
        out.push({ date, heure: toHHMM(t) });
        n++;
      }
    }
  }
  return out;
}

/** Vérifie qu'un créneau précis est libre et dans les horaires. Renvoie '' si OK, sinon la raison. */
export function checkSlot(profile, busy, date, heure, { nowMs = Date.now() } = {}) {
  const step = Math.max(10, Math.min(120, Number(profile.creneau) || 30));
  const t = toMin(heure);
  if (!isDate(date) || isNaN(t)) return 'date ou heure invalide';
  const now = nowLocal(nowMs);
  const horizon = Math.max(1, Math.min(90, Number(profile.jours_max) || 30));
  if (date < now.date || (date === now.date && t < now.min + Math.max(0, Number(profile.delai_min ?? 2)) * 60)) return 'ce créneau est déjà passé ou trop proche';
  if (date > addDays(now.date, horizon)) return 'date trop lointaine (agenda ouvert sur ' + horizon + ' jours)';
  const ranges = openingRanges(profile, date);
  if (!ranges.length) return 'le cabinet est fermé ce jour-là';
  if (!ranges.some(([a, b]) => t >= a && t + step <= b)) return 'heure en dehors des horaires d’ouverture';
  const taken = (busy || []).some((b) => b.d === date && !isNaN(toMin(b.h)) && overlaps(t, t + step, toMin(b.h), toMin(b.h) + Math.max(5, Number(b.m) || step)));
  return taken ? 'créneau déjà pris' : '';
}

/** Horaires lisibles pour le prompt : « dimanche : 09:00-12:30, 14:00-17:00 » */
export function horairesTexte(profile) {
  const order = [6, 0, 1, 2, 3, 4, 5]; // samedi → vendredi, ordre habituel en Algérie
  return order
    .map((wd) => {
      const h = ((profile.horaires || {})[wd] || []).filter(([a, b]) => toMin(a) >= 0 && toMin(b) > toMin(a));
      return JOURS[wd] + ' : ' + (h.length ? h.map(([a, b]) => a + '-' + b).join(', ') : 'fermé');
    })
    .join('\n');
}

/** Numéro WhatsApp international (2135XXXXXXXX) → format local (05XXXXXXXX) */
export function waToLocal(wa) {
  const s = String(wa || '').replace(/\D/g, '');
  return s.startsWith('213') && s.length === 12 ? '0' + s.slice(3) : '+' + s;
}
