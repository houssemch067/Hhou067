// App shell: navigation + hash router + settings view.
import { h, icon, $, toast, pickFiles } from './util.js';
import { getSettings, saveSettings, addMedia, getMedia, db, DEFAULT_SETTINGS } from './store.js';
import { renderCases, renderCase } from './cases.js';
import { renderCapture, stopCamera } from './capture.js';
import { renderCompare } from './compare.js';
import { renderStudio, leaveStudio } from './studio.js';
import { text, color, toggle } from './ui.js';

const NAV = [
  ['cases', 'Cases', 'folder'],
  ['capture', 'Capture', 'camera'],
  ['compare', 'Compare', 'compare'],
  ['studio', 'Video Studio', 'film'],
  ['settings', 'Settings', 'settings'],
];

function buildNav() {
  const side = $('#side');
  side.innerHTML = '';
  side.append(h('div.brand', h('i', icon('tooth', 22)), h('div', 'DentaStudio', h('small', 'AI photo & reel studio'))));
  NAV.forEach(([k, l, ic]) => side.append(h('a.nav', { href: '#/' + k, 'data-k': k }, icon(ic, 19), h('span', l))));
  side.append(h('div.foot', 'Photos stay on this device.', h('br'), h('a', { href: '../index.html' }, '← DentOrdo')));
}

async function route() {
  const main = $('#main');
  const [view = 'cases', a, b] = location.hash.replace(/^#\/?/, '').split('/');
  stopCamera();
  leaveStudio();
  document.querySelectorAll('.nav').forEach(n => n.classList.toggle('on', n.dataset.k === (view === 'case' ? 'cases' : view)));
  document.body.dataset.view = view;
  main.scrollTop = 0;
  try {
    if (view === 'case') await renderCase(main, a);
    else if (view === 'capture') await renderCapture(main, a);
    else if (view === 'compare') await renderCompare(main, a, b);
    else if (view === 'studio') await renderStudio(main, { project: a });
    else if (view === 'settings') await renderSettings(main);
    else await renderCases(main);
  } catch (e) {
    console.error(e);
    main.innerHTML = '';
    main.append(h('div.empty', h('h3', 'Something went wrong'), h('pre.err', String(e?.stack || e))));
  }
}

async function renderSettings(main) {
  const s = { ...(await getSettings()) };
  const logo = s.logoMediaId && await getMedia(s.logoMediaId);
  const save = async () => { await saveSettings(s); toast('Saved', 'ok'); };
  main.innerHTML = '';
  main.append(
    h('div.top', h('div', h('h1', 'Settings'), h('p.muted', 'Your branding is used for watermarks, outros and labels in every reel.'))),
    h('div.card.form',
      h('h3', 'Clinic branding'),
      text('Clinic name', s.clinic, v => (s.clinic = v)),
      text('Social handle', s.handle, v => (s.handle = v), { placeholder: '@yourclinic' }),
      text('Website', s.website, v => (s.website = v)),
      text('Phone', s.phone, v => (s.phone = v)),
      color('Accent colour', s.accent, v => (s.accent = v)),
      h('label.row', h('span.row-l', 'Logo'), h('div.row-c',
        logo ? h('img.logo-prev', { src: logo.thumb }) : h('span.muted', 'none'),
        h('button.btn.sm', { onclick: async () => { const [f] = await pickFiles('image/*', false); if (!f) return; const m = await addMedia(f, { name: 'Clinic logo', tag: '', caseId: '__brand' }); s.logoMediaId = m.id; await save(); renderSettings(main); } }, 'Upload'),
        logo && h('button.btn.sm', { onclick: async () => { s.logoMediaId = null; await save(); renderSettings(main); } }, 'Remove'))),
      toggle('Watermark new reels by default', s.watermark, v => (s.watermark = v)),
      h('h3', 'Labels'),
      text('Before label', s.labelBefore, v => (s.labelBefore = v)),
      text('After label', s.labelAfter, v => (s.labelAfter = v)),
      h('div.row-btns',
        h('button.btn.sm', { onclick: () => { s.labelBefore = 'AVANT'; s.labelAfter = 'APRÈS'; save().then(() => renderSettings(main)); } }, 'Français'),
        h('button.btn.sm', { onclick: () => { s.labelBefore = 'قبل'; s.labelAfter = 'بعد'; save().then(() => renderSettings(main)); } }, 'العربية'),
        h('button.btn.sm', { onclick: () => { s.labelBefore = 'ANTES'; s.labelAfter = 'DESPUÉS'; save().then(() => renderSettings(main)); } }, 'Español')),
      h('div.modal-foot', h('button.btn.primary', { onclick: save }, 'Save settings'))),
    h('div.card.form',
      h('h3', 'Data'),
      h('p.muted', 'Everything (photos, videos, projects) is stored locally in this browser. Clearing site data deletes it.'),
      h('div.row-btns',
        h('button.btn.danger', { onclick: async () => {
          if (!confirm('Delete ALL cases, photos, videos and projects on this device?')) return;
          for (const st of ['media', 'cases', 'projects', 'kv']) await db.clear(st);
          await saveSettings({ ...DEFAULT_SETTINGS });
          location.hash = '#/cases'; location.reload();
        } }, 'Erase all data'))),
    h('div.card.form',
      h('h3', 'About the AI'),
      h('ul.about',
        h('li', h('b', 'Smile detection'), ' — a face-landmark model (MediaPipe) runs in your browser to find eyes, lips and teeth.'),
        h('li', h('b', 'Auto-align'), ' — before/after photos are scaled, rotated and positioned so both smiles line up exactly.'),
        h('li', h('b', 'Smart zoom'), ' — Ken-Burns moves that push in on the smile automatically.'),
        h('li', h('b', 'Auto-enhance'), ' — exposure, contrast and white balance corrected from the photo histogram.'),
        h('li', h('b', 'Whitening preview'), ' — consultation simulation limited to the teeth area, always tagged as a simulation.'),
        h('li', h('b', 'Beat sync'), ' — tempo detection snaps every cut onto the music beat.'),
        h('li', h('b', 'Magic Reel'), ' — builds a complete branded edit from one before/after pair.'))));
}

buildNav();
addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
