// Clinical capture: camera with dental framing guides, grid, timer, mirror correction, AI shot check.
import { h, icon, toast, makeCanvas } from './util.js';
import { allCases, saveCase, newCase, addMedia } from './store.js';
import { tryAnalyze } from './ai.js';
import { VIEWS } from './cases.js';
import { select } from './ui.js';

// Guide overlays in a 100×100 viewBox (stretched to the frame), white strokes.
const GUIDES = {
  smile: '<ellipse cx="50" cy="50" rx="30" ry="40"/><path d="M30 38h40M34 64q16 12 32 0M50 10v80"/>',
  retracted: '<path d="M14 50q36-34 72 0M14 50q36 34 72 0M50 18v64M14 50h72"/>',
  left: '<path d="M20 50q30-26 64-8M20 50q30 26 64 8M60 20v60M20 50h70"/>',
  right: '<path d="M80 50q-30-26-64-8M80 50q-30 26-64 8M40 20v60M10 50h70"/>',
  upper: '<path d="M22 84Q20 22 50 16Q80 22 78 84M50 12v76"/>',
  lower: '<path d="M22 16Q20 78 50 84Q80 78 78 16M50 12v76"/>',
  portrait: '<ellipse cx="50" cy="44" rx="22" ry="29"/><path d="M28 40h44M50 10v80M20 92q30-18 60 0"/>',
  profile: '<path d="M58 14q-18 2-20 22l-4 10 4 4-2 8 3 4-1 8q8 6 14 2l6 14M10 38h80"/>',
  other: '',
};

let stream = null;
export function stopCamera() { stream?.getTracks().forEach(t => t.stop()); stream = null; }

export async function renderCapture(main, caseId) {
  stopCamera();
  const cases = await allCases();
  const st = { caseId: caseId || cases[0]?.id || '', view: 'smile', tag: 'before', grid: true, guide: true, mirror: false, timer: 0, facing: 'environment', recording: null };
  main.innerHTML = '';
  const video = h('video.cam', { playsInline: true, muted: true, autoplay: true });
  const guide = h('div.guide');
  const gridEl = h('div.cam-grid');
  const flash = h('div.cam-flash');
  const count = h('div.cam-count');
  const shots = h('div.shots');
  const camWrap = h('div.cam-wrap', video, gridEl, guide, flash, count);
  const status = h('div.cam-status.muted.sm');

  const drawGuide = () => {
    guide.innerHTML = st.guide ? `<svg viewBox="0 0 100 100" preserveAspectRatio="none">${GUIDES[st.view] || ''}</svg>` : '';
    gridEl.style.display = st.grid ? '' : 'none';
    camWrap.classList.toggle('mirror', st.mirror);
  };

  async function start() {
    stopCamera();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: st.facing, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false });
      video.srcObject = stream;
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.() || {};
      zoomRow.style.display = caps.zoom ? '' : 'none';
      if (caps.zoom) Object.assign(zoomIn, { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1, value: track.getSettings().zoom || caps.zoom.min });
      torchBtn.style.display = caps.torch ? '' : 'none';
      const s = track.getSettings();
      status.textContent = `${s.width}×${s.height}`;
    } catch (e) {
      camWrap.append(h('div.cam-err', icon('camera', 34), h('p', 'Camera unavailable: ' + e.message), h('p.muted.sm', 'Allow camera access, use HTTPS, or import photos inside a case instead.')));
    }
  }

  const zoomIn = h('input', { type: 'range', oninput: () => stream?.getVideoTracks()[0].applyConstraints({ advanced: [{ zoom: +zoomIn.value }] }) });
  const zoomRow = h('label.row', { style: { display: 'none' } }, h('span.row-l', 'Zoom'), zoomIn);
  let torch = false;
  const torchBtn = h('button.icon-btn', { title: 'Light', style: { display: 'none' }, onclick: () => { torch = !torch; stream?.getVideoTracks()[0].applyConstraints({ advanced: [{ torch }] }); torchBtn.classList.toggle('on', torch); } }, icon('zap'));

  async function ensureCase() {
    if (st.caseId) return st.caseId;
    const c = await saveCase(newCase({ patient: 'New patient ' + new Date().toLocaleDateString() }));
    st.caseId = c.id;
    return c.id;
  }

  async function shoot() {
    if (!video.videoWidth) return toast('Camera not ready', 'err');
    for (let i = st.timer; i > 0; i--) { count.textContent = i; await new Promise(r => setTimeout(r, 1000)); }
    count.textContent = '';
    const c = makeCanvas(video.videoWidth, video.videoHeight), x = c.getContext('2d');
    if (st.mirror) { x.translate(c.width, 0); x.scale(-1, 1); }
    x.drawImage(video, 0, 0);
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.94));
    const cid = await ensureCase();
    const label = VIEWS.find(v => v[0] === st.view)[1];
    const m = await addMedia(new File([blob], `${label} ${st.tag} ${new Date().toLocaleTimeString()}.jpg`, { type: 'image/jpeg' }), { caseId: cid, view: st.view, tag: st.tag });
    const cs = (await allCases()).find(c => c.id === cid); cs && saveCase(cs);
    const th = h('div.shot', h('img', { src: m.thumb }), h('span', label));
    shots.prepend(th);
    // AI shot check: head tilt + centring for face views
    if (['smile', 'portrait'].includes(st.view)) {
      const f = await tryAnalyze(m);
      if (f) {
        const off = Math.abs(f.mouth.x - 0.5);
        const msg = Math.abs(f.tilt) > 3 ? `Head tilted ${f.tilt.toFixed(1)}° — consider retaking` : off > 0.08 ? 'Smile off-centre — consider retaking' : 'Great shot ✓ level & centred';
        th.append(h('span.qc' + (msg.startsWith('Great') ? '.ok' : ''), msg));
        toast(msg, msg.startsWith('Great') ? 'ok' : '');
      }
    }
  }

  let rec = null, chunks = [];
  async function toggleRecord() {
    if (rec) { rec.stop(); return; }
    if (!stream) return;
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
      const s = new MediaStream([...stream.getVideoTracks(), ...(mic?.getAudioTracks() || [])]);
      const type = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
      rec = new MediaRecorder(s, type ? { mimeType: type } : {});
      chunks = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        mic?.getTracks().forEach(t => t.stop());
        recBtn.classList.remove('on'); rec = null;
        const blob = new Blob(chunks, { type: chunks[0]?.type || 'video/webm' });
        const cid = await ensureCase();
        const m = await addMedia(new File([blob], `Video ${new Date().toLocaleTimeString()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`, { type: blob.type }), { caseId: cid, view: st.view, tag: st.tag });
        shots.prepend(h('div.shot', h('img', { src: m.thumb }), h('span', 'Video')));
        toast('Video saved to case', 'ok');
      };
      rec.start(500);
      recBtn.classList.add('on');
    } catch (e) { toast('Recording failed: ' + e.message, 'err'); }
  }
  const recBtn = h('button.icon-btn.rec', { title: 'Record video', onclick: toggleRecord }, icon('record'));

  const viewChips = h('div.chips', ...VIEWS.filter(v => v[0] !== 'other').map(([k, l]) => h('button.chip' + (k === st.view ? '.on' : ''), {
    onclick: e => { st.view = k; [...viewChips.children].forEach(b => b.classList.toggle('on', b === e.currentTarget)); if (['upper', 'lower', 'left', 'right'].includes(k)) toast('Tip: enable Mirror when shooting through an intra-oral mirror'); drawGuide(); },
  }, l)));

  main.append(
    h('div.top', h('div', h('h1', 'Capture'), h('p.muted', 'Framing guides keep every before/after shot identical — that is what makes comparisons and reels look professional.'))),
    h('div.capture',
      h('div.cam-col', camWrap,
        h('div.cam-bar',
          h('button.icon-btn', { title: 'Switch camera', onclick: () => { st.facing = st.facing === 'user' ? 'environment' : 'user'; start(); } }, icon('refresh')),
          torchBtn,
          h('button.shutter', { title: 'Take photo', onclick: shoot }),
          recBtn,
          h('button.icon-btn', { title: 'Timer', onclick: e => { st.timer = st.timer ? 0 : 3; e.currentTarget.classList.toggle('on', !!st.timer); toast(st.timer ? '3 s timer on' : 'Timer off'); } }, icon('timer'))),
        status),
      h('div.cap-side',
        select('Case', st.caseId, [['', '+ New case on first shot'], ...cases.map(c => [c.id, c.patient || 'Untitled case'])], v => (st.caseId = v)),
        h('div.sec-h', 'View'), viewChips,
        h('div.sec-h', 'Tag'),
        h('div.chips', ...[['before', 'Before'], ['progress', 'Progress'], ['after', 'After']].map(([k, l]) => h('button.chip' + (k === st.tag ? '.on' : ''), { onclick: e => { st.tag = k; [...e.currentTarget.parentNode.children].forEach(b => b.classList.toggle('on', b === e.currentTarget)); } }, l))),
        h('div.sec-h', 'Overlays'),
        h('div.chips',
          h('button.chip.on', { onclick: e => { st.guide = !st.guide; e.currentTarget.classList.toggle('on', st.guide); drawGuide(); } }, 'Guide'),
          h('button.chip.on', { onclick: e => { st.grid = !st.grid; e.currentTarget.classList.toggle('on', st.grid); drawGuide(); } }, 'Grid'),
          h('button.chip', { onclick: e => { st.mirror = !st.mirror; e.currentTarget.classList.toggle('on', st.mirror); drawGuide(); } }, 'Mirror')),
        zoomRow,
        h('div.sec-h', 'This session'), shots,
        st.caseId && h('a.btn.wide', { href: '#/case/' + st.caseId }, 'Open case'))));
  drawGuide();
  start();
}
