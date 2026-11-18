// Home screen: full-screen camera with dental framing guides (Instagram-camera style).
import { h, icon, toast, makeCanvas } from './util.js';
import { allMedia, addMedia } from './store.js';
import { tryAnalyze } from './ai.js';
import { snapCarousel, ibtn } from './sheet.js';
import { gallerySheet } from './gallery.js';
import { settingsSheet } from './settings.js';
import { pick, resetPick, goTemplates } from './flow.js';

export const GUIDES = [
  ['smile', 'Smile', '<ellipse cx="50" cy="50" rx="30" ry="40"/><path d="M30 38h40M34 64q16 12 32 0M50 10v80"/>'],
  ['retracted', 'Retracted', '<path d="M14 50q36-34 72 0M14 50q36 34 72 0M50 18v64M14 50h72"/>'],
  ['portrait', 'Portrait', '<ellipse cx="50" cy="44" rx="22" ry="29"/><path d="M28 40h44M50 10v80M20 92q30-18 60 0"/>'],
  ['profile', 'Profile', '<path d="M58 14q-18 2-20 22l-4 10 4 4-2 8 3 4-1 8q8 6 14 2l6 14M10 38h80"/>'],
  ['left', 'Left side', '<path d="M20 50q30-26 64-8M20 50q30 26 64 8M60 20v60M20 50h70"/>'],
  ['right', 'Right side', '<path d="M80 50q-30-26-64-8M80 50q-30 26-64 8M40 20v60M10 50h70"/>'],
  ['upper', 'Upper arch', '<path d="M22 84Q20 22 50 16Q80 22 78 84M50 12v76"/>'],
  ['lower', 'Lower arch', '<path d="M22 16Q20 78 50 84Q80 78 78 16M50 12v76"/>'],
  ['none', 'No guide', ''],
];

let stream = null;
export function stopCamera() { stream?.getTracks().forEach(t => t.stop()); stream = null; }

export async function renderCamera(main, { mode = 'reel' } = {}) {
  stopCamera();
  const st = { guide: 0, grid: false, mirror: false, timer: 0, facing: 'environment', torch: false, railOpen: false };
  main.innerHTML = '';
  const video = h('video.cam-video', { playsInline: true, muted: true, autoplay: true });
  const guide = h('div.cam-guide'), grid = h('div.cam-grid'), flash = h('div.cam-flash'), count = h('div.cam-count');
  const err = h('div.cam-err');
  const view = h('div.cam-view', video, grid, guide, flash, count, err);

  const drawGuide = () => {
    const g = GUIDES[st.guide];
    guide.innerHTML = g[2] ? `<svg viewBox="0 0 100 100" preserveAspectRatio="none">${g[2]}</svg>` : '';
    grid.style.display = st.grid ? '' : 'none';
    view.classList.toggle('mirror', st.mirror);
    guideLbl.textContent = g[1];
  };

  // ---- top bar
  const torchBtn = ibtn('flashoff', 'Light', () => {
    st.torch = !st.torch;
    stream?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch: st.torch }] }).catch(() => toast('No light on this camera'));
    torchBtn.replaceChildren(icon(st.torch ? 'zap' : 'flashoff', 24));
  });
  const top = h('div.cam-top',
    ibtn('x', 'Drafts', () => (pick.before || pick.after ? (resetPick(), drawSteps()) : (location.hash = '#/drafts'))),
    torchBtn,
    ibtn('settings', 'Settings', () => settingsSheet()));

  // ---- before / after steps (reel mode)
  const steps = h('div.cam-steps');
  function drawSteps() {
    steps.replaceChildren();
    if (mode !== 'reel') return;
    for (const [k, label] of [['before', 'Before'], ['after', 'After']]) {
      const m = pick[k], active = !m && (k === 'before' || pick.before);
      steps.append(h('button.step' + (m ? '.done' : '') + (active ? '.active' : ''), {
        onclick: () => { if (m) { pick[k] = null; drawSteps(); } },
      }, m ? h('img', { src: m.thumb }) : h('span.step-dot'), h('span', label), m && icon('x', 12)));
    }
  }

  // ---- left rail
  const rail = h('div.cam-rail');
  const railItems = [
    ['grid', 'Grid', () => { st.grid = !st.grid; drawGuide(); return st.grid; }],
    ['timer', 'Timer 3s', () => { st.timer = st.timer ? 0 : 3; return !!st.timer; }],
    ['flip', 'Mirror', () => { st.mirror = !st.mirror; drawGuide(); return st.mirror; }],
  ];
  function drawRail() {
    rail.replaceChildren(
      ...railItems.slice(0, st.railOpen ? 3 : 2).map(([ic, label, fn]) => {
        const b = h('button.rail-tool', { onclick: () => b.classList.toggle('on', fn()) }, icon(ic, 26), h('span', label));
        return b;
      }),
      h('button.rail-tool', { onclick: () => { st.railOpen = !st.railOpen; drawRail(); } }, icon(st.railOpen ? 'chevup' : 'chevdown', 26)));
  }

  // ---- bottom: guide carousel inside the shutter ring
  const guideLbl = h('div.cam-guide-lbl');
  const car = snapCarousel(GUIDES.map(([id, , svg]) => ({ node: h('span.gchip', { html: svg ? `<svg viewBox="0 0 100 100">${svg}</svg>` : '' }, !svg && icon('x', 22)) })), {
    onSelect: i => { st.guide = i; drawGuide(); },
    onTapCenter: () => shoot(),
    itemSize: 62, gap: 16,
  });
  const shutter = h('button.shutter', { 'aria-label': 'Take photo', onclick: () => shoot() });
  const galleryBtn = h('button.gal-thumb', { 'aria-label': 'Gallery', onclick: () => openGallery() });
  async function refreshThumb() {
    const m = (await allMedia()).find(x => x.kind !== 'audio' && x.caseId !== '__brand');
    galleryBtn.replaceChildren(m?.thumb ? h('img', { src: m.thumb }) : icon('gallery', 22));
  }
  const modes = h('div.modes', ...[['photo', 'PHOTO'], ['reel', 'REEL'], ['drafts', 'DRAFTS']].map(([k, l]) =>
    h('button' + (k === mode ? '.on' : ''), { onclick: () => (location.hash = '#/' + (k === 'reel' ? '' : k)) }, l)));
  const bottom = h('div.cam-bottom',
    guideLbl,
    h('div.shutter-row', car.el, shutter),
    h('div.cam-nav', galleryBtn, modes, ibtn('refresh', 'Flip camera', () => { st.facing = st.facing === 'user' ? 'environment' : 'user'; start(); })));

  main.append(h('div.screen.cam-screen', view, top, steps, rail, bottom));
  drawGuide(); drawRail(); drawSteps(); refreshThumb();

  async function start() {
    stopCamera();
    err.replaceChildren(); err.style.display = 'none';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: st.facing, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false });
      video.srcObject = stream;
      const caps = stream.getVideoTracks()[0].getCapabilities?.() || {};
      torchBtn.style.visibility = caps.torch ? 'visible' : 'hidden';
    } catch (e) {
      torchBtn.style.visibility = 'hidden';
      err.style.display = '';
      err.append(icon('camera', 40), h('b', 'Camera not available'), h('p', 'Choose your before & after photos from the gallery instead.'),
        h('button.pill.white', { onclick: () => openGallery() }, icon('gallery', 18), 'Open gallery'));
    }
  }

  async function shoot() {
    if (!video.videoWidth) return openGallery();
    for (let i = st.timer; i > 0; i--) { count.textContent = i; await new Promise(r => setTimeout(r, 1000)); }
    count.textContent = '';
    const c = makeCanvas(video.videoWidth, video.videoHeight), x = c.getContext('2d');
    if (st.mirror) { x.translate(c.width, 0); x.scale(-1, 1); }
    x.drawImage(video, 0, 0);
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.94));
    const slot = mode === 'reel' ? (!pick.before ? 'before' : 'after') : '';
    const m = await addMedia(new File([blob], `${GUIDES[st.guide][1]} ${new Date().toLocaleString()}.jpg`, { type: 'image/jpeg' }), { view: GUIDES[st.guide][0], tag: slot });
    refreshThumb();
    if (mode !== 'reel') { toast('Saved to gallery'); tryAnalyze(m); return; }
    pick[slot] = m;
    drawSteps();
    const f = await tryAnalyze(m);
    if (f && Math.abs(f.tilt) > 4) toast(`Head tilted ${f.tilt.toFixed(0)}° — straighten for a perfect match`);
    if (pick.before && pick.after) goTemplates();
    else toast('Now take the AFTER photo — same framing 👌');
  }

  async function openGallery() {
    const res = await gallerySheet({ reel: mode === 'reel' });
    refreshThumb();
    if (res) { Object.assign(pick, res); goTemplates(); }
  }

  start();
  return () => stopCamera();
}
