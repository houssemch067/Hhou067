// Capture real DentaGest DZ screens (demo data, fictional dentist) @3x, including the newer features
const open = require('../../v2/build/dgsession');
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'scr'); fs.mkdirSync(path.join(OUT, 'reel'), { recursive: true });
(async () => {
  const { b, p } = await open(3);
  const shot = async n => { await p.waitForTimeout(500); await p.evaluate(() => document.querySelectorAll('.toast,#toast,[class*=toast]').forEach(e => e.style.display = 'none')); await p.screenshot({ path: path.join(OUT, n + '.png') }); console.log('shot', n); };
  const scrollModal = y => p.evaluate(y => { const s = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.clientHeight > 300); const sc = s[s.length - 1]; if (sc) sc.scrollTop = y; else scrollTo(0, y) }, y).then(() => p.waitForTimeout(400));
  const scrollToText = (re, off = 20) => p.evaluate(([re, off]) => { const r = new RegExp(re); const h = [...document.querySelectorAll('h1,h2,h3,h4,label,b,strong,div')].find(e => e.children.length < 3 && r.test(e.innerText || '')); const s = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.clientHeight > 300); const sc = s[s.length - 1]; if (!h) return false; if (sc) sc.scrollTop += h.getBoundingClientRect().top - sc.getBoundingClientRect().top - off; else scrollBy(0, h.getBoundingClientRect().top - off); return true }, [re, off]).then(async r => { await p.waitForTimeout(400); return r });
  const close = () => p.clickSel('[data-a="close"]');

  await p.go('accueil'); await shot('accueil');
  await p.go('agenda'); await shot('agenda');
  await p.clickSel('[data-a="rappels"]'); await shot('rappels'); await close();
  await p.go('attente'); await shot('attente');

  await p.go('patients'); await p.clickSel('[data-a="pat-open"]', 0); await shot('patient');
  console.log('chart', await scrollToText('^Schéma dentaire')); await shot('chart');
  await p.go('patients'); await p.clickSel('[data-a="pat-open"]', 0);
  await p.clickSel('[data-a="pat-edit"]'); await shot('pat-edit');
  console.log('q', await scrollToText('[Qq]uestionnaire')); await shot('questionnaire');
  await close();

  await p.go('ordonnances'); await p.clickSel('[data-a="ordo-open"]', 0); await shot('ordo'); await close();
  await p.go('patients'); await p.clickSel('[data-a="pat-open"]', 0);
  await p.clickSel('[data-a="ordo-new"]'); await shot('ordo-new'); await close();
  await p.go('patients'); await p.clickSel('[data-a="pat-open"]', 0);
  await p.clickSel('[data-a="dv-new"]'); await shot('devis'); await scrollModal(400); await shot('devis2'); await close();
  await p.go('patients'); await p.clickSel('[data-a="pat-open"]', 0);
  await p.clickSel('[data-a="cert-new"]'); await shot('cert'); await close();

  await p.go('caisse'); await shot('caisse');
  await p.go('stats'); await shot('stats'); await scrollModal(500); await shot('stats2');
  await p.go('reel'); await shot('reel-gallery');

  // before/after reel frames rendered by the app's own engine
  const spec = [['curseur', 0.6, 3.6], ['neon', 6.0, 8.0]];
  for (const [id, a, z] of spec) {
    const n = Math.round((z - a) * 30);
    for (let k = 0; k < n; k += 15) {
      const frames = await p.evaluate(([id, a, k, n]) => {
        const R = rlDemo(); RL.R = R; const c = document.createElement('canvas'); c.width = 1080; c.height = 1920; const x = c.getContext('2d');
        const o = { titre: '', nom: 'Dr Nadia Kaci', sim: false, logo: false, logoImg: null };
        const tp = RL_TPL.find(t => t.id === id); const out = [];
        for (let j = k; j < Math.min(n, k + 15); j++) { rlRender(tp, x, a + j / 30, o); out.push(c.toDataURL('image/jpeg', .88)); }
        return out;
      }, [id, a, k, n]);
      frames.forEach((d, j) => fs.writeFileSync(path.join(OUT, 'reel', `${id}_${String(k + j).padStart(4, '0')}.jpg`), Buffer.from(d.split(',')[1], 'base64')));
    }
    console.log('reel', id, n);
  }
  await b.close();
})();
