// Network-first service worker: works offline after the first visit (incl. the AI model once downloaded).
const CACHE = 'dentastudio-v2';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './css/app.css',
  './js/app.js', './js/util.js', './js/store.js', './js/ai.js', './js/engine.js', './js/synth.js', './js/project.js', './js/templates.js',
  './js/exporter.js', './js/ui.js', './js/studio.js', './js/player.js', './js/sheet.js', './js/flow.js', './js/camera.js', './js/gallery.js',
  './js/settings.js', './js/browse.js', './js/reels.js', './js/share.js', './js/drafts.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || e.request.url.startsWith('blob:')) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then(m => m || caches.match('./index.html'))));
});
