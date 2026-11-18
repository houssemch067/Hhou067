// App shell: hash router for the full-screen creator flow.
import { h, $ } from './util.js';
import { renderCamera, stopCamera } from './camera.js';
import { renderBrowse } from './browse.js';
import { renderEditor } from './reels.js';
import { renderShare } from './share.js';
import { renderDrafts } from './drafts.js';
import { renderPro, leaveStudio } from './studio.js';

let cleanup = null;
let seq = 0;

async function route() {
  const main = $('#main');
  const [view = '', a] = location.hash.replace(/^#\/?/, '').split('/');
  const my = ++seq;
  try { await cleanup?.(); } catch { /* ignore */ }
  cleanup = null;
  stopCamera(); leaveStudio();
  document.body.dataset.view = view || 'camera';
  main.className = '';
  try {
    let c;
    if (view === 'templates') c = await renderBrowse(main);
    else if (view === 'edit') c = await renderEditor(main, a);
    else if (view === 'share') c = await renderShare(main, a);
    else if (view === 'drafts') c = await renderDrafts(main);
    else if (view === 'pro') c = await renderPro(main, a);
    else c = await renderCamera(main, { mode: view === 'photo' ? 'photo' : 'reel' });
    if (my !== seq) c?.(); else cleanup = c || null;
  } catch (e) {
    console.error(e);
    main.innerHTML = '';
    main.append(h('div.screen.fatal', h('h3', 'Something went wrong'), h('pre', String(e?.stack || e)), h('a.pill.white', { href: '#/' }, 'Back to camera')));
  }
}

// make sure the canvas fonts are ready before the first frame is drawn
const fonts = ['800 40px Inter', '400 40px Anton', '700 40px "Playfair Display"', '700 40px Caveat'];
Promise.race([Promise.all(fonts.map(f => document.fonts?.load(f))), new Promise(r => setTimeout(r, 2500))])
  .catch(() => {})
  .finally(() => { addEventListener('hashchange', route); route(); });

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
