// On-device AI: face/smile landmarks (MediaPipe), auto-enhance, whitening preview,
// beat detection for music sync. Nothing leaves the device.
import { makeCanvas, clamp } from './util.js';
import { imageEl, updateMedia } from './store.js';

const MP_VER = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let landmarkerP = null;
function getLandmarker() {
  return (landmarkerP ||= (async () => {
    const vision = await import(/* @vite-ignore */ `${MP_BASE}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = delegate => vision.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'IMAGE', numFaces: 1,
    });
    try { return await make('GPU'); } catch { return await make('CPU'); }
  })().catch(e => { landmarkerP = null; throw e; }));
}

// Inner-lip contour (teeth area) and outer lip contour indices of the 478-point mesh.
const INNER_LIP = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
const OUTER_LIP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];

/**
 * Detects face geometry and stores it on media.meta.face (normalized 0..1 coords).
 * Returns null if no face (e.g. intra-oral retractor shots).
 */
export async function analyzeFace(media) {
  if (media.kind !== 'image') return null;
  if (media.meta?.face !== undefined) return media.meta.face;
  const img = await imageEl(media);
  const lm = await getLandmarker();
  // Downscale large photos for speed.
  const s = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = makeCanvas(img.naturalWidth * s, img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const res = lm.detect(c);
  const pts = res.faceLandmarks?.[0];
  let face = null;
  if (pts) {
    const avg = ids => ids.reduce((a, i) => ({ x: a.x + pts[i].x / ids.length, y: a.y + pts[i].y / ids.length }), { x: 0, y: 0 });
    const le = avg([33, 133, 159, 145]), re = avg([362, 263, 386, 374]);
    const ml = pts[61], mr = pts[291];
    const xs = OUTER_LIP.map(i => pts[i].x), ys = OUTER_LIP.map(i => pts[i].y);
    face = {
      le, re,
      mouth: { x: (ml.x + mr.x) / 2, y: (pts[13].y + pts[14].y) / 2 },
      mouthBox: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
      inner: INNER_LIP.map(i => ({ x: pts[i].x, y: pts[i].y })),
      // eye-line tilt in degrees, in real pixel space
      tilt: Math.atan2((re.y - le.y) * img.naturalHeight, (re.x - le.x) * img.naturalWidth) * 180 / Math.PI,
      openness: (pts[14].y - pts[13].y) / Math.max(1e-6, mr.x - ml.x),
    };
  }
  media.meta = { ...(media.meta || {}), face };
  await updateMedia(media);
  return face;
}

export async function tryAnalyze(media) {
  try { return await analyzeFace(media); } catch (e) { console.warn('Face AI unavailable', e); return null; }
}

/** Pixel focus point (smile centre) of an image, falling back to its centre. */
export function focusOf(media) {
  const f = media?.meta?.face;
  if (f) return { x: f.mouth.x * media.w, y: f.mouth.y * media.h, ref: Math.hypot((f.re.x - f.le.x) * media.w, (f.re.y - f.le.y) * media.h), angle: Math.atan2((f.re.y - f.le.y) * media.h, (f.re.x - f.le.x) * media.w) };
  return null;
}

// ---------- Auto-enhance (exposure, contrast, white balance) ----------
function sample(img, max = 256) {
  const w = img.naturalWidth || img.videoWidth || img.width, h = img.naturalHeight || img.videoHeight || img.height;
  const s = Math.min(1, max / Math.max(w, h)), c = makeCanvas(w * s, h * s);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, c.width, c.height);
  return x.getImageData(0, 0, c.width, c.height).data;
}

/** Returns non-destructive adjustment values {brightness, contrast, saturate, warmth}. */
export function autoEnhanceParams(img) {
  const d = sample(img);
  const hist = new Uint32Array(256);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const L = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    hist[L]++;
    if (L > 40 && L < 220) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  }
  const total = d.length / 4;
  const pct = p => { let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * p) return i; } return 255; };
  const lo = pct(0.01), hi = pct(0.99), mid = pct(0.5);
  const contrast = clamp(200 / Math.max(60, hi - lo), 0.9, 1.35);
  const brightness = clamp(Math.pow(128 / Math.max(30, mid), 0.55), 0.85, 1.3);
  n = n || 1; r /= n; b /= n; g /= n;
  // gray-world: positive warmth adds orange, negative adds blue
  const warmth = clamp(((b - r) / Math.max(1, g)) * 0.9, -0.35, 0.35);
  return { brightness: +brightness.toFixed(2), contrast: +contrast.toFixed(2), saturate: 1.08, warmth: +warmth.toFixed(2) };
}

/** Bakes adjustments into pixels (works on every browser, used for saving photos). */
export function applyAdjustPixels(imgData, { brightness = 1, contrast = 1, saturate = 1, warmth = 0 }) {
  const d = imgData.data;
  const wr = 1 + warmth * 0.25, wb = 1 - warmth * 0.25;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * brightness, g = d[i + 1] * brightness, b = d[i + 2] * brightness;
    r = (r - 128) * contrast + 128; g = (g - 128) * contrast + 128; b = (b - 128) * contrast + 128;
    const L = r * 0.299 + g * 0.587 + b * 0.114;
    r = L + (r - L) * saturate; g = L + (g - L) * saturate; b = L + (b - L) * saturate;
    d[i] = clamp(r * wr, 0, 255); d[i + 1] = clamp(g, 0, 255); d[i + 2] = clamp(b * wb, 0, 255);
  }
  return imgData;
}

// ---------- Whitening preview (consultation simulation) ----------
/**
 * Returns a canvas with teeth whitened. Uses the inner-lip contour from the face
 * landmarks when present; otherwise treats the central area (intra-oral shots).
 * strength 0..1, shade lift in VITA-like steps is approximated by lightness / yellowness shifts.
 */
export async function whitenTeeth(media, strength = 0.6) {
  const img = await imageEl(media);
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = makeCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const mask = makeCanvas(W, H), mx = mask.getContext('2d', { willReadFrequently: true });
  const face = media.meta?.face;
  mx.fillStyle = '#fff';
  if (face) {
    const feather = Math.max(2, (face.mouthBox.x1 - face.mouthBox.x0) * W * 0.02);
    mx.filter = `blur(${feather}px)`;
    mx.beginPath();
    face.inner.forEach((p, i) => (i ? mx.lineTo(p.x * W, p.y * H) : mx.moveTo(p.x * W, p.y * H)));
    mx.closePath(); mx.fill();
  } else {
    const g = mx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.45);
    g.addColorStop(0, '#fff'); g.addColorStop(0.7, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
    mx.fillStyle = g; mx.fillRect(0, 0, W, H);
  }
  const box = face
    ? { x0: Math.floor(face.mouthBox.x0 * W), y0: Math.floor(face.mouthBox.y0 * H), x1: Math.ceil(face.mouthBox.x1 * W), y1: Math.ceil(face.mouthBox.y1 * H) }
    : { x0: 0, y0: 0, x1: W, y1: H };
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  if (bw < 2 || bh < 2) return c;
  const id = x.getImageData(box.x0, box.y0, bw, bh), md = mx.getImageData(box.x0, box.y0, bw, bh).data, d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const m = md[i] / 255;
    if (m < 0.02) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), L = (max + min) / 510, S = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
    // tooth-like pixel: bright-ish, not strongly saturated, not red (gums/lips)
    // teeth are yellow-ish (r≈g>b); lips & gums are pink (r clearly above g)
    const redness = (r - g) / Math.max(1, r);
    if (redness > 0.2 || L < 0.28) continue;
    const toothness = clamp((L - 0.28) / 0.25, 0, 1) * clamp((0.75 - S) / 0.4, 0, 1) * clamp((0.2 - redness) / 0.1, 0, 1);
    const k = m * toothness * strength;
    if (k <= 0) continue;
    // remove yellow (raise blue toward red/green) and lift lightness
    // move toward a natural (very slightly warm) white of the same luminance, then lift gently.
    // Never let blue overtake red: blue-white teeth look fake.
    const Y = r * 0.299 + g * 0.587 + b * 0.114;
    const lift = 1 + 0.09 * k, mix = 0.7 * k;
    const tr = Y * 1.02, tg = Y * 1.0, tb = Y * 0.96;
    let nr = (r + (tr - r) * mix) * lift, ng = (g + (tg - g) * mix) * lift, nb = (b + (tb - b) * mix) * lift;
    nb = Math.min(nb, nr * 0.985); ng = Math.min(ng, nr);
    d[i] = clamp(nr, 0, 250); d[i + 1] = clamp(ng, 0, 248); d[i + 2] = clamp(nb, 0, 244);
  }
  x.putImageData(id, box.x0, box.y0);
  return c;
}

// ---------- Audio analysis ----------
const audioCache = new Map();
export async function decodeAudio(blob, key) {
  if (key && audioCache.has(key)) return audioCache.get(key);
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ac = new AC(1, 44100, 44100);
  const buf = await ac.decodeAudioData(await blob.arrayBuffer());
  if (key) audioCache.set(key, buf);
  return buf;
}

export function waveformPeaks(buf, n = 400) {
  const ch = buf.getChannelData(0), step = Math.max(1, Math.floor(ch.length / n)), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step, e = Math.min(ch.length, j + step); j < e; j += 8) m = Math.max(m, Math.abs(ch[j]));
    out[i] = m;
  }
  return out;
}

/** Onset-envelope + autocorrelation tempo estimate. Returns { bpm, beats:[sec...] }. */
export function detectBeats(buf) {
  const sr = buf.sampleRate, data = buf.getChannelData(0), hop = 512;
  const frames = Math.floor(data.length / hop), env = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let j = f * hop, end = j + hop; j < end; j++) e += data[j] * data[j];
    e = Math.sqrt(e / hop);
    env[f] = Math.max(0, e - prev); prev = e;
  }
  const fps = sr / hop;
  // tempo between 70 and 170 bpm
  let best = 0, bestLag = Math.round(fps * 60 / 110);
  for (let lag = Math.round(fps * 60 / 170); lag <= Math.round(fps * 60 / 70); lag++) {
    let s = 0;
    for (let i = lag; i < frames; i++) s += env[i] * env[i - lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  const period = bestLag / fps;
  // phase: offset with the highest summed onset energy
  let bestPhase = 0, bestE = -1;
  for (let ph = 0; ph < bestLag; ph++) {
    let s = 0;
    for (let i = ph; i < frames; i += bestLag) s += env[i];
    if (s > bestE) { bestE = s; bestPhase = ph; }
  }
  const beats = [];
  for (let t = bestPhase / fps; t < buf.duration; t += period) beats.push(+t.toFixed(3));
  return { bpm: Math.round(60 / period), period, beats };
}

// ---------- Caption assistant ----------
const OPENERS = [
  'Confidence starts with a smile ✨', 'The glow-up is real 😁', 'Swipe to see the transformation 👉',
  'Same patient. New smile.', 'Small details, life-changing results.', 'This is why we love what we do 🦷',
];
export function captionIdeas({ treatment = 'smile makeover', clinic = '', handle = '', city = '' }) {
  const t = treatment.trim() || 'smile makeover';
  const tag = s => '#' + s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const tags = [tag(t), '#beforeandafter', '#smilemakeover', '#dentist', '#cosmeticdentistry', '#newsmile', '#dentalcare', city && tag(city + 'dentist')].filter(Boolean);
  return OPENERS.slice(0, 4).map((o, i) => [
    o,
    i % 2 ? `${t[0].toUpperCase() + t.slice(1)} done with precision and care at ${clinic || 'our clinic'}.` : `Our patient's ${t} — planned digitally, finished by hand.`,
    i === 2 ? 'Results vary from patient to patient. Book a consultation to find out what is right for you.' : 'Ready for yours? Book a consultation 📅',
    handle,
    tags.join(' '),
  ].filter(Boolean).join('\n\n'));
}
