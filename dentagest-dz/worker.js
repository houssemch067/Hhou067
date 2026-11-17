// DentaGest DZ: the app page (public/index.html) is served by this script;
// every other file (sw.js, fonts, icons, vendor, APK...) is a static asset.
import HTML from './public/index.html';
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if ((u.pathname === '/' || u.pathname === '/index.html') && (req.method === 'GET' || req.method === 'HEAD'))
      return new Response(req.method === 'HEAD' ? null : HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' } });
    return env.ASSETS.fetch(req);
  }
};
