// Viral reel templates. Timed in beats so every cut lands on the music and the reveal hits the drop.
import { newProject, newClip, newText, newSticker } from './project.js';
import { layoutTimeline } from './engine.js';

export const TEMPLATES = [
  { id: 'loading', name: 'Loading Smile', tag: '🔥 Trending', desc: 'Loading bar fills… glitch… NEW SMILE UNLOCKED', style: 'glowup', bpm: 128 },
  { id: 'waitforit', name: 'Wait For It', tag: '😱 Hook', desc: '3·2·1 countdown, shake, boom reveal with confetti', style: 'phonk', bpm: 140 },
  { id: 'pov', name: 'POV', tag: '💬 Story', desc: 'POV hook, punch reveal on the drop, swipe compare', style: 'phonk', bpm: 130 },
  { id: 'glowup', name: 'Glow Up Cuts', tag: '⚡ Beat cuts', desc: 'Before/after cuts that speed up with the beat', style: 'house', bpm: 124 },
  { id: 'magnifier', name: 'Magnifier', tag: '🔍 Satisfying', desc: 'A lens glides over the smile, then reveals all', style: 'lofi', bpm: 85 },
  { id: 'cinematic', name: 'Cinematic', tag: '🎬 Premium', desc: 'Letterbox, film grain, blinds reveal, epic boom', style: 'cinematic', bpm: 90 },
  { id: 'polaroid', name: 'Polaroid Drop', tag: '📸 Aesthetic', desc: 'Day 1 / Final day polaroids drop in with a flash', style: 'glowup', bpm: 118 },
  { id: 'luxury', name: 'Luxury', tag: '💎 Elegant', desc: 'Serif titles, diagonal light reveal, glam look', style: 'cinematic', bpm: 96 },
];

/** Builds a full edit from a before/after pair (+ optional extra shots). */
export function buildTemplate(id, { before, after, extras = [], settings = {}, treatment = '' }) {
  const tpl = TEMPLATES.find(t => t.id === id) || TEMPLATES[0];
  const B = 60 / tpl.bpm;
  const p = newProject(settings, {
    name: `${treatment || 'Smile'} · ${tpl.name}`, bpm: tpl.bpm, template: tpl.id,
    inputs: { before: before.id, after: after.id, extras: extras.map(m => m.id), treatment },
    soundtrack: { style: tpl.style, volume: 0.85, sfxVolume: 0.9, sfx: true },
  });
  p.look = templateLook(tpl.id);
  const accent = p.accent, LB = p.style.labelBefore, LA = p.style.labelAfter;
  const T = treatment || 'Smile makeover';
  const pending = [];
  let dropRef = null;
  const k = {
    B, accent, T, LB, LA, s: settings,
    clip(m, beats, x = {}) {
      const { tr, ...rest } = x;
      const c = newClip(m, { duration: +(beats * B).toFixed(3), motion: 'none', transition: { type: 'none', dur: 0 }, in: 0, ...rest });
      if (tr) c.transition = { type: tr[0], dur: +(tr[1] * B).toFixed(3) };
      p.clips.push(c);
      return c;
    },
    compare(beats, layout, x = {}) { return k.clip(before, beats, { layout, mediaId2: after.id, ...x }); },
    solid(beats, x = {}) { return k.clip(null, beats, { kind: 'solid', color: '#05070d', color2: accent, gradient: true, ...x }); },
    text(c, off, text, props = {}, dur = 'rest') { pending.push([c, off, dur, newText(text, 0, props)]); },
    sticker(c, off, kind, props = {}, dur = 'rest') { pending.push([c, off, dur, newSticker(kind, 0, props)]); },
    emoji(c, off, e, x, y, size = 150, dur = 'rest') { k.sticker(c, off, 'emoji', { text: e, x, y, size }, dur); },
    drop(c, frac = 0) { dropRef = [c, frac]; },
    extras(beats, x = {}) { return extras.map(m => k.clip(m, m.kind === 'video' ? Math.max(beats, 4) : beats, { motion: 'zoomIn', ...x })); },
    outro(beats, x = {}) {
      const c = k.solid(beats, x.clip);
      k.text(c, 0.3, settings.clinic || 'Your clinic', { font: x.font || 'strong', size: x.font === 'classic' ? 92 : 112, y: 0.4, anim: 'words', style: 'classic' });
      if (settings.handle) k.sticker(c, 1, 'tag', { text: settings.handle, y: 0.5 });
      k.sticker(c, 1.6, 'cta', { text: 'Book your consultation', sub: settings.phone || settings.website || '', y: 0.64 });
      return c;
    },
  };
  BUILD[tpl.id](k, { before, after });
  layoutTimeline(p);
  for (const [c, off, dur, o] of pending) {
    o.start = +(c._start + off * B).toFixed(3);
    o.duration = +(dur === 'rest' ? Math.max(0.4, c._start + c.duration - o.start - 0.05) : dur * B).toFixed(3);
    p.overlays.push(o);
  }
  if (dropRef) p.drop = +(dropRef[0]._start + dropRef[1] * dropRef[0].duration).toFixed(3);
  return p;
}

const HL = { style: 'highlight', font: 'modern', bgColor: '#ffffff', color: '#0b0b0b', size: 62, y: 0.15 };
const MONO = { brightness: 0.95, contrast: 1.06, saturate: 0.45, warmth: 0 };

const BUILD = {
  loading(k, { before, after }) {
    const c1 = k.clip(before, 8, { motion: 'zoomIn', filter: MONO, fx: { grain: true, vignette: true }, tr: ['glitch', 0.75] });
    k.text(c1, 0.2, 'POV: you hid your\nsmile for years', { ...HL, anim: 'words' });
    k.sticker(c1, 0.5, 'loading', { text: 'Loading new smile…', y: 0.74 }, 6.6);
    const c2 = k.clip(after, 8, { motion: 'smileZoom', fx: { flashIn: true, rgbIn: true, sparkle: true, pulse: true }, tr: ['whip', 0.75] });
    k.drop(c2);
    k.sticker(c2, 0, 'confetti', {}, 4);
    k.text(c2, 0.6, 'NEW SMILE\nUNLOCKED', { font: 'strong', style: 'neon', color: '#5eead4', size: 128, y: 0.17, anim: 'pop' });
    k.emoji(c2, 3, '😍', 0.8, 0.66);
    k.extras(2, { tr: ['flash', 0.5], fx: { flashIn: true } });
    const c3 = k.compare(10, 'lens', { motion: 'zoomIn', tr: ['punch', 0.75] });
    k.text(c3, 0.3, 'Look closer 🔍', { ...HL, anim: 'pop' }, 6);
    const c4 = k.compare(8, 'split', { motion: 'zoomIn', fx: { pulse: true }, tr: ['flash', 0.5] });
    k.sticker(c4, 1, 'rating', { y: 0.5, text: 'Rate this smile 1–10' });
    k.outro(8);
  },
  waitforit(k, { before, after }) {
    const c1 = k.clip(before, 12, { motion: 'smileZoom', filter: MONO, fx: { shake: 0.3, vignette: true }, tr: ['punch', 0.75] });
    k.text(c1, 0.2, 'Wait for it… 😱', { font: 'strong', size: 124, y: 0.15, anim: 'pop' });
    k.sticker(c1, 5.25, 'countdown', { text: '3,2,1', y: 0.55 }, 6);
    const c2 = k.clip(after, 8, { motion: 'zoomOut', fx: { flashIn: true, rgbIn: true, shake: 1, shakeIn: true, sparkle: true, pulse: true }, tr: ['glitch', 0.5] });
    k.drop(c2);
    k.sticker(c2, 0, 'confetti', {}, 5);
    k.emoji(c2, 1, '🤯', 0.78, 0.22, 170);
    k.text(c2, 2, 'NO WAY', { font: 'strong', style: 'outline', color: '#ffffff', bgColor: '#000000', size: 170, y: 0.8, anim: 'pop' });
    const c3 = k.compare(8, 'wipe', { tr: ['whip', 0.5] });
    k.text(c3, 0.2, 'Same person. Same light.', { ...HL, size: 54, y: 0.9, anim: 'words' });
    k.extras(2, { tr: ['flash', 0.5], fx: { flashIn: true } });
    k.outro(6);
  },
  pov(k, { before, after }) {
    const c1 = k.clip(before, 8, { motion: 'zoomIn', filter: { ...MONO, saturate: 0.7 }, fx: { shake: 0.15 }, tr: ['punch', 0.5] });
    k.text(c1, 0.2, 'POV: you finally said yes\nto your dream smile', { ...HL, anim: 'typewriter', size: 56 });
    const c2 = k.clip(after, 8, { motion: 'zoomOut', fx: { flashIn: true, rgbIn: true, pulse: true, sparkle: true, shake: 0.6, shakeIn: true }, tr: ['glitch', 0.5] });
    k.drop(c2);
    k.emoji(c2, 0.5, '🔥', 0.82, 0.2);
    k.text(c2, 3, 'WORTH IT?', { font: 'strong', style: 'outline', color: '#ffffff', bgColor: '#000000', size: 150, y: 0.8, anim: 'pop' });
    const c3 = k.compare(10, 'wipe', { tr: ['whip', 0.5] });
    k.text(c3, 0.2, k.T, { font: 'modern', style: 'classic', bg: 'pill', bgColor: k.accent, size: 54, y: 0.9, anim: 'slideUp' });
    k.extras(2, { tr: ['whip', 0.5] });
    const c4 = k.clip(after, 6, { motion: 'smileZoom', fx: { sparkle: true, pulse: true }, tr: ['flash', 0.5] });
    k.sticker(c4, 0.5, 'rating', { y: 0.78 });
    k.outro(8);
  },
  glowup(k, { before, after }) {
    const c0 = k.solid(4, { color: '#000000', gradient: false, tr: ['flash', 0.25] });
    k.text(c0, 0.1, 'THE GLOW UP', { font: 'strong', style: 'neon', color: '#5eead4', size: 150, y: 0.46, anim: 'words' });
    k.text(c0, 1.2, k.T, { font: 'modern', size: 48, y: 0.56, anim: 'fade', color: '#cbd5e1' });
    const seq = [[before, 2], [after, 2], [before, 1], [after, 1], [before, 0.5], [after, 0.5], [before, 0.5], [after, 0.5]];
    seq.forEach(([m, beats]) => k.clip(m, beats, { motion: 'zoomIn', tag: m === before ? k.LB : k.LA, fx: m === after ? { flashIn: true } : { }, filter: m === before ? MONO : undefined }));
    k.extras(1, { fx: { flashIn: true } });
    const hold = k.clip(after, 8, { motion: 'smileZoom', fx: { flashIn: true, sparkle: true, pulse: true, rgbIn: true }, tr: ['zoom', 0.5] });
    k.drop(hold);
    k.sticker(hold, 0, 'confetti', {}, 4);
    k.text(hold, 0.5, '✨ GLOW UP ✨', { font: 'strong', style: 'neon', color: '#f9a8d4', size: 110, y: 0.15, anim: 'pop' });
    const d = k.compare(8, 'diagonal', { tr: ['fade', 0.5] });
    k.sticker(d, 2, 'rating', { y: 0.82 });
    k.outro(6);
  },
  magnifier(k, { before, after }) {
    const c1 = k.clip(before, 4, { motion: 'zoomIn', tr: ['zoom', 0.5] });
    k.text(c1, 0.2, 'Wait… look closer 🔍', { ...HL, anim: 'words' });
    const c2 = k.compare(12, 'lens', { motion: 'zoomIn', tr: ['dissolve', 0.5] });
    k.drop(c2, 0.74);
    k.text(c2, 0.5, 'Zoom in on the details', { font: 'marker', size: 92, y: 0.88, anim: 'fade', color: '#ffffff' }, 7);
    const c3 = k.clip(after, 6, { motion: 'zoomIn', fx: { sparkle: true }, tr: ['dissolve', 0.5] });
    k.sticker(c3, 1, 'rating', { y: 0.8 });
    k.extras(3, { tr: ['dissolve', 0.5] });
    k.outro(6, { font: 'classic' });
  },
  cinematic(k, { before, after }) {
    const lb = { letterbox: true, vignette: true, grain: true };
    const c1 = k.clip(before, 6, { motion: 'zoomIn', fx: lb, tr: ['fade', 0.75] });
    k.text(c1, 0.4, 'Some smiles\nchange everything.', { font: 'classic', size: 80, y: 0.5, anim: 'fade' });
    const c2 = k.compare(9, 'blinds', { motion: 'zoomIn', fx: lb, tr: ['dissolve', 0.75] });
    k.drop(c2, 0.14);
    k.extras(3, { fx: lb, tr: ['dissolve', 0.75] });
    const c3 = k.clip(after, 6, { motion: 'zoomIn', fx: { ...lb, sparkle: true }, tr: ['fade', 0.75] });
    k.text(c3, 0.6, k.T.toUpperCase(), { font: 'classic', size: 58, y: 0.84, anim: 'fade', spacing: 10 });
    k.outro(6, { font: 'classic', clip: { fx: { letterbox: true, grain: true } } });
    void after;
  },
  polaroid(k, { after }) {
    const c1 = k.compare(12, 'polaroid', { tr: ['flash', 0.5] });
    k.drop(c1, 0.42 + 0.16 * 0.62);
    k.text(c1, 0.2, 'Day 1 → Final day 📸', { font: 'marker', size: 104, y: 0.1, anim: 'words' });
    const c2 = k.clip(after, 6, { motion: 'smileZoom', fx: { flashIn: true, sparkle: true, pulse: true }, tr: ['slide', 0.5] });
    k.sticker(c2, 0, 'confetti', {}, 4);
    k.extras(2, { tr: ['slide', 0.5] });
    const c3 = k.compare(6, 'split', { fx: { pulse: true }, tr: ['fade', 0.5] });
    k.text(c3, 1, k.T, { font: 'marker', size: 80, y: 0.5, anim: 'pop', style: 'highlight', bgColor: '#ffffff', color: '#111111' });
    k.outro(6);
  },
  luxury(k, { after }) {
    const c1 = k.solid(5, { color: '#0a0a0a', color2: '#1f1a12', tr: ['fade', 0.75] });
    k.text(c1, 0.3, 'The Art\nof a Smile', { font: 'classic', size: 112, y: 0.45, anim: 'words', color: '#f5e6c8' });
    k.text(c1, 1.5, k.T.toUpperCase(), { font: 'modern', size: 36, y: 0.58, anim: 'fade', color: '#a8a29e', spacing: 12 });
    const c2 = k.compare(10, 'diagonal', { motion: 'zoomIn', fx: { vignette: true }, tr: ['dissolve', 0.75] });
    k.drop(c2, 0.15);
    const c3 = k.clip(after, 6, { motion: 'zoomIn', fx: { sparkle: true, glow: true, vignette: true }, tr: ['fade', 0.75] });
    k.text(c3, 0.6, 'Designed to be noticed.', { font: 'classic', size: 64, y: 0.86, anim: 'fade', color: '#f5e6c8' });
    k.extras(3, { tr: ['dissolve', 0.75] });
    k.compare(6, 'split', { motion: 'zoomIn', tr: ['fade', 0.75] });
    k.outro(6, { font: 'classic', clip: { color: '#0a0a0a', color2: '#3b2f1e' } });
  },
};

export function templateLook(id) { return id === 'luxury' ? 'glam' : id === 'cinematic' ? 'film' : 'natural'; }
