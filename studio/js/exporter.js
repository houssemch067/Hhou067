// Renders a project to a video file (MP4 when the browser can encode it, otherwise WebM).
import { Engine } from './engine.js';
import { makeCanvas } from './util.js';

// Prefer real H.264 MP4 (what Instagram / TikTok / WhatsApp expect). A bare 'video/mp4' is only trusted
// on Safari (always H.264 there); Chromium may put VP9 inside MP4, so WebM is the honest fallback.
export function pickMime() {
  const ok = t => window.MediaRecorder && MediaRecorder.isTypeSupported(t);
  const h264 = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4D401F,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1'];
  const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  return h264.find(ok) || (safari && ok('video/mp4') ? 'video/mp4' : '') ||
    ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(ok) || '';
}

export const QUALITIES = { '1080p': 1, '720p': 2 / 3, '540p': 0.5 };

/**
 * Real-time render + record. onProgress(0..1). Returns { blob, ext, mime }.
 * signal: { cancelled } to abort.
 */
export async function exportProject(project, { quality = '1080p', fps = 30, onProgress, signal = {} } = {}) {
  const mime = pickMime();
  if (!mime) throw new Error('This browser cannot record video (MediaRecorder missing). Try Chrome, Edge or Safari 17+.');
  const canvas = makeCanvas(2, 2);
  const eng = new Engine(canvas, { scale: QUALITIES[quality] || 1 });
  await eng.prepare(JSON.parse(JSON.stringify(project)));
  const ac = eng.audio();
  await ac.resume();
  // let videos buffer their first frames
  eng.sync(0, false);
  await Promise.all([...eng.videos.values()].map(v => v.readyState >= 2 ? 0 : new Promise(r => { v.addEventListener('loadeddata', r, { once: true }); setTimeout(r, 4000); })));
  if (eng.music) await new Promise(r => eng.music.el.readyState >= 3 ? r() : (eng.music.el.addEventListener('canplaythrough', r, { once: true }), setTimeout(r, 4000)));
  eng.render(0);

  const stream = canvas.captureStream(fps);
  eng.streamDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  const px = canvas.width * canvas.height;
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.round(px * fps * 0.2), audioBitsPerSecond: 192000 });
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => (rec.onstop = r));
  rec.start(250);

  const dur = eng.duration;
  const t0 = performance.now();
  await new Promise(resolve => {
    // setInterval keeps ticking (throttled) even when rAF would stop; rAF is smoother while visible.
    let last = -1;
    const tick = () => {
      if (signal.cancelled) return resolve();
      const t = (performance.now() - t0) / 1000;
      if (t >= dur) { eng.render(dur); return resolve(); }
      eng.sync(t, true);
      if (t !== last) { eng.render(t); last = t; }
      onProgress?.(t / dur);
      if (document.hidden) setTimeout(tick, 1000 / fps); else requestAnimationFrame(tick);
    };
    tick();
  });
  await new Promise(r => setTimeout(r, 200));
  rec.stop();
  await done;
  eng.destroy();
  stream.getTracks().forEach(t => t.stop());
  if (signal.cancelled) return null;
  const type = mime.split(';')[0];
  return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm', mime: type };
}

/** Single still frame (PNG) — handy for thumbnails / posts. */
export async function exportFrame(project, t) {
  const canvas = makeCanvas(2, 2);
  const eng = new Engine(canvas, { scale: 1 });
  await eng.prepare(JSON.parse(JSON.stringify(project)), { muted: true });
  eng.sync(t, false);
  await Promise.all([...eng.videos.values()].map(v => new Promise(r => { if (v.readyState >= 2 && !v.seeking) r(); else { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 3000); } })));
  eng.render(t);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  eng.destroy();
  return blob;
}
