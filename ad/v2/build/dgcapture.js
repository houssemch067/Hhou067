// Capture real DentaGest DZ screens (demo data) @3x + element rects, and render reel frames
const open = require('./dgsession');
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'dg2'); fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'reel'), { recursive: true });
(async () => {
  const { b, p } = await open(3);
  const meta = {};
  // rename fictional doctor to avoid clashing with demo patient surnames
  const rect = (sel, i = 0, text) => p.evaluate(([sel, i, text]) => {
    let els = [...document.querySelectorAll(sel)].filter(e => e.offsetParent || e.getClientRects().length);
    if (text) els = els.filter(e => (e.innerText || '').includes(text));
    const e = els[i]; if (!e) return null; const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, [sel, i, text]);
  const shot = async (n) => { await p.waitForTimeout(450); await p.screenshot({ path: path.join(OUT, n + '.png') }); console.log('shot', n); };
  const scroller = () => p.evaluate(() => { const s = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.clientHeight > 300); window.__sc = s[s.length - 1]; return !!window.__sc; });
  const scrollTo = async y => { await scroller(); await p.evaluate(y => { if (window.__sc) window.__sc.scrollTop = y; else scrollTo(0, y) }, y); await p.waitForTimeout(350); };
  const toast = () => p.evaluate(() => document.querySelectorAll('.toast,#toast,[class*=toast]').forEach(e => e.style.display = 'none'));

  await p.go('accueil'); await toast();
  meta.acc_kpis = await rect('.kpis');
  await shot('accueil');

  await p.go('agenda'); await toast();
  meta.ag_rappels = await rect('[data-a="rappels"]');
  meta.ag_first = await rect('[data-a="rdv-edit"]', 0);
  meta.ag_status = await rect('[data-a="rdv-cycle"]', 1);
  await shot('agenda');
  await p.clickSel('[data-a="rappels"]');
  meta.rap_wa = await rect('[data-a="rap-wa"]', 0);
  await shot('rappels');
  await p.clickSel('[data-a="close"]');

  await p.go('patients'); await toast();
  meta.pat_first = await rect('[data-a="pat-open"]', 0);
  await shot('patients');
  await p.clickSel('[data-a="pat-open"]', 0);
  meta.pt_allergy = await rect('div', 0, 'Allergies : P');
  await shot('patient');
  // scroll so the dental chart is in view
  await scroller();
  const chartTop = await p.evaluate(() => { const h = [...document.querySelectorAll('h2,h3')].find(e => /Schéma dentaire/.test(e.innerText)); const sc = window.__sc; return h && sc ? h.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop : 0; });
  await scrollTo(chartTop - 20);
  meta.pt_tooth = await rect('[data-a="tooth"]', 0);
  await shot('patient-chart');
  await scrollTo(chartTop + 330);
  await shot('patient-chart2');

  await p.go('ordonnances'); await toast();
  await shot('ordonnances');
  await p.clickSel('[data-a="ordo-open"]', 0);
  meta.ordo_pdf = await rect('[data-a="ordo-pdf"]', 0);
  await shot('ordo');
  await p.clickSel('[data-a="close"]');
  await p.clickSel('[data-a="pers-open"]', 0);
  meta.pers_styles = await rect('[data-a="os"]', 0);
  await shot('pers');
  // try other styles for a quick style carousel
  const nStyles = await p.evaluate(() => document.querySelectorAll('[data-a="os"]').length);
  for (let i = 1; i < Math.min(4, nStyles); i++) { await p.clickSel('[data-a="os"]', i); await shot('pers' + i); }
  await p.clickSel('[data-a="close"]');

  await p.go('caisse'); await toast();
  meta.cs_reste = await rect('div', 0, 'Reste à encaisser');
  await shot('caisse');
  await p.clickSel('[data-a="pay-edit"]', 1);
  meta.pay_pdf = await rect('[data-a="pay-pdf"]', 0);
  await shot('pay');
  await p.clickSel('[data-a="close"]');

  await p.go('modeles'); await toast(); await shot('modeles');
  await p.go('medicaments'); await toast(); await shot('medicaments');
  await p.go('reel'); await toast(); await shot('reel-gallery');

  // dark mode dashboard
  await p.go('parametres');
  const dark = await p.evaluate(() => { const e = [...document.querySelectorAll('[data-a="look-mode"]')].find(x => /Sombre/.test(x.innerText)); if (e) { e.click(); return true } return false });
  await p.waitForTimeout(500);
  await p.go('accueil'); await toast(); await shot('accueil-dark');
  await p.go('agenda'); await shot('agenda-dark');
  console.log('dark', dark);

  // bottom navigation height etc.
  meta.vp = { w: 390, h: 844 };
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));

  // reel frames: "curseur" template, rendered by the app's own engine at 1080x1920, 30 fps
  await p.go('reel');
  const spec = [['curseur', 0.6, 5.4], ['neon', 6.0, 9.0]];
  for (const [id, a, z] of spec) {
    const n = Math.round((z - a) * 30);
    for (let k = 0; k < n; k += 15) {
      const frames = await p.evaluate(([id, a, k, n]) => {
        const R = rlDemo(); RL.R = R; const c = document.createElement('canvas'); c.width = 1080; c.height = 1920; const x = c.getContext('2d');
        const o = { titre: '', nom: 'Dr Nadia Kaci', sim: false, logo: false, logoImg: null };
        const tp = RL_TPL.find(t => t.id === id); const out = [];
        for (let j = k; j < Math.min(n, k + 15); j++) { rlRender(tp, x, a + j / 30, o); out.push(c.toDataURL('image/jpeg', .9)); }
        return out;
      }, [id, a, k, n]);
      frames.forEach((d, j) => fs.writeFileSync(path.join(OUT, 'reel', `${id}_${String(k + j).padStart(4, '0')}.jpg`), Buffer.from(d.split(',')[1], 'base64')));
    }
    console.log('reel', id, n);
  }
  await b.close();
})();
