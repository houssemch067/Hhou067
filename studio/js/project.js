// Project model + "Magic Reel" auto-edit templates.
import { uid } from './util.js';
import { layoutTimeline } from './engine.js';

export const DEF_FILTER = () => ({ brightness: 1, contrast: 1, saturate: 1, warmth: 0 });

export function newProject(settings, data = {}) {
  return {
    id: uid(), name: 'Untitled reel', aspect: '9:16', bg: '#000000', accent: settings?.accent || '#14b8a6',
    style: { labelBefore: settings?.labelBefore || 'BEFORE', labelAfter: settings?.labelAfter || 'AFTER' },
    clips: [], overlays: [], audio: null,
    watermark: { on: !!settings?.watermark, logoMediaId: settings?.logoMediaId || null, text: settings?.handle || '', pos: 'br', opacity: 0.85, size: 0.09 },
    createdAt: Date.now(), updatedAt: Date.now(), ...data,
  };
}

export function newClip(media, extra = {}) {
  const isVideo = media?.kind === 'video';
  return {
    id: uid(), kind: media ? 'media' : 'solid', mediaId: media?.id || null, mediaId2: null,
    layout: 'single', duration: isVideo ? Math.min(media.duration || 5, 8) : 3, in: 0, speed: 1, volume: 1,
    fit: 'cover', zoom: 1, offX: 0, offY: 0, motion: isVideo ? 'none' : 'zoomIn', align: true, labels: true,
    filter: DEF_FILTER(), transition: { type: 'dissolve', dur: 0.5 }, color: '#0f172a', ...extra,
  };
}

export function newText(text, start, extra = {}) {
  return {
    id: uid(), text, start, duration: 2.5, x: 0.5, y: 0.2, size: 84, color: '#ffffff', weight: 800,
    bg: 'none', bgColor: 'rgba(15,23,42,.72)', anim: 'slideUp', font: 'Inter, system-ui, sans-serif', ...extra,
  };
}

export const TEXT_PRESETS = [
  { name: 'Title', props: { size: 96, weight: 900, bg: 'none', anim: 'slideUp', color: '#ffffff' } },
  { name: 'Lower third', props: { size: 52, weight: 700, bg: 'box', bgColor: 'rgba(15,23,42,.75)', y: 0.82, anim: 'slideUp' } },
  { name: 'Pill tag', props: { size: 48, weight: 800, bg: 'pill', bgColor: '#14b8a6', anim: 'pop' } },
  { name: 'Caption', props: { size: 56, weight: 700, bg: 'box', bgColor: 'rgba(0,0,0,.55)', y: 0.72, anim: 'typewriter' } },
  { name: 'Elegant', props: { size: 80, weight: 400, font: 'Georgia, "Times New Roman", serif', anim: 'fade' } },
];

export const TEMPLATES = [
  { id: 'reveal', name: 'Smile Reveal', desc: 'Hook → smile zoom → swipe reveal → split → branded outro', aspect: '9:16', len: '≈14s' },
  { id: 'swipe', name: 'Quick Swipe', desc: 'One clean before/after swipe with outro — perfect loop', aspect: '1:1', len: '≈8s' },
  { id: 'story', name: 'Story Slides', desc: 'Before and after as punchy slides with flash cuts', aspect: '9:16', len: '≈10s' },
  { id: 'clinical', name: 'Clinical Case', desc: 'Calm side-by-side presentation for lectures / patients', aspect: '16:9', len: '≈12s' },
];

/** Builds a complete edit from a before/after pair. */
export function buildTemplate(tid, { before, after, extras = [], treatment = '', settings, musicId = null }) {
  const tpl = TEMPLATES.find(t => t.id === tid) || TEMPLATES[0];
  const p = newProject(settings, { name: `${treatment || 'Smile'} — ${tpl.name}`, aspect: tpl.aspect });
  const accent = p.accent, T = treatment || 'Smile makeover';
  const C = (m, x) => { const c = newClip(m, x); p.clips.push(c); return c; };
  const tr = (type, dur) => ({ type, dur });
  const texts = []; // [clip, offset, text, props] resolved once the timeline is laid out
  const at = (clip, off, text, props) => texts.push([clip, off, text, props]);
  const outro = dur => {
    const c = C(null, { kind: 'solid', color: '#0b1220', color2: accent, gradient: true, duration: dur, transition: tr('none', 0) });
    at(c, 0.25, settings?.clinic || 'Your clinic', { duration: dur - 0.25, y: 0.45, size: 88, anim: 'pop' });
    at(c, 0.6, [settings?.handle, settings?.phone || settings?.website].filter(Boolean).join('\n') || 'Book your consultation', { duration: dur - 0.6, y: 0.58, size: 48, weight: 600, anim: 'fade' });
  };
  if (tpl.id === 'reveal') {
    const hook = C(before, { duration: 2.6, motion: 'smileZoom', transition: tr('flash', 0.4) });
    at(hook, 0.15, 'Wait for the result…', { duration: 2.3, y: 0.15, anim: 'typewriter', size: 76 });
    C(before, { mediaId2: after.id, layout: 'wipe', duration: 5, motion: 'none', transition: tr('zoom', 0.5) });
    extras.forEach(m => C(m, { duration: 1.6, motion: 'zoomIn', transition: tr('slide', 0.35) }));
    const aft = C(after, { duration: 3, motion: 'zoomIn', transition: tr('dissolve', 0.5) });
    at(aft, 0.3, T, { duration: 2.4, y: 0.82, size: 64, bg: 'pill', bgColor: accent, anim: 'pop' });
    C(before, { mediaId2: after.id, layout: 'split', duration: 2.6, motion: 'zoomIn', transition: tr('fade', 0.6) });
    outro(2.8);
  } else if (tpl.id === 'swipe') {
    const w = C(before, { mediaId2: after.id, layout: 'wipe', duration: 5.5, motion: 'none', transition: tr('dissolve', 0.5) });
    at(w, 0.3, T, { duration: 4.8, y: 0.9, size: 56, bg: 'pill', anim: 'slideUp' });
    outro(2.5);
  } else if (tpl.id === 'story') {
    const b = C(before, { duration: 2.2, motion: 'zoomIn', transition: tr('flash', 0.3) });
    at(b, 0.1, p.style.labelBefore, { duration: 1.9, y: 0.12, size: 110, weight: 900, anim: 'pop' });
    const a = C(after, { duration: 2.6, motion: 'smileZoom', transition: tr('push', 0.4) });
    at(a, 0.15, p.style.labelAfter, { duration: 2.2, y: 0.12, size: 110, weight: 900, anim: 'pop', color: '#5eead4' });
    extras.forEach(m => C(m, { duration: 1.4, motion: 'zoomIn', transition: tr('flash', 0.25) }));
    const s = C(before, { mediaId2: after.id, layout: 'split', duration: 2.6, motion: 'none', transition: tr('circle', 0.5) });
    at(s, 0.3, T, { duration: 2.0, y: 0.5, size: 60, bg: 'pill', bgColor: accent, anim: 'pop' });
    outro(2.4);
  } else {
    const title = C(null, { kind: 'solid', color: '#0f172a', duration: 2.2, transition: tr('fade', 0.5) });
    at(title, 0.2, T, { duration: 1.8, y: 0.45, size: 80, anim: 'fade' });
    if (settings?.clinic) at(title, 0.5, settings.clinic, { duration: 1.5, y: 0.58, size: 40, weight: 500, anim: 'fade', color: '#94a3b8' });
    const b = C(before, { duration: 2.5, motion: 'none', fit: 'contain', transition: tr('dissolve', 0.5) });
    at(b, 0.2, p.style.labelBefore, { duration: 2.1, y: 0.9, size: 44, bg: 'box', anim: 'fade' });
    const a = C(after, { duration: 2.5, motion: 'none', fit: 'contain', transition: tr('dissolve', 0.5) });
    at(a, 0.2, p.style.labelAfter, { duration: 2.1, y: 0.9, size: 44, bg: 'box', anim: 'fade' });
    C(before, { mediaId2: after.id, layout: 'split', duration: 4, motion: 'none', transition: tr('fade', 0.6) });
    outro(2.2);
  }
  layoutTimeline(p);
  for (const [clip, off, text, props] of texts) p.overlays.push(newText(text, +(clip._start + off).toFixed(2), props));
  if (musicId) p.audio = { mediaId: musicId, volume: 0.8, offset: 0, in: 0, fadeIn: 0.3, fadeOut: 1.5 };
  return p;
}

/** Snap clip durations to the music's beat grid (keeps the cut rhythm on the beat). */
export function beatSync(p, beats, period) {
  if (!beats?.length) return 0;
  const first = beats.find(b => b >= (p.audio?.offset || 0)) ?? beats[0];
  let t = 0, changed = 0;
  p.clips.forEach((c, i) => {
    const tr = i < p.clips.length - 1 && c.transition?.type !== 'none' ? c.transition.dur : 0;
    const n = Math.max(2, Math.round((c.duration - tr) / period));
    const target = n * period + tr;
    if (i === 0) {
      // first cut lands on a beat measured from music offset
      const end = first + n * period - (p.audio?.offset || 0);
      c.duration = +Math.max(0.6, end + tr).toFixed(3);
    } else c.duration = +target.toFixed(3);
    t += c.duration - tr; changed++;
  });
  return changed;
}
