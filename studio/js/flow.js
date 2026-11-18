// Shared state of the creation flow: the chosen before / after (+ extra) shots.
import { getMedia } from './store.js';

export const pick = { before: null, after: null, extras: [] };
export function resetPick() { pick.before = pick.after = null; pick.extras = []; }

export function goTemplates() {
  try { sessionStorage.setItem('ds-pick', JSON.stringify({ b: pick.before?.id, a: pick.after?.id, e: pick.extras.map(m => m.id) })); } catch { /* private mode */ }
  location.hash = '#/templates';
}

/** Restores the pick after a reload. */
export async function loadPick() {
  if (pick.before && pick.after) return pick;
  try {
    const s = JSON.parse(sessionStorage.getItem('ds-pick') || 'null');
    if (s) {
      pick.before = await getMedia(s.b); pick.after = await getMedia(s.a);
      pick.extras = (await Promise.all((s.e || []).map(getMedia))).filter(Boolean);
    }
  } catch { /* ignore */ }
  return pick;
}
