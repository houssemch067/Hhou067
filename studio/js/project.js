// Project model: projects, clips, text & stickers.
import { uid } from './util.js';

export const DEF_FILTER = () => ({ brightness: 1, contrast: 1, saturate: 1, warmth: 0 });

export function newProject(settings, data = {}) {
  return {
    id: uid(), name: 'My reel', aspect: '9:16', bg: '#000000', accent: settings?.accent || '#14b8a6',
    bpm: 120, look: 'natural', drop: null,
    soundtrack: { style: 'glowup', volume: 0.85, sfxVolume: 0.9, sfx: true },
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
    filter: DEF_FILTER(), fx: {}, transition: { type: 'dissolve', dur: 0.5 }, color: '#0f172a', ...extra,
  };
}

export function newText(text, start, extra = {}) {
  return {
    id: uid(), kind: 'text', text, start, duration: 2.5, x: 0.5, y: 0.2, size: 84, color: '#ffffff',
    font: 'modern', style: 'classic', bg: 'none', bgColor: 'rgba(15,23,42,.72)', anim: 'pop', ...extra,
  };
}

export function newSticker(kind, start, extra = {}) {
  return { id: uid(), kind, text: '', start, duration: 3, x: 0.5, y: 0.5, size: 1, ...extra };
}

export const TEXT_PRESETS = [
  { name: 'Title', props: { size: 96, font: 'strong', style: 'classic', anim: 'pop', color: '#ffffff' } },
  { name: 'Highlight', props: { size: 60, font: 'modern', style: 'highlight', bgColor: '#ffffff', color: '#111111', anim: 'words' } },
  { name: 'Neon', props: { size: 100, font: 'strong', style: 'neon', color: '#5eead4', anim: 'pop' } },
  { name: 'Caption', props: { size: 56, font: 'modern', style: 'classic', bg: 'box', bgColor: 'rgba(0,0,0,.55)', y: 0.72, anim: 'typewriter' } },
  { name: 'Elegant', props: { size: 80, font: 'classic', style: 'classic', anim: 'fade' } },
];

/** Snap clip durations to the music's beat grid (keeps the cut rhythm on the beat). */
export function beatSync(p, beats, period) {
  if (!beats?.length) return 0;
  const first = beats.find(b => b >= (p.audio?.offset || 0)) ?? beats[0];
  p.clips.forEach((c, i) => {
    const tr = i < p.clips.length - 1 && c.transition?.type !== 'none' ? c.transition.dur : 0;
    const n = Math.max(2, Math.round((c.duration - tr) / period));
    if (i === 0) c.duration = +Math.max(0.6, first + n * period - (p.audio?.offset || 0) + tr).toFixed(3);
    else c.duration = +(n * period + tr).toFixed(3);
  });
  return p.clips.length;
}

/** Stretch every time in the edit by factor k (used to re-tempo an edit to a new song). */
export function scaleTimeline(p, k) {
  p.clips.forEach(c => { c.duration = +(c.duration * k).toFixed(3); if (c.transition) c.transition.dur = +(c.transition.dur * k).toFixed(3); });
  p.overlays.forEach(o => { o.start = +(o.start * k).toFixed(3); o.duration = +(o.duration * k).toFixed(3); });
  if (p.drop != null) p.drop = +(p.drop * k).toFixed(3);
}
