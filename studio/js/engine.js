// Timeline rendering engine: draws any time `t` of a project onto a canvas.
// Shared by the live preview and the exporter so what you see is what you export.
import { clamp, ease, easeOut, lerp, makeCanvas } from './util.js';
import { getMedia, imageEl, mediaURL } from './store.js';
import { focusOf } from './ai.js';

export const ASPECTS = { '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080], '16:9': [1920, 1080] };
export const TRANSITIONS = ['none', 'dissolve', 'fade', 'flash', 'wipe', 'slide', 'push', 'zoom', 'circle', 'blur'];
export const MOTIONS = ['none', 'zoomIn', 'zoomOut', 'smileZoom', 'panLeft', 'panRight'];
export const TEXT_ANIMS = ['fade', 'slideUp', 'pop', 'typewriter', 'zoom', 'none'];

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

const filterStr = (f, blur = 0) => {
  if (!f && !blur) return 'none';
  const parts = [];
  if (f) {
    if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`);
    if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`);
    if (f.saturate !== 1) parts.push(`saturate(${f.saturate})`);
  }
  if (blur > 0.3) parts.push(`blur(${blur.toFixed(1)}px)`);
  return parts.join(' ') || 'none';
};

export class Engine {
  constructor(canvas, { scale = 0.5, onFrameReady } = {}) {
    this.canvas = canvas;
    this.scale = scale;
    this.ctx = canvas.getContext('2d');
    this.media = new Map();     // mediaId -> record
    this.images = new Map();    // mediaId -> HTMLImageElement
    this.videos = new Map();    // clipId -> HTMLVideoElement
    this.gains = new WeakMap();
    this.music = null;          // { el, mediaId }
    this.hit = {};              // overlay hit boxes (logical coords) for on-canvas dragging
    this.onFrameReady = onFrameReady;
    this.bufA = makeCanvas(2, 2); this.bufB = makeCanvas(2, 2);
  }

  // ----- audio graph: every media element -> gain -> master -> speakers + recorder stream
  audio() {
    if (!this.ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.connect(this.ac.destination);
      this.streamDest = this.ac.createMediaStreamDestination();
      this.master.connect(this.streamDest);
    }
    return this.ac;
  }
  route(el) {
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
    for (const c of [this.canvas, this.bufA, this.bufB]) if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  }

  /** Loads every media the project references. Call after structural edits. */
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
    // one <video> per video clip (the same file may appear twice, e.g. during a transition)
    const live = new Set();
    for (const c of p.clips) {
      const m = this.media.get(c.mediaId);
      if (m?.kind !== 'video') continue;
      live.add(c.id);
      let v = this.videos.get(c.id);
      if (!v || v._mid !== m.id) {
        v?.pause();
        v = document.createElement('video');
        v._mid = m.id; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
        v.src = mediaURL(m);
        v.addEventListener('seeked', () => this.onFrameReady?.());
        v.addEventListener('loadeddata', () => this.onFrameReady?.());
        this.route(v);
        this.videos.set(c.id, v);
      }
    }
    for (const [id, v] of this.videos) if (!live.has(id)) { v.pause(); v.removeAttribute('src'); this.videos.delete(id); }
    // music
    const am = p.audio?.mediaId && this.media.get(p.audio.mediaId);
    if (am) {
      if (this.music?.mediaId !== am.id) {
        this.music?.el.pause();
        const el = new Audio(); el.preload = 'auto'; el.src = mediaURL(am);
        this.route(el);
        this.music = { el, mediaId: am.id };
      }
    } else if (this.music) { this.music.el.pause(); this.music = null; }
    this.muted = muted;
  }

  /** Keeps video / music elements in step with timeline time t. */
  sync(t, playing) {
    const p = this.p;
    if (!p) return;
    for (const c of p.clips) {
      const v = this.videos.get(c.id);
      if (!v) continue;
      const speed = c.speed || 1;
      const active = t >= c._start && t < c._start + c.duration;
      const local = clamp(c.in + (t - c._start) * speed, 0, (v.duration || 1e9) - 0.05);
      if (active) {
        v.playbackRate = speed;
        // fade clip audio during transitions
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
        // pre-roll upcoming clips so their first frame is ready
        if (t < c._start && c._start - t < 2 && Math.abs(v.currentTime - c.in) > 0.05 && !v.seeking) v.currentTime = c.in;
      }
    }
    if (this.music) {
      const a = p.audio, el = this.music.el, dur = el.duration || 0;
      const start = a.offset || 0, inPt = a.in || 0, end = Math.min(this.duration, start + (dur - inPt));
      const active = t >= start && t < end;
      const local = t - start + inPt;
      const g = (a.volume ?? 0.8) * clamp((t - start) / Math.max(0.01, a.fadeIn ?? 0.5), 0, 1) * clamp((end - t) / Math.max(0.01, a.fadeOut ?? 1.5), 0, 1);
      this.setGain(el, this.muted ? 0 : g);
      if (active && playing) {
        if (el.paused) { el.currentTime = local; el.play().catch(() => {}); }
        else if (Math.abs(el.currentTime - local) > 0.3) el.currentTime = local;
      } else if (!el.paused) el.pause();
    }
  }

  stopAll() {
    for (const v of this.videos.values()) v.pause();
    this.music?.el.pause();
  }

  destroy() {
    this.stopAll();
    for (const v of this.videos.values()) v.removeAttribute('src');
    this.videos.clear();
    if (this.music) this.music.el.removeAttribute('src');
    this.ac?.close();
  }

  // ---------- drawing ----------
  render(t) {
    const p = this.p;
    if (!p) return;
    const { ctx, W, H } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = p.bg || '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    t = clamp(t, 0, Math.max(0, this.duration - 1e-3));
    const clips = p.clips;
    let i = clips.findIndex(c => t >= c._start && t < c._start + c.duration);
    if (i < 0 && clips.length) i = clips.length - 1;
    if (i >= 0) {
      // the incoming clip of a transition starts before the outgoing one ends
      const A = clips[i], B = clips[i + 1];
      if (B && A._tr > 0 && t >= B._start) {
        const q = ease(clamp((t - B._start) / A._tr, 0, 1));
        this.drawClip(this.bufA, A, t - A._start);
        this.drawClip(this.bufB, B, t - B._start);
        this.composite(A.transition.type, q);
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
      default: // dissolve
        ctx.drawImage(a, 0, 0); ctx.globalAlpha = q; ctx.drawImage(b, 0, 0);
    }
    ctx.restore();
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
      case 'panLeft': zoom *= 1.2; break;
      case 'panRight': zoom *= 1.2; break;
    }
    if (f && clip.focusSmile !== false) { fx = lerp(fx, f.x, clip.motion === 'smileZoom' ? toward : Math.max(toward, zoom > 1.01 ? 0.7 : 0)); fy = lerp(fy, f.y, clip.motion === 'smileZoom' ? toward : Math.max(toward, zoom > 1.01 ? 0.7 : 0)); }
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
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = Math.min(1, Math.abs(w) * 1.6);
      ctx.fillStyle = w > 0 ? '#ff9a3c' : '#3c8cff';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    }
  }

  drawClip(buf, clip, lt) {
    const ctx = buf.getContext('2d'), { W, H } = this, p = this.p;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
    const prog = clip.duration ? lt / clip.duration : 0;
    const full = { x: 0, y: 0, w: W, h: H };
    ctx.fillStyle = clip.kind === 'solid' ? clip.color || '#0f172a' : p.bg || '#000';
    ctx.fillRect(0, 0, W, H);
    if (clip.kind === 'solid') {
      if (clip.gradient) {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, clip.color || '#0f172a'); g.addColorStop(1, clip.color2 || p.accent || '#14b8a6');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      return;
    }
    const a = this.srcOf(clip, 1);
    if (!a) { this.placeholder(ctx, full, clip); return; }
    const layout = clip.layout || 'single';
    const b = layout !== 'single' ? this.srcOf(clip, 2) : null;
    const blurBg = clip.fit === 'contain' && clip.blurFill !== false;

    if (layout === 'single' || !b) {
      if (blurBg) this.drawMapped(ctx, a, this.baseMap(a, full, { fit: 'cover' }, 0), full, clip.filter, 40);
      this.drawMapped(ctx, a, this.baseMap(a, full, clip, prog), full, clip.filter);
      return;
    }

    const st = p.style || {}, accent = p.accent || '#14b8a6';
    if (layout === 'wipe') {
      const mapA = this.baseMap(a, full, clip, 0);
      let maps = clip.align !== false ? this.alignMaps(a, b, mapA) : null;
      if (!maps) maps = [mapA, this.baseMap(b, full, clip, 0)];
      // keyframes: hold before -> sweep to after -> settle at 50/50
      const f = prog < 0.18 ? 1 : prog < 0.55 ? 1 - ease((prog - 0.18) / 0.37) : prog < 0.75 ? 0.5 * ease((prog - 0.55) / 0.2) : 0.5;
      const x = W * f;
      this.drawMapped(ctx, b, maps[1], full, clip.filter2 || clip.filter);
      if (x > 0.5) this.drawMapped(ctx, a, maps[0], { x: 0, y: 0, w: x, h: H }, clip.filter);
      // divider
      ctx.save();
      ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 18;
      ctx.fillRect(x - 3, 0, 6, H);
      const r = Math.min(W, H) * 0.045;
      ctx.beginPath(); ctx.arc(x, H * 0.5, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = accent; ctx.lineWidth = r * 0.16; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.2, H / 2 - r * 0.35); ctx.lineTo(x - r * 0.55, H / 2); ctx.lineTo(x - r * 0.2, H / 2 + r * 0.35);
      ctx.moveTo(x + r * 0.2, H / 2 - r * 0.35); ctx.lineTo(x + r * 0.55, H / 2); ctx.lineTo(x + r * 0.2, H / 2 + r * 0.35);
      ctx.stroke();
      ctx.restore();
      if (clip.labels !== false) {
        this.label(ctx, st.labelBefore || 'BEFORE', W * 0.05, H * 0.07, 'left', clamp(f * 4 - 0.2, 0, 1), accent);
        this.label(ctx, st.labelAfter || 'AFTER', W * 0.95, H * 0.07, 'right', clamp((1 - f) * 4 - 0.2, 0, 1), accent);
      }
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
      // same smile scale in both halves
      mapB = { ...mapB, s: Math.max(mapB.s / (clip.zoom || 1) / 1.0001, mapA.s * fa.ref / fb.ref), r: -fb.angle };
      mapB.ix = fb.x; mapB.iy = fb.y;
      mapB.px = rb.x + (mapA.px - ra.x) + mapA.s * (fa.x - mapA.ix); mapB.py = rb.y + (mapA.py - ra.y) + mapA.s * (fa.y - mapA.iy);
    }
    ctx.fillStyle = accent; ctx.fillRect(0, 0, W, H);
    this.drawMapped(ctx, a, mapA, ra, clip.filter);
    this.drawMapped(ctx, b, mapB, rb, clip.filter2 || clip.filter);
    if (clip.labels !== false) {
      const al = clamp(lt / 0.5, 0, 1);
      this.label(ctx, st.labelBefore || 'BEFORE', ra.x + ra.w * 0.05, ra.y + Math.min(ra.h, ra.w) * 0.08, 'left', al, accent);
      this.label(ctx, st.labelAfter || 'AFTER', rb.x + rb.w * 0.05, rb.y + Math.min(rb.h, rb.w) * 0.08, 'left', al, accent);
    }
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

  drawOverlays(t) {
    const { ctx, W, H } = this;
    this.hit = {};
    for (const o of this.p.overlays) {
      const lt = t - o.start;
      if (lt < 0 || lt > o.duration) continue;
      const ain = clamp(lt / 0.45, 0, 1), aout = clamp((o.duration - lt) / 0.35, 0, 1);
      let alpha = Math.min(easeOut(ain), easeOut(aout)), dy = 0, sc = 1, text = o.text || '';
      switch (o.anim) {
        case 'slideUp': dy = (1 - easeOut(ain)) * H * 0.04; break;
        case 'pop': sc = 0.55 + 0.45 * backOut(ain); alpha = Math.min(ain * 3, 1) * easeOut(aout); break;
        case 'zoom': sc = 1 + 0.25 * (1 - easeOut(ain)); break;
        case 'typewriter': { const n = Math.floor(text.length * clamp(lt / Math.max(0.6, text.length * 0.045), 0, 1)); text = text.slice(0, n); alpha = easeOut(aout); break; }
        case 'none': alpha = 1; break;
      }
      const size = o.size || 72, lines = text.split('\n');
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `${o.weight || 800} ${size}px ${o.font || 'Inter, system-ui, sans-serif'}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const lh = size * 1.18;
      const full = (o.text || '').split('\n');
      const tw = Math.max(1, ...full.map(l => ctx.measureText(l).width));
      const bw = tw + size * 0.9, bh = full.length * lh + size * 0.5;
      const cx = (o.x ?? 0.5) * W, cy = (o.y ?? 0.5) * H + dy;
      ctx.translate(cx, cy); ctx.scale(sc, sc);
      if (o.bg && o.bg !== 'none') {
        ctx.fillStyle = o.bgColor || 'rgba(15,23,42,.7)';
        roundRect(ctx, -bw / 2, -bh / 2, bw, bh, o.bg === 'pill' ? bh / 2 : size * 0.25); ctx.fill();
      }
      if (o.shadow !== false && (!o.bg || o.bg === 'none')) { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = size * 0.35; ctx.shadowOffsetY = size * 0.05; }
      ctx.fillStyle = o.color || '#fff';
      lines.forEach((l, i) => ctx.fillText(l, 0, (i - (full.length - 1) / 2) * lh));
      ctx.restore();
      this.hit[o.id] = { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
    }
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

function backOut(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
