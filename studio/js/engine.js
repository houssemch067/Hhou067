// Timeline rendering engine: draws any time `t` of a project onto a canvas.
// Shared by every preview and by the exporter, so what you see is exactly what you export.
import { clamp, ease, easeOut, lerp, makeCanvas } from './util.js';
import { getMedia, imageEl, mediaURL } from './store.js';
import { focusOf } from './ai.js';
import { renderSoundtrack, loadingProgress } from './synth.js';

export const ASPECTS = { '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080], '16:9': [1920, 1080] };
export const TRANSITIONS = ['none', 'dissolve', 'fade', 'flash', 'glitch', 'whip', 'punch', 'shake', 'wipe', 'slide', 'push', 'zoom', 'circle', 'blur'];
export const TR_LABEL = { none: 'Cut', dissolve: 'Dissolve', fade: 'Fade', flash: 'Flash', glitch: 'Glitch', whip: 'Whip', punch: 'Punch', shake: 'Shake', wipe: 'Wipe', slide: 'Slide', push: 'Push', zoom: 'Zoom', circle: 'Circle', blur: 'Blur' };
export const LAYOUTS = [['single', 'Single'], ['wipe', 'Swipe'], ['split', 'Split'], ['lens', 'Magnifier'], ['blinds', 'Blinds'], ['diagonal', 'Diagonal'], ['polaroid', 'Polaroid']];
export const MOTIONS = ['none', 'zoomIn', 'zoomOut', 'smileZoom', 'panLeft', 'panRight'];
export const MOTION_LABEL = { none: 'Static', zoomIn: 'Zoom in', zoomOut: 'Zoom out', smileZoom: 'Smile zoom', panLeft: 'Pan left', panRight: 'Pan right' };
export const TEXT_ANIMS = ['pop', 'words', 'typewriter', 'slideUp', 'fade', 'zoom', 'none'];
export const ANIM_LABEL = { pop: 'Pop', words: 'Word by word', typewriter: 'Typewriter', slideUp: 'Slide up', fade: 'Fade', zoom: 'Zoom', none: 'None' };
export const LOOKS = {
  natural: { label: 'Natural' },
  bright: { label: 'Bright', brightness: 1.08, contrast: 1.05, saturate: 1.12 },
  glam: { label: 'Glam', brightness: 1.05, contrast: 1.08, saturate: 1.18, glow: true },
  warm: { label: 'Golden', warmth: 0.16, saturate: 1.06 },
  cool: { label: 'Clinic', warmth: -0.14, contrast: 1.06 },
  crisp: { label: 'Crisp', contrast: 1.16, saturate: 1.12 },
  film: { label: 'Film', contrast: 0.94, saturate: 0.84, warmth: 0.08, grain: true, vignette: true },
  mono: { label: 'Mono', saturate: 0, contrast: 1.18, grain: true },
};
export const FONTS = {
  modern: { f: 'Inter, system-ui, sans-serif', w: 800, label: 'Modern' },
  strong: { f: 'Anton, Impact, "Arial Black", sans-serif', w: 400, up: true, label: 'Strong', lh: 1.04 },
  classic: { f: '"Playfair Display", Georgia, serif', w: 700, label: 'Classic' },
  marker: { f: 'Caveat, "Segoe Print", cursive', w: 700, label: 'Marker', lh: 1.0 },
  type: { f: '"Courier New", ui-monospace, monospace', w: 700, label: 'Typewriter' },
};
export const TEXT_STYLES = ['classic', 'highlight', 'neon', 'outline'];

/** Assigns _start/_tr to clips (transitions overlap consecutive clips); returns total duration. */
export function layoutTimeline(p) {
  let t = 0;
  p.clips.forEach((c, i) => {
    c._start = t;
    const next = p.clips[i + 1];
    const want = c.transition && c.transition.type !== 'none' ? c.transition.dur : 0;
    c._tr = next ? Math.min(want, c.duration * 0.5, next.duration * 0.5) : 0;
    t += c.duration - c._tr;
  });
  const last = p.clips[p.clips.length - 1];
  const vEnd = last ? last._start + last.duration : 0;
  const oEnd = Math.max(0, ...p.overlays.map(o => o.start + o.duration));
  return Math.max(vEnd, Math.min(oEnd, vEnd || oEnd));
}

// ---------- small math helpers ----------
const backOut = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const noise = t => (Math.sin(t * 12.9898) + Math.sin(t * 7.13 + 1.7) * 0.6 + Math.sin(t * 23.71 + 4.1) * 0.3) / 1.9;
function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const fontOf = o => FONTS[o.font] || { f: o.font || FONTS.modern.f, w: o.weight || 800 };

function mergeFilter(f, look) {
  f = f || {};
  return {
    brightness: (f.brightness ?? 1) * (look.brightness ?? 1),
    contrast: (f.contrast ?? 1) * (look.contrast ?? 1),
    saturate: (f.saturate ?? 1) * (look.saturate ?? 1),
    warmth: (f.warmth ?? 0) + (look.warmth ?? 0),
  };
}
const filterStr = (f, blur = 0) => {
  const parts = [];
  if (f) {
    if (Math.abs(f.brightness - 1) > 0.005) parts.push(`brightness(${f.brightness.toFixed(3)})`);
    if (Math.abs(f.contrast - 1) > 0.005) parts.push(`contrast(${f.contrast.toFixed(3)})`);
    if (Math.abs(f.saturate - 1) > 0.005) parts.push(`saturate(${f.saturate.toFixed(3)})`);
  }
  if (blur > 0.3) parts.push(`blur(${blur.toFixed(1)}px)`);
  return parts.join(' ') || 'none';
};

let grainTiles = null;
function grain() {
  if (grainTiles) return grainTiles;
  grainTiles = [0, 1, 2].map(() => {
    const c = makeCanvas(160, 160), x = c.getContext('2d'), d = x.createImageData(160, 160);
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0);
    return c;
  });
  return grainTiles;
}

export class Engine {
  constructor(canvas, { scale = 0.5, onFrameReady, audio = true } = {}) {
    this.canvas = canvas;
    this.scale = scale;
    this.ctx = canvas.getContext('2d');
    this.media = new Map();
    this.images = new Map();
    this.videos = new Map();
    this.gains = new WeakMap();
    this.music = null;
    this.track = null; this.trackSrcs = null;
    this.hit = {};
    this.onFrameReady = onFrameReady;
    this.withAudio = audio;
    this.bufA = makeCanvas(2, 2); this.bufB = makeCanvas(2, 2);
    this.tmp = [];
  }

  // ----- audio graph: media elements + generated soundtrack -> master -> speakers + recorder stream
  audio() {
    if (!this.ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.gain.value = 0.8;
      // brick-wall-ish limiter so music + SFX + clip audio never clip
      const lim = this.ac.createDynamicsCompressor();
      lim.threshold.value = -4; lim.knee.value = 2; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.15;
      this.master.connect(lim);
      lim.connect(this.ac.destination);
      this.streamDest = this.ac.createMediaStreamDestination?.();
      if (this.streamDest) lim.connect(this.streamDest);
      this.musicGain = this.ac.createGain(); this.musicGain.connect(this.master);
      this.sfxGain = this.ac.createGain(); this.sfxGain.connect(this.master);
    }
    return this.ac;
  }
  route(el) {
    if (!this.withAudio) { el.muted = true; return; }
    try {
      const ac = this.audio();
      const src = ac.createMediaElementSource(el), g = ac.createGain();
      src.connect(g); g.connect(this.master);
      this.gains.set(el, g);
    } catch (e) { console.warn('audio route', e); }
  }
  setGain(el, v) {
    const g = this.gains.get(el);
    if (g) g.gain.value = v; else el.volume = clamp(v, 0, 1);
  }

  setSize(aspect) {
    const [W, H] = ASPECTS[aspect] || ASPECTS['9:16'];
    this.W = W; this.H = H;
    const pw = Math.round(W * this.scale), ph = Math.round(H * this.scale);
    for (const c of [this.canvas, this.bufA, this.bufB, ...this.tmp]) if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  }
  temp(i) {
    while (this.tmp.length <= i) this.tmp.push(makeCanvas(this.bufA.width, this.bufA.height));
    const c = this.tmp[i];
    if (c.width !== this.bufA.width || c.height !== this.bufA.height) { c.width = this.bufA.width; c.height = this.bufA.height; }
    return c;
  }

  /** Loads every media the project references and renders its soundtrack. Call after edits. */
  async prepare(p, { muted = false } = {}) {
    this.p = p;
    this.setSize(p.aspect);
    this.duration = layoutTimeline(p);
    const ids = new Set();
    p.clips.forEach(c => { c.mediaId && ids.add(c.mediaId); c.mediaId2 && ids.add(c.mediaId2); });
    if (p.audio?.mediaId) ids.add(p.audio.mediaId);
    if (p.watermark?.logoMediaId) ids.add(p.watermark.logoMediaId);
    for (const id of ids) {
      if (!this.media.has(id)) { const m = await getMedia(id); if (m) this.media.set(id, m); }
      const m = this.media.get(id);
      if (m?.kind === 'image' && !this.images.has(id)) this.images.set(id, await imageEl(m));
    }
    const live = new Set();
    for (const c of p.clips) {
      const m = this.media.get(c.mediaId);
      if (m?.kind !== 'video') continue;
      live.add(c.id);
      let v = this.videos.get(c.id);
      if (!v || v._mid !== m.id) {
        v?.pause();
        v = document.createElement('video');
        v._mid = m.id; v.playsInline = true; v.preload = 'auto'; v.muted = !this.withAudio;
        v.src = mediaURL(m);
        v.addEventListener('seeked', () => this.onFrameReady?.());
        v.addEventListener('loadeddata', () => this.onFrameReady?.());
        this.route(v);
        this.videos.set(c.id, v);
      }
    }
    for (const [id, v] of this.videos) if (!live.has(id)) { v.pause(); v.removeAttribute('src'); this.videos.delete(id); }
    const am = this.withAudio && p.audio?.mediaId && this.media.get(p.audio.mediaId);
    if (am) {
      if (this.music?.mediaId !== am.id) {
        this.music?.el.pause();
        const el = new Audio(); el.preload = 'auto'; el.src = mediaURL(am);
        this.route(el);
        this.music = { el, mediaId: am.id };
      }
    } else if (this.music) { this.music.el.pause(); this.music = null; }
    if (this.withAudio) {
      const tr = await renderSoundtrack(p, this.duration).catch(e => { console.warn('soundtrack', e); return null; });
      if (tr?.key !== this.track?.key) { this.stopTrack(); this.track = tr; }
    }
    this.muted = muted;
  }

  startTrack(t) {
    this.stopTrack();
    if (!this.track) return;
    const ac = this.audio();
    this.trackSrcs = [];
    for (const [buf, gain] of [[this.track.music, this.musicGain], [this.track.sfx, this.sfxGain]]) {
      if (!buf || t >= buf.duration) continue;
      const s = ac.createBufferSource(); s.buffer = buf; s.connect(gain);
      s.start(0, Math.max(0, t));
      this.trackSrcs.push(s);
    }
    this.trackT0 = ac.currentTime - t;
  }
  stopTrack() { this.trackSrcs?.forEach(s => { try { s.stop(); } catch { /* already stopped */ } }); this.trackSrcs = null; }

  /** Keeps video / music / soundtrack in step with timeline time t. */
  sync(t, playing) {
    const p = this.p;
    if (!p) return;
    for (const c of p.clips) {
      const v = this.videos.get(c.id);
      if (!v) continue;
      const speed = c.speed || 1;
      const active = t >= c._start && t < c._start + c.duration;
      const local = clamp((c.in || 0) + (t - c._start) * speed, 0, (v.duration || 1e9) - 0.05);
      if (active) {
        v.playbackRate = speed;
        const lt = t - c._start, edge = Math.min(1, lt / 0.3, (c.duration - lt) / Math.max(0.3, c._tr || 0.3));
        this.setGain(v, this.muted ? 0 : (c.volume ?? 1) * clamp(edge, 0, 1));
        if (playing) {
          if (v.paused) { v.currentTime = local; v.play().catch(() => {}); }
          else if (Math.abs(v.currentTime - local) > 0.3) v.currentTime = local;
        } else {
          if (!v.paused) v.pause();
          if (Math.abs(v.currentTime - local) > 0.03 && !v.seeking) v.currentTime = local;
        }
      } else {
        if (!v.paused) v.pause();
        if (t < c._start && c._start - t < 2 && Math.abs(v.currentTime - (c.in || 0)) > 0.05 && !v.seeking) v.currentTime = c.in || 0;
      }
    }
    if (this.music) {
      const a = p.audio, el = this.music.el, dur = el.duration || 0;
      const start = a.offset || 0, inPt = a.in || 0, end = Math.min(this.duration, start + (dur - inPt));
      const active = t >= start && t < end;
      const local = t - start + inPt;
      const g = (a.volume ?? 0.8) * clamp((t - start) / Math.max(0.01, a.fadeIn ?? 0.3), 0, 1) * clamp((end - t) / Math.max(0.01, a.fadeOut ?? 1.5), 0, 1);
      this.setGain(el, this.muted ? 0 : g);
      if (active && playing) {
        if (el.paused) { el.currentTime = local; el.play().catch(() => {}); }
        else if (Math.abs(el.currentTime - local) > 0.3) el.currentTime = local;
      } else if (!el.paused) el.pause();
    }
    if (this.track && this.ac) {
      const st = p.soundtrack || {};
      this.musicGain.gain.value = this.muted ? 0 : st.volume ?? 0.85;
      this.sfxGain.gain.value = this.muted ? 0 : st.sfxVolume ?? 0.9;
    }
    if (this.track && playing && this.withAudio) {
      const ac = this.audio();
      if (!this.trackSrcs) this.startTrack(t);
      else if (ac.state === 'running' && Math.abs(ac.currentTime - this.trackT0 - t) > 0.15) this.startTrack(t);
    } else if (!playing && this.trackSrcs) this.stopTrack();
  }

  stopAll() {
    for (const v of this.videos.values()) v.pause();
    this.music?.el.pause();
    this.stopTrack();
  }

  destroy() {
    this.stopAll();
    for (const v of this.videos.values()) v.removeAttribute('src');
    this.videos.clear();
    if (this.music) this.music.el.removeAttribute('src');
    this.ac?.close().catch(() => {});
  }

  // ================= drawing =================
  render(t) {
    const p = this.p;
    if (!p) return;
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = p.bg || '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    t = clamp(t, 0, Math.max(0, this.duration - 1e-3));
    this.t = t;
    const clips = p.clips;
    let i = clips.findIndex(c => t >= c._start && t < c._start + c.duration);
    if (i < 0 && clips.length) i = clips.length - 1;
    if (i >= 0) {
      const A = clips[i], B = clips[i + 1];
      if (B && A._tr > 0 && t >= B._start) {
        const raw = clamp((t - B._start) / A._tr, 0, 1);
        this.drawClip(this.bufA, A, t - A._start);
        this.drawClip(this.bufB, B, t - B._start);
        this.composite(A.transition.type, ['glitch', 'whip', 'punch'].includes(A.transition.type) ? raw : ease(raw));
      } else {
        this.drawClip(this.bufA, A, t - A._start);
        ctx.drawImage(this.bufA, 0, 0);
      }
    }
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.drawOverlays(t);
    this.drawWatermark();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  composite(type, q) {
    const { ctx, bufA: a, bufB: b } = this, W = this.canvas.width, H = this.canvas.height;
    ctx.save();
    switch (type) {
      case 'fade':
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = q < 0.5 ? 1 - q * 2 : q * 2 - 1;
        ctx.drawImage(q < 0.5 ? a : b, 0, 0); break;
      case 'flash':
        ctx.drawImage(q < 0.5 ? a : b, 0, 0);
        ctx.globalAlpha = q < 0.5 ? q * 2 : 2 - q * 2; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); break;
      case 'wipe':
        ctx.drawImage(a, 0, 0);
        ctx.beginPath(); ctx.rect(0, 0, W * q, H); ctx.clip(); ctx.drawImage(b, 0, 0); break;
      case 'slide':
        ctx.drawImage(a, -W * q, 0); ctx.drawImage(b, W * (1 - q), 0); break;
      case 'push':
        ctx.drawImage(a, 0, -H * q); ctx.drawImage(b, 0, H * (1 - q)); break;
      case 'zoom':
        ctx.drawImage(a, 0, 0);
        ctx.globalAlpha = q;
        ctx.translate(W / 2, H / 2); ctx.scale(1.25 - 0.25 * q, 1.25 - 0.25 * q); ctx.drawImage(b, -W / 2, -H / 2); break;
      case 'circle':
        ctx.drawImage(a, 0, 0);
        ctx.beginPath(); ctx.arc(W / 2, H / 2, q * Math.hypot(W, H) / 2, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(b, 0, 0); break;
      case 'blur':
        ctx.filter = `blur(${(q * 24 * this.scale).toFixed(1)}px)`; ctx.drawImage(a, 0, 0);
        ctx.globalAlpha = q; ctx.filter = `blur(${((1 - q) * 24 * this.scale).toFixed(1)}px)`; ctx.drawImage(b, 0, 0); break;
      case 'whip': {
        const e = ease(q), bl = Math.sin(Math.PI * q) * 26 * this.scale;
        ctx.filter = `blur(${bl.toFixed(1)}px)`;
        ctx.drawImage(a, -W * e * 1.05, 0); ctx.drawImage(b, W * (1 - e) * 1.05, 0); break;
      }
      case 'punch': {
        const src = q < 0.5 ? a : b, z = q < 0.5 ? 1 + q * 1.4 : 1.7 - (q - 0.5) * 1.4;
        ctx.filter = `blur(${(Math.sin(Math.PI * q) * 14 * this.scale).toFixed(1)}px)`;
        ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.drawImage(src, -W / 2, -H / 2);
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = 'none';
        ctx.globalAlpha = Math.max(0, 1 - Math.abs(q - 0.5) * 4) * 0.7; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); break;
      }
      case 'shake': {
        const amp = Math.sin(Math.PI * q) * W * 0.05;
        ctx.translate(noise(q * 40) * amp, noise(q * 37 + 5) * amp);
        ctx.drawImage(a, 0, 0); ctx.globalAlpha = q; ctx.drawImage(b, 0, 0); break;
      }
      case 'glitch': {
        const src = q < 0.5 ? a : b, k = 1 - Math.abs(q - 0.5) * 2;
        const t1 = this.temp(0), x = t1.getContext('2d');
        x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.filter = 'none';
        x.drawImage(src, 0, 0);
        this.rgbSplit(t1, W * 0.025 * k);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        const r = rng(Math.floor(q * 14) + 7);
        let y = 0;
        while (y < H) {
          const bh = H * (0.02 + r() * 0.1), off = (r() - 0.5) * W * 0.18 * k * (r() > 0.4 ? 1 : 0);
          ctx.drawImage(t1, 0, y, W, bh, off, y, W, bh);
          y += bh;
        }
        break;
      }
      default:
        ctx.drawImage(a, 0, 0); ctx.globalAlpha = q; ctx.drawImage(b, 0, 0);
    }
    ctx.restore();
  }

  /** Chromatic aberration on a canvas (in place). */
  rgbSplit(c, dx) {
    if (Math.abs(dx) < 0.5) return;
    const W = c.width, H = c.height;
    const chans = [['#f00', -dx], ['#0f0', 0], ['#00f', dx]].map(([col, off], i) => {
      const t = this.temp(i + 1), x = t.getContext('2d');
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.filter = 'none';
      x.globalCompositeOperation = 'source-over'; x.drawImage(c, 0, 0);
      x.globalCompositeOperation = 'multiply'; x.fillStyle = col; x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'source-over';
      return [t, off];
    });
    const x = c.getContext('2d');
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.filter = 'none';
    x.fillStyle = '#000'; x.globalCompositeOperation = 'source-over'; x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = 'lighter';
    chans.forEach(([t, off]) => x.drawImage(t, off, 0));
    x.restore();
  }

  srcOf(clip, which = 1) {
    const id = which === 1 ? clip.mediaId : clip.mediaId2;
    const m = this.media.get(id);
    if (!m) return null;
    if (m.kind === 'image') { const el = this.images.get(id); return el && { el, w: el.naturalWidth, h: el.naturalHeight, m }; }
    if (m.kind === 'video' && which === 1) { const el = this.videos.get(clip.id); return el && el.videoWidth ? { el, w: el.videoWidth, h: el.videoHeight, m } : null; }
    return null;
  }

  // mapping = image point (ix,iy) lands at canvas point (px,py), scaled by s, rotated by r
  baseMap(src, rect, clip, p) {
    const fit = clip.fit || 'cover';
    const cover = Math.max(rect.w / src.w, rect.h / src.h), contain = Math.min(rect.w / src.w, rect.h / src.h);
    let zoom = clip.zoom || 1, fx = src.w / 2, fy = src.h / 2, toward = 0;
    const f = focusOf(src.m);
    const e = ease(clamp(p, 0, 1));
    switch (clip.motion) {
      case 'zoomIn': zoom *= 1 + 0.18 * e; toward = e * 0.6; break;
      case 'zoomOut': zoom *= 1.18 - 0.18 * e; toward = (1 - e) * 0.6; break;
      case 'smileZoom': zoom *= 1 + 0.9 * easeOut(clamp(p * 1.15, 0, 1)); toward = easeOut(clamp(p * 1.3, 0, 1)); break;
      case 'panLeft': case 'panRight': zoom *= 1.2; break;
    }
    if (f && clip.focusSmile !== false) {
      const k = clip.motion === 'smileZoom' ? toward : Math.max(toward, zoom > 1.01 ? 0.7 : 0);
      fx = lerp(fx, f.x, k); fy = lerp(fy, f.y, k);
    }
    const s = (fit === 'contain' ? contain : cover) * zoom;
    const hx = rect.w / 2 / s, hy = rect.h / 2 / s;
    let ix = fx + (clip.offX || 0) * Math.max(0, src.w / 2 - hx), iy = fy + (clip.offY || 0) * Math.max(0, src.h / 2 - hy);
    if (clip.motion === 'panLeft' || clip.motion === 'panRight') {
      const span = Math.max(0, src.w / 2 - hx), dir = clip.motion === 'panLeft' ? 1 : -1;
      ix = src.w / 2 + dir * span * (e * 2 - 1);
    }
    if (fit !== 'contain') { ix = clamp(ix, Math.min(hx, src.w / 2), Math.max(src.w - hx, src.w / 2)); iy = clamp(iy, Math.min(hy, src.h / 2), Math.max(src.h - hy, src.h / 2)); }
    return { ix, iy, px: rect.x + rect.w / 2, py: rect.y + rect.h / 2, s, r: 0 };
  }

  /** Similarity transform that lines up B's smile/eyes with A's (AI auto-align). */
  alignMaps(a, b, mapA) {
    const fa = focusOf(a.m), fb = focusOf(b.m);
    if (!fa || !fb) return null;
    const P = { x: mapA.px + mapA.s * (fa.x - mapA.ix), y: mapA.py + mapA.s * (fa.y - mapA.iy) };
    const level = Math.abs(fa.angle) > 0.004 ? 1.04 : 1;
    return [
      { ix: fa.x, iy: fa.y, px: P.x, py: P.y, s: mapA.s * level, r: -fa.angle },
      { ix: fb.x, iy: fb.y, px: P.x, py: P.y, s: mapA.s * level * (fa.ref / fb.ref), r: -fb.angle },
    ];
  }
  pairMaps(a, b, clip, rect, prog) {
    const mapA = this.baseMap(a, rect, clip, prog);
    return (clip.align !== false && this.alignMaps(a, b, mapA)) || [mapA, this.baseMap(b, rect, clip, prog)];
  }
  /** Canvas position + radius of the smile of `src` drawn with `map` (for sparkles / lens). */
  smileAt(src, map) {
    const f = src?.m?.meta?.face;
    if (!f) return null;
    const x = f.mouth.x * src.w - map.ix, y = f.mouth.y * src.h - map.iy, c = Math.cos(map.r), s = Math.sin(map.r);
    return { x: map.px + map.s * (x * c - y * s), y: map.py + map.s * (x * s + y * c), r: Math.max(20, (f.mouthBox.x1 - f.mouthBox.x0) * src.w * map.s / 2) };
  }

  drawMapped(ctx, src, map, rect, filter, blur = 0) {
    ctx.save();
    ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
    ctx.filter = filterStr(filter, blur * this.scale);
    ctx.translate(map.px, map.py); ctx.rotate(map.r); ctx.scale(map.s, map.s);
    ctx.drawImage(src.el, -map.ix, -map.iy);
    ctx.restore();
    const w = filter?.warmth || 0;
    if (Math.abs(w) > 0.01) {
      ctx.save();
      ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = Math.min(1, Math.abs(w) * 1.6);
      ctx.fillStyle = w > 0 ? '#ff9a3c' : '#3c8cff';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    }
  }

  drawClip(buf, clip, lt) {
    const ctx = buf.getContext('2d'), { W, H } = this, p = this.p;
    const S = this.scale;
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
    const abs = clip._start + lt;
    const prog = clip.duration ? clamp(lt / clip.duration, 0, 1) : 0;
    const fx = clip.fx || {};
    const look = LOOKS[p.look] || LOOKS.natural;
    const F1 = mergeFilter(clip.filter, look), F2 = mergeFilter(clip.filter2 || clip.filter, look);
    ctx.fillStyle = clip.kind === 'solid' ? clip.color || '#0f172a' : p.bg || '#000';
    ctx.fillRect(0, 0, W, H);
    this.focusPt = null;

    // camera moves: beat pulse + shake
    let z = 1, sx = 0, sy = 0, rot = 0;
    if (fx.pulse) { const beat = 60 / (p.bpm || 120), ph = (((abs - (p.beatOffset || 0)) / beat) % 1 + 1) % 1; z = 1 + 0.05 * Math.exp(-ph * 6); }
    if (fx.shake) {
      const envl = fx.shakeIn ? Math.max(0, 1 - lt / 0.7) : 0.35 + 0.65 * prog;
      const a = fx.shake * envl * W * 0.022;
      sx = noise(abs * 31) * a; sy = noise(abs * 27 + 9) * a; rot = noise(abs * 19 + 3) * 0.02 * fx.shake * envl;
    }
    ctx.save();
    if (z !== 1 || sx || sy || rot) { ctx.translate(W / 2 + sx, H / 2 + sy); ctx.rotate(rot); ctx.scale(z * (rot ? 1.03 : 1), z * (rot ? 1.03 : 1)); ctx.translate(-W / 2, -H / 2); }
    this.drawLayout(ctx, clip, prog, lt, F1, F2);
    ctx.restore();

    // ---- post effects (logical coords)
    if (fx.sparkle) this.drawSparkles(ctx, abs, lt);
    if (look.glow || fx.glow) this.bloom(buf);
    if (fx.rgbIn && lt < 0.5) this.rgbSplit(buf, (1 - lt / 0.5) * W * 0.02 * S);
    ctx.setTransform(S, 0, 0, S, 0, 0);
    if (look.vignette || fx.vignette) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.62)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (look.grain || fx.grain) {
      const tiles = grain(), tile = tiles[Math.floor(abs * 24) % 3];
      ctx.save();
      ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.16;
      ctx.fillStyle = ctx.createPattern(tile, 'repeat');
      ctx.translate((abs * 997) % 160, (abs * 613) % 160);
      ctx.fillRect(-160, -160, W + 320, H + 320);
      ctx.restore();
    }
    if (fx.letterbox) {
      const bh = H * 0.1 * easeOut(clamp(lt / 0.6, 0, 1));
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, bh); ctx.fillRect(0, H - bh, W, bh);
    }
    if (clip.tag) this.label(ctx, clip.tag, W * 0.05, H * 0.07, 'left', clamp(lt / 0.15, 0, 1), p.accent || '#14b8a6');
    const fl = Math.min(0.45, clip.duration * 0.35);
    if (fx.flashIn && lt < fl) { ctx.fillStyle = `rgba(255,255,255,${(0.9 * Math.pow(1 - lt / fl, 2)).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
  }

  drawLayout(ctx, clip, prog, lt, F1, F2) {
    const { W, H } = this, p = this.p;
    const full = { x: 0, y: 0, w: W, h: H };
    const st = p.style || {}, accent = p.accent || '#14b8a6';
    if (clip.kind === 'solid') {
      if (clip.gradient) {
        const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
        g.addColorStop(0, clip.color || '#0f172a'); g.addColorStop(1, clip.color2 || accent);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        // soft moving light
        const lx = W * (0.3 + 0.4 * Math.sin(lt * 0.8)), rg = ctx.createRadialGradient(lx, H * 0.3, 0, lx, H * 0.3, W * 0.9);
        rg.addColorStop(0, 'rgba(255,255,255,.14)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      }
      return;
    }
    const a = this.srcOf(clip, 1);
    if (!a) { this.placeholder(ctx, full, clip); return; }
    const layout = clip.layout || 'single';
    const b = layout !== 'single' ? this.srcOf(clip, 2) : null;

    if (layout === 'single' || !b) {
      if (clip.fit === 'contain' && clip.blurFill !== false) this.drawMapped(ctx, a, this.baseMap(a, full, { fit: 'cover' }, 0), full, F1, 40);
      const m = this.baseMap(a, full, clip, prog);
      this.drawMapped(ctx, a, m, full, F1);
      this.focusPt = this.smileAt(a, m);
      return;
    }
    const labels = clip.labels !== false;
    const LB = st.labelBefore || 'BEFORE', LA = st.labelAfter || 'AFTER';

    if (layout === 'wipe' || layout === 'diagonal') {
      const [mA, mB] = this.pairMaps(a, b, clip, full, layout === 'diagonal' ? prog : 0);
      const f = layout === 'wipe'
        ? (prog < 0.18 ? 1 : prog < 0.55 ? 1 - ease((prog - 0.18) / 0.37) : prog < 0.75 ? 0.5 * ease((prog - 0.55) / 0.2) : 0.5)
        : (prog < 0.15 ? 1 : prog < 0.55 ? 1 - 1.12 * ease((prog - 0.15) / 0.4) : prog < 0.8 ? -0.12 + 0.62 * ease((prog - 0.55) / 0.25) : 0.5);
      this.drawMapped(ctx, b, mB, full, F2);
      this.focusPt = this.smileAt(b, mB);
      ctx.save();
      if (layout === 'wipe') {
        const x = W * f;
        if (x > 0.5) this.drawMapped(ctx, a, mA, { x: 0, y: 0, w: x, h: H }, F1);
        ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 18;
        ctx.fillRect(x - 3, 0, 6, H);
        const r = Math.min(W, H) * 0.045;
        ctx.beginPath(); ctx.arc(x, H * 0.5, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0; ctx.strokeStyle = accent; ctx.lineWidth = r * 0.16; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.2, H / 2 - r * 0.35); ctx.lineTo(x - r * 0.55, H / 2); ctx.lineTo(x - r * 0.2, H / 2 + r * 0.35);
        ctx.moveTo(x + r * 0.2, H / 2 - r * 0.35); ctx.lineTo(x + r * 0.55, H / 2); ctx.lineTo(x + r * 0.2, H / 2 + r * 0.35);
        ctx.stroke();
      } else {
        const slope = 0.32, xm = lerp(-0.3 * W, 1.3 * W, f);
        const x0 = xm - (H / 2) * slope, x1 = xm + (H / 2) * slope;
        ctx.save();
        ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(x0, -10); ctx.lineTo(x1, H + 10); ctx.lineTo(-10, H + 10); ctx.closePath(); ctx.clip();
        this.drawMapped(ctx, a, mA, full, F1);
        ctx.restore();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.shadowColor = accent; ctx.shadowBlur = 40;
        ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x1, H); ctx.stroke(); ctx.stroke();
      }
      ctx.restore();
      if (labels) {
        this.label(ctx, LB, W * 0.05, H * 0.07, 'left', clamp(f * 4 - 0.2, 0, 1), accent);
        this.label(ctx, LA, W * 0.95, H * 0.07, 'right', clamp((1 - f) * 4 - 0.2, 0, 1), accent);
      }
      return;
    }

    if (layout === 'lens') {
      const [mA, mB] = this.pairMaps(a, b, clip, full, prog);
      this.drawMapped(ctx, a, mA, full, F1);
      const f = this.smileAt(a, mA) || { x: W / 2, y: H * 0.55, r: W * 0.18 };
      const R0 = Math.min(W, H) * 0.21, mw = Math.max(f.r, W * 0.12);
      const tt = ease(clamp((prog - 0.06) / 0.62, 0, 1));
      const e = ease(clamp((prog - 0.72) / 0.2, 0, 1));
      const cx = lerp(f.x - mw * Math.cos(tt * Math.PI * 1.5), W / 2, e), cy = lerp(f.y + Math.sin(tt * Math.PI * 3) * mw * 0.12, H / 2, e);
      const R = lerp(R0 * clamp(prog / 0.06, 0.2, 1), Math.hypot(W, H) * 0.6, e), mag = lerp(1.32, 1, e);
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      ctx.translate(cx, cy); ctx.scale(mag, mag); ctx.translate(-cx, -cy);
      this.drawMapped(ctx, b, mB, { x: -W, y: -H, w: W * 3, h: H * 3 }, F2);
      ctx.restore();
      this.focusPt = e > 0.5 ? this.smileAt(b, mB) : null;
      if (e < 1) {
        ctx.save();
        ctx.globalAlpha = 1 - e;
        ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 30;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = R0 * 0.07;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = R0 * 0.035;
        ctx.beginPath(); ctx.arc(cx, cy, R * 0.82, Math.PI * 1.1, Math.PI * 1.45); ctx.stroke();
        ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = R0 * 0.16;
        ctx.beginPath(); ctx.moveTo(cx + R * 0.74, cy + R * 0.74); ctx.lineTo(cx + R * 1.32, cy + R * 1.32); ctx.stroke();
        ctx.strokeStyle = accent; ctx.lineWidth = R0 * 0.1; ctx.stroke();
        ctx.restore();
      }
      if (labels) {
        this.label(ctx, LB, W * 0.05, H * 0.07, 'left', clamp(1 - e * 2, 0, 1), accent);
        this.label(ctx, LA, W * 0.95, H * 0.07, 'right', clamp(e * 2, 0, 1), accent);
      }
      return;
    }

    if (layout === 'blinds') {
      const [mA, mB] = this.pairMaps(a, b, clip, full, prog);
      const N = 7, sw = W / N;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      let shownB = 0;
      for (let i = 0; i < N; i++) {
        const f = ease(clamp((prog - 0.12 - i * 0.045) / 0.22, 0, 1));
        const useB = f >= 0.5, sc = useB ? (f - 0.5) * 2 : 1 - f * 2;
        if (useB) shownB++;
        const x0 = i * sw, cxs = x0 + sw / 2;
        ctx.save();
        ctx.translate(cxs, 0); ctx.scale(Math.max(0.002, sc), 1); ctx.translate(-cxs, 0);
        this.drawMapped(ctx, useB ? b : a, useB ? mB : mA, { x: x0, y: 0, w: sw + 1, h: H }, useB ? F2 : F1);
        if (sc < 1) { ctx.fillStyle = `rgba(0,0,0,${((1 - sc) * 0.6).toFixed(3)})`; ctx.fillRect(x0, 0, sw + 1, H); }
        ctx.restore();
      }
      if (shownB === N) this.focusPt = this.smileAt(b, mB);
      if (labels) {
        this.label(ctx, LB, W * 0.05, H * 0.07, 'left', clamp(1 - shownB / 3, 0, 1), accent);
        this.label(ctx, LA, W * 0.95, H * 0.07, 'right', clamp((shownB - 4) / 3, 0, 1), accent);
      }
      return;
    }

    if (layout === 'polaroid') {
      this.drawMapped(ctx, b, this.baseMap(b, full, { fit: 'cover' }, 0), full, F2, 34);
      ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.fillRect(0, 0, W, H);
      const cw = Math.min(W, H) * 0.64, ph = cw * 0.88, m = cw * 0.06, ch = m + ph + cw * 0.24;
      const card = (src, F, t0, tx, ty, rotEnd, caption) => {
        const d = (prog - t0) / 0.16;
        if (d <= 0) return;
        const e = backOut(clamp(d, 0, 1)), y = lerp(-ch, ty, e), r = (rotEnd * (1 + 2 * (1 - clamp(d, 0, 1)))) * Math.PI / 180;
        ctx.save();
        ctx.translate(tx, y); ctx.rotate(r);
        ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
        ctx.fillStyle = '#fbfaf7'; ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
        ctx.shadowColor = 'transparent';
        const rect = { x: -cw / 2 + m, y: -ch / 2 + m, w: cw - 2 * m, h: ph };
        const hasFace = !!src.m.meta?.face;
        this.drawMapped(ctx, src, this.baseMap(src, rect, { fit: 'cover', zoom: hasFace ? 1.5 : 1, motion: 'none' }, 0), rect, F);
        ctx.fillStyle = '#1f2937'; ctx.font = `700 ${Math.round(cw * 0.1)}px ${FONTS.marker.f}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(caption, 0, rect.y + ph + (ch / 2 - (rect.y + ph)) / 2 + cw * 0.005);
        // flash on landing
        const fl = clamp(1 - (d - 0.62) / 0.3, 0, 1) * (d > 0.62 ? 1 : 0);
        if (fl > 0) { ctx.fillStyle = `rgba(255,255,255,${(fl * 0.8).toFixed(3)})`; ctx.fillRect(-cw / 2, -ch / 2, cw, ch); }
        ctx.restore();
      };
      const cap = s => s.charAt(0) + s.slice(1).toLowerCase();
      card(a, F1, 0.04, W * 0.4, H * 0.34, -7, cap(LB));
      card(b, F2, 0.42, W * 0.6, H * 0.64, 6, cap(LA));
      return;
    }

    // split: stacked for portrait formats, side by side otherwise
    const gap = Math.round(Math.min(W, H) * 0.008);
    const vertical = H > W * 1.1;
    const ra = vertical ? { x: 0, y: 0, w: W, h: H / 2 - gap } : { x: 0, y: 0, w: W / 2 - gap, h: H };
    const rb = vertical ? { x: 0, y: H / 2 + gap, w: W, h: H / 2 - gap } : { x: W / 2 + gap, y: 0, w: W / 2 - gap, h: H };
    const sm = { ...clip, motion: clip.motion === 'smileZoom' ? 'zoomIn' : clip.motion };
    const mapA = this.baseMap(a, ra, sm, prog);
    let mapB = this.baseMap(b, rb, sm, prog);
    const fa = focusOf(a.m), fb = focusOf(b.m);
    if (clip.align !== false && fa && fb) {
      mapB = { ...mapB, s: Math.max(mapB.s / (clip.zoom || 1) / 1.0001, mapA.s * fa.ref / fb.ref), r: -fb.angle, ix: fb.x, iy: fb.y };
      mapB.px = rb.x + (mapA.px - ra.x) + mapA.s * (fa.x - mapA.ix); mapB.py = rb.y + (mapA.py - ra.y) + mapA.s * (fa.y - mapA.iy);
    }
    ctx.fillStyle = accent; ctx.fillRect(0, 0, W, H);
    this.drawMapped(ctx, a, mapA, ra, F1);
    this.drawMapped(ctx, b, mapB, rb, F2);
    this.focusPt = this.smileAt(b, mapB);
    if (labels) {
      const al = clamp(lt / 0.5, 0, 1);
      this.label(ctx, LB, ra.x + ra.w * 0.05, ra.y + Math.min(ra.h, ra.w) * 0.08, 'left', al, accent);
      this.label(ctx, LA, rb.x + rb.w * 0.05, rb.y + Math.min(rb.h, rb.w) * 0.08, 'left', al, accent);
    }
  }

  drawSparkles(ctx, abs, lt) {
    const { W, H } = this;
    const f = this.focusPt || { x: W / 2, y: H * 0.56, r: W * 0.16 };
    const fade = clamp((lt - 0.15) / 0.4, 0, 1);
    if (fade <= 0) return;
    const r = rng(77);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2 + r() * 0.6, dist = 1.15 + r() * 0.45, sz = (0.45 + r() * 0.8) * Math.min(W, H) * 0.026, sp = 0.9 + r() * 1.4;
      const ph = (abs * sp + r()) % 1, a = Math.pow(Math.sin(ph * Math.PI), 3) * fade;
      if (a < 0.02) continue;
      const x = f.x + Math.cos(ang) * f.r * dist, y = f.y + Math.sin(ang) * f.r * dist * 0.62;
      const R = sz * (0.6 + 0.6 * a);
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ph * 0.8);
      ctx.globalAlpha = a;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.6);
      g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(0.25, 'rgba(255,255,255,.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(-R * 1.6, -R * 1.6, R * 3.2, R * 3.2);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const rr = i % 2 ? R * 0.16 : R * 1.25, an = (i / 8) * Math.PI * 2; ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  bloom(buf) {
    const t = this.temp(4), x = t.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    x.filter = `blur(${(18 * this.scale).toFixed(1)}px) brightness(1.15)`;
    x.clearRect(0, 0, t.width, t.height);
    x.drawImage(buf, 0, 0); x.filter = 'none';
    const c = buf.getContext('2d');
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'screen'; c.globalAlpha = 0.32; c.drawImage(t, 0, 0); c.restore();
  }

  placeholder(ctx, r, clip) {
    ctx.fillStyle = '#1e293b'; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#64748b'; ctx.font = `600 ${Math.round(this.W * 0.035)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(clip.mediaId ? 'Loading…' : 'Missing media', r.x + r.w / 2, r.y + r.h / 2);
  }

  label(ctx, text, x, y, align, alpha, accent) {
    if (alpha <= 0) return;
    const size = Math.round(Math.min(this.W, this.H) * 0.042);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width, padX = size * 0.7, bh = size * 1.8;
    const bx = align === 'right' ? x - tw - padX * 2 : x;
    ctx.fillStyle = 'rgba(15,23,42,.62)';
    roundRect(ctx, bx, y - bh / 2, tw + padX * 2, bh, bh / 2); ctx.fill();
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(bx + padX * 0.75, y, size * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    ctx.fillText(text, bx + padX * 1.15, y + 1);
    ctx.restore();
  }

  // ================= overlays (text & stickers) =================
  drawOverlays(t) {
    const { ctx } = this;
    this.hit = {};
    for (const o of this.p.overlays) {
      const lt = t - o.start;
      if (lt < 0 || lt > o.duration) continue;
      ctx.save();
      const fn = this['ov_' + (o.kind || 'text')];
      if (fn) { const box = fn.call(this, ctx, o, lt); if (box) this.hit[o.id] = box; }
      ctx.restore();
    }
  }

  ov_text(ctx, o, lt) {
    const { W, H } = this;
    const F = fontOf(o);
    const raw = o.text || '';
    const txt = F.up || o.upper ? raw.toUpperCase() : raw;
    const ain = clamp(lt / 0.4, 0, 1), aout = clamp((o.duration - lt) / 0.3, 0, 1);
    let alpha = Math.min(easeOut(ain), easeOut(aout)), dy = 0, sc = 1;
    const anim = o.anim || 'fade';
    if (anim === 'slideUp') dy = (1 - easeOut(ain)) * H * 0.04;
    else if (anim === 'pop') { sc = 0.55 + 0.45 * backOut(ain); alpha = Math.min(ain * 3, 1) * easeOut(aout); }
    else if (anim === 'zoom') sc = 1 + 0.25 * (1 - easeOut(ain));
    else if (anim === 'none') alpha = 1;
    else if (anim === 'words' || anim === 'typewriter') alpha = easeOut(aout);
    const size = o.size || 72;
    ctx.font = `${F.w} ${size}px ${F.f}`;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    if (o.spacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${o.spacing}px`;
    const lh = size * (F.lh || 1.16) * (o.style === 'highlight' ? 1.18 : 1);
    const space = ctx.measureText(' ').width;
    const lines = txt.split('\n').map(l => {
      const words = l.split(' ').filter((w, i, arr) => w || arr.length === 1).map(w => ({ w, width: ctx.measureText(w).width }));
      const width = words.reduce((s, w) => s + w.width, 0) + space * Math.max(0, words.length - 1);
      return { words, width };
    });
    const tw = Math.max(1, ...lines.map(l => l.width));
    const padX = size * 0.42, padY = size * 0.2;
    const bw = tw + padX * 2, bh = lines.length * lh + padY * 2;
    const cx = (o.x ?? 0.5) * W, cy = (o.y ?? 0.5) * H + dy;
    sc *= Math.min(1, (W * 0.92) / bw); // never overflow the frame (long clinic names…)
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy); ctx.scale(sc, sc);
    // reveal schedule
    const totalChars = txt.replace(/\n/g, '').length || 1;
    const shown = anim === 'typewriter' ? Math.floor(totalChars * clamp(lt / Math.max(0.6, totalChars * 0.045), 0, 1)) : Infinity;
    let wi = 0, ci = 0;
    const style = o.style || 'classic';
    const col = o.color || '#fff', bgc = o.bgColor || 'rgba(15,23,42,.72)';
    if (style === 'classic' && o.bg && o.bg !== 'none') {
      ctx.fillStyle = bgc;
      roundRect(ctx, -bw / 2, -bh / 2, bw, bh, o.bg === 'pill' ? bh / 2 : size * 0.25); ctx.fill();
    }
    lines.forEach((ln, li) => {
      const y = (li - (lines.length - 1) / 2) * lh;
      let x = -ln.width / 2;
      if (style === 'highlight' && ln.width > 0) {
        const lineAlpha = anim === 'words' ? clamp((lt - wi * 0.13) / 0.2, 0, 1) : anim === 'typewriter' ? (ci < shown ? 1 : 0) : 1;
        if (lineAlpha > 0) {
          ctx.save(); ctx.globalAlpha = alpha * lineAlpha; ctx.fillStyle = bgc;
          roundRect(ctx, x - padX * 0.7, y - lh / 2 + size * 0.04, ln.width + padX * 1.4, lh - size * 0.02, size * 0.22); ctx.fill();
          ctx.restore();
        }
      }
      for (const wd of ln.words) {
        let s = wd.w, wa = 1, ws = 1;
        if (anim === 'words') { const k = clamp((lt - wi * 0.13) / 0.22, 0, 1); wa = Math.min(1, k * 2); ws = 0.4 + 0.6 * backOut(k); }
        if (anim === 'typewriter') { const left = shown - ci; s = left <= 0 ? '' : wd.w.slice(0, left); }
        ci += wd.w.length; wi++;
        if (s && wa > 0) {
          ctx.save();
          ctx.globalAlpha = alpha * wa;
          ctx.translate(x + wd.width / 2, y); ctx.scale(ws, ws); ctx.translate(-wd.width / 2, 0);
          this.paintWord(ctx, s, size, style, col, bgc);
          ctx.restore();
        }
        x += wd.width + space;
      }
    });
    return { x: cx - (bw / 2) * sc, y: cy - (bh / 2) * sc, w: bw * sc, h: bh * sc };
  }
  paintWord(ctx, s, size, style, col, bgc) {
    if (style === 'neon') {
      ctx.shadowColor = col; ctx.shadowBlur = size * 0.55; ctx.fillStyle = col;
      ctx.fillText(s, 0, 0); ctx.fillText(s, 0, 0);
      ctx.shadowBlur = size * 0.12; ctx.fillStyle = '#fff'; ctx.globalAlpha *= 0.85; ctx.fillText(s, 0, 0);
    } else if (style === 'outline') {
      ctx.lineJoin = 'round'; ctx.strokeStyle = bgc && bgc.startsWith('rgba(15') ? '#000' : bgc; ctx.lineWidth = size * 0.16;
      ctx.strokeText(s, 0, 0); ctx.fillStyle = col; ctx.fillText(s, 0, 0);
    } else if (style === 'highlight') {
      ctx.fillStyle = col; ctx.fillText(s, 0, 0);
    } else {
      ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = size * 0.32; ctx.shadowOffsetY = size * 0.04;
      ctx.fillStyle = col; ctx.fillText(s, 0, 0);
    }
  }

  popScale(o, lt) { return { s: backOut(clamp(lt / 0.35, 0, 1)), a: clamp(lt / 0.12, 0, 1) * clamp((o.duration - lt) / 0.3, 0, 1) }; }

  ov_loading(ctx, o, lt) {
    const { W, H } = this, accent = this.p.accent || '#14b8a6';
    const sc = o.size || 1, cw = W * 0.74 * sc, ch = cw * 0.3, cx = (o.x ?? 0.5) * W, cy = (o.y ?? 0.72) * H;
    const { s, a } = this.popScale(o, lt);
    const v = loadingProgress(lt / (o.duration * 0.92));
    ctx.globalAlpha = a; ctx.translate(cx, cy); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(10,12,20,.62)'; roundRect(ctx, -cw / 2, -ch / 2, cw, ch, ch * 0.28); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2; ctx.stroke();
    const fs = cw * 0.06;
    ctx.font = `700 ${fs}px Inter, system-ui, sans-serif`; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    const done = v >= 1;
    ctx.fillText(done ? '✓ ' + (o.doneText || 'Complete!') : o.text || 'Loading…', -cw / 2 + cw * 0.07, -ch * 0.17);
    ctx.textAlign = 'right'; ctx.fillStyle = done ? '#5eead4' : '#fff';
    ctx.fillText(Math.round(v * 100) + '%', cw / 2 - cw * 0.07, -ch * 0.17);
    const tx = -cw / 2 + cw * 0.07, tw = cw * 0.86, ty = ch * 0.17, th = ch * 0.16;
    ctx.fillStyle = 'rgba(255,255,255,.16)'; roundRect(ctx, tx, ty - th / 2, tw, th, th / 2); ctx.fill();
    if (v > 0) {
      const g = ctx.createLinearGradient(tx, 0, tx + tw, 0);
      g.addColorStop(0, accent); g.addColorStop(1, '#a7f3d0');
      ctx.fillStyle = g; roundRect(ctx, tx, ty - th / 2, Math.max(th, tw * v), th, th / 2); ctx.fill();
      const shx = tx + ((lt * 0.9) % 1) * tw * v;
      ctx.save(); ctx.beginPath(); roundRect(ctx, tx, ty - th / 2, Math.max(th, tw * v), th, th / 2); ctx.clip();
      const sg = ctx.createLinearGradient(shx - th * 3, 0, shx + th * 3, 0);
      sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,.55)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg; ctx.fillRect(shx - th * 3, ty - th / 2, th * 6, th); ctx.restore();
    }
    return { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch };
  }

  ov_rating(ctx, o, lt) {
    const { W, H } = this, accent = this.p.accent || '#14b8a6';
    const sc = o.size || 1, cw = W * 0.68 * sc, ch = cw * 0.42, cx = (o.x ?? 0.5) * W, cy = (o.y ?? 0.75) * H;
    const { s, a } = this.popScale(o, lt);
    ctx.globalAlpha = a; ctx.translate(cx, cy); ctx.scale(s, s);
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fff'; roundRect(ctx, -cw / 2, -ch / 2, cw, ch, ch * 0.2); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#0f172a'; ctx.font = `800 ${cw * 0.072}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(o.text || 'Rate this smile 1–10', 0, -ch * 0.18);
    const tx = -cw * 0.4, tw = cw * 0.8, ty = ch * 0.2, th = ch * 0.09;
    const g = ctx.createLinearGradient(tx, 0, tx + tw, 0);
    g.addColorStop(0, accent); g.addColorStop(0.55, '#f472b6'); g.addColorStop(1, '#f59e0b');
    ctx.fillStyle = 'rgba(15,23,42,.1)'; roundRect(ctx, tx, ty - th / 2, tw, th, th / 2); ctx.fill();
    const v = 0.93 * easeOut(clamp((lt - 0.35) / 1.3, 0, 1));
    ctx.fillStyle = g; roundRect(ctx, tx, ty - th / 2, Math.max(th, tw * v), th, th / 2); ctx.fill();
    ctx.font = `${cw * 0.13}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillText(o.emoji || '😍', tx + tw * v, ty + 2);
    return { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch };
  }

  ov_countdown(ctx, o, lt) {
    const { W, H } = this, accent = this.p.accent || '#14b8a6';
    const items = (o.text || '3,2,1').split(','), per = o.duration / items.length;
    const idx = Math.min(items.length - 1, Math.floor(lt / per)), l = (lt - idx * per) / per;
    const R = Math.min(W, H) * 0.17 * (o.size || 1), cx = (o.x ?? 0.5) * W, cy = (o.y ?? 0.5) * H;
    const sc = 1.5 - 0.5 * easeOut(clamp(l / 0.25, 0, 1)), a = clamp(l / 0.08, 0, 1) * clamp((1 - l) / 0.15, 0, 1);
    ctx.globalAlpha = a; ctx.translate(cx, cy); ctx.scale(sc, sc);
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = R * 0.08; ctx.stroke();
    ctx.strokeStyle = accent; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * l); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `400 ${R * 1.25}px ${FONTS.strong.f}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = R * 0.2;
    ctx.fillText(items[idx].trim(), 0, R * 0.05);
    return { x: cx - R, y: cy - R, w: R * 2, h: R * 2 };
  }

  ov_emoji(ctx, o, lt) {
    const { W, H } = this;
    const size = o.size || 160, { s, a } = this.popScale(o, lt);
    const cx = (o.x ?? 0.5) * W, cy = (o.y ?? 0.5) * H + Math.sin(lt * 2.4) * size * 0.06;
    ctx.globalAlpha = a; ctx.translate(cx, cy); ctx.rotate(Math.sin(lt * 3.2) * 0.1); ctx.scale(s, s);
    ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = size * 0.15;
    ctx.fillText(o.text || '😍', 0, 0);
    return { x: cx - size * 0.6, y: cy - size * 0.6, w: size * 1.2, h: size * 1.2 };
  }

  ov_confetti(ctx, o, lt) {
    const { W, H } = this, r = rng(hash(o.id)), g = H * 1.5;
    const cols = ['#5eead4', '#f472b6', '#facc15', '#60a5fa', '#ffffff', '#a78bfa', this.p.accent || '#14b8a6'];
    const fadeA = clamp((o.duration - lt) / 0.6, 0, 1);
    for (let i = 0; i < 150; i++) {
      const left = i % 2 === 0, delay = r() * 0.25;
      const t = lt - delay;
      const ang = (left ? -1 : 1) * (0.25 + r() * 0.5) + (left ? 0 : 0) , speed = H * (0.9 + r() * 0.9);
      const sw = W * (0.012 + r() * 0.01), spin = (r() - 0.5) * 18, flip = 4 + r() * 8, col = cols[Math.floor(r() * cols.length)];
      if (t < 0) continue;
      const vx = Math.sin(ang) * speed * 0.55, vy = -Math.cos(ang) * speed * 1.25;
      const x = (left ? W * 0.04 : W * 0.96) + vx * t * (1 - Math.min(0.5, t * 0.25)), y = H * 1.02 + vy * t + 0.5 * g * t * t * 0.55;
      if (y > H * 1.1 && t > 0.5) continue;
      ctx.save();
      ctx.globalAlpha = fadeA;
      ctx.translate(x, y); ctx.rotate(spin * t); ctx.scale(1, Math.cos(flip * t));
      ctx.fillStyle = col; ctx.fillRect(-sw / 2, -sw * 0.3, sw, sw * 0.6);
      ctx.restore();
    }
    return null;
  }

  ov_cta(ctx, o, lt) {
    const { W, H } = this, accent = this.p.accent || '#14b8a6';
    const { s, a } = this.popScale(o, lt);
    const size = (o.size || 1) * W * 0.05, cx = (o.x ?? 0.5) * W, cy = (o.y ?? 0.7) * H;
    const pulse = 1 + 0.035 * Math.sin(lt * 6);
    ctx.globalAlpha = a; ctx.translate(cx, cy); ctx.scale(s * pulse, s * pulse);
    ctx.font = `800 ${size}px Inter, system-ui, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    const label = (o.text || 'Book your consultation') + '  →';
    const tw = ctx.measureText(label).width, bw = tw + size * 1.6, bh = size * 2.2;
    ctx.shadowColor = accent; ctx.shadowBlur = size * 0.8;
    ctx.fillStyle = accent; roundRect(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#fff'; ctx.fillText(label, 0, 2);
    if (o.sub) { ctx.font = `600 ${size * 0.72}px Inter, system-ui, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillText(o.sub, 0, bh / 2 + size * 0.9); }
    return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh + (o.sub ? size * 1.4 : 0) };
  }

  ov_tag(ctx, o, lt) {
    const { W, H } = this, accent = this.p.accent || '#14b8a6';
    const { s, a } = this.popScale(o, lt);
    const size = (o.size || 1) * W * 0.042, cx = (o.x ?? 0.5) * W, cy = (o.y ?? 0.55) * H;
    ctx.globalAlpha = a; ctx.translate(cx, cy); ctx.scale(s, s);
    ctx.font = `800 ${size}px Inter, system-ui, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const label = o.text || '@yourclinic';
    const tw = ctx.measureText(label).width, bh = size * 1.9, bw = tw + size * 2.2;
    ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 16;
    ctx.fillStyle = '#fff'; roundRect(ctx, -bw / 2, -bh / 2, bw, bh, size * 0.4); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(-bw / 2 + size * 0.85, 0, size * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0f172a'; ctx.fillText(label, -bw / 2 + size * 1.5, 1);
    return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
  }

  drawWatermark() {
    const wm = this.p.watermark;
    if (!wm?.on) return;
    const { ctx, W, H } = this, pad = Math.min(W, H) * 0.04;
    ctx.save();
    ctx.globalAlpha = wm.opacity ?? 0.85;
    const logo = wm.logoMediaId && this.images.get(wm.logoMediaId);
    const right = (wm.pos || 'br').includes('r'), bottom = (wm.pos || 'br').includes('b');
    if (logo) {
      const lh = Math.min(W, H) * (wm.size || 0.09), lw = lh * logo.naturalWidth / logo.naturalHeight;
      ctx.drawImage(logo, right ? W - pad - lw : pad, bottom ? H - pad - lh : pad, lw, lh);
    } else if (wm.text) {
      const size = Math.round(Math.min(W, H) * 0.032);
      ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
      ctx.textAlign = right ? 'right' : 'left'; ctx.textBaseline = bottom ? 'bottom' : 'top';
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = size * 0.4;
      ctx.fillStyle = '#fff';
      ctx.fillText(wm.text, right ? W - pad : pad, bottom ? H - pad : pad);
    }
    ctx.restore();
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
