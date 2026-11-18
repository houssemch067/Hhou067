// DentaGest DZ: the app page and the Android install guide are served by this script;
// every other file (sw.js, fonts, icons, vendor...) is a static asset.
import APP from './public/index.html';
import GUIDE from './public/installer-android.html';
const PAGES = { '/': APP, '/index.html': APP, '/installer-android': GUIDE, '/installer-android.html': GUIDE };
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    // The Android APK was replaced by installing the web app from Chrome: old download links open the guide.
    if (u.pathname.startsWith('/downloads/')) return Response.redirect(u.origin + '/installer-android', 302);
    const html = PAGES[u.pathname];
    if (html && (req.method === 'GET' || req.method === 'HEAD'))
      return new Response(req.method === 'HEAD' ? null : html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' } });
    return env.ASSETS.fetch(req);
  }
};
