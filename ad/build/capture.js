// Capture real DentOrdo / DentaGest DZ screens with demo data, phone viewport @3x
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const S = __dirname;
const OUT = path.join(S, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const URL = 'file://' + path.join(S, 'app', 'index.html');

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'fr-FR' });
  const p = await ctx.newPage();
  const clk = async (sel) => { await p.evaluate(sel => { const m = sel.match(/^(.*) >> nth=(\d+)$/); const els = document.querySelectorAll(m ? m[1] : sel); const el = els[m ? +m[2] : 0]; if (!el) throw new Error('no ' + sel); el.click(); }, sel); await p.waitForTimeout(150); };
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto(URL);
  // force a first save so the seed lands in localStorage
  await p.evaluate(() => { document.querySelector('[data-v="rx"]').click(); });
  await clk('[data-act="fmt"][data-f="A5"]');
  await p.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('dentordo_v1'));
    Object.assign(db.settings, {
      nom: 'Dr. Amira BENALI', titre: 'Chirurgien-Dentiste',
      diplomes: 'Diplômée de la Faculté de Médecine Dentaire d’Alger · Soins · Prothèse · Chirurgie',
      adresse: 'Cité 500 Logements, Bab Ezzouar - Alger', ville: 'Alger', tel: '0550 12 34 56',
      horaires: 'Du samedi au jeudi : 09h00 - 17h00', ordre: '16/0000',
      nomAr: 'الدكتورة أميرة بن علي', titreAr: 'جرّاحة أسنان', diplomesAr: 'كلية طب الأسنان - الجزائر',
      couleur: '#0d9488', layout: 'classic', format: 'A5', logo: ''
    });
    const P = (id, nom, prenom, naissance, tel, risks) => ({ id, nom, prenom, naissance, tel, risks, notes: '' });
    db.patients = [
      P('p1', 'Meziane', 'Karim', '1987-04-12', '0661 23 45 67', ['penicilline']),
      P('p2', 'Bouzid', 'Sara', '1995-09-03', '0770 98 76 54', ['grossesse']),
      P('p3', 'Hadj', 'Yacine', '2016-02-20', '0555 11 22 33', []),
      P('p4', 'Taleb', 'Nadia', '1979-11-30', '0662 44 55 66', []),
      P('p5', 'Cherif', 'Mourad', '1958-06-15', '0550 77 88 99', ['anticoagulant', 'hta']),
      P('p6', 'Amrani', 'Lina', '2001-01-08', '0771 12 12 12', ['asthme'])
    ];
    const d = id => db.drugs.find(x => x.id === id);
    const line = (id) => { const x = d(id); return { t: 'd', id: Math.random().toString(36).slice(2), drugId: x.id, nom: x.nom, dci: x.dci, dosage: x.dosage, forme: x.forme, qte: x.qte, poso: x.poso, duree: x.duree, alerts: x.alerts, note: x.note, marques: x.marques, enfant: x.enfant }; };
    const t0 = Date.now();
    const days = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    db.rx = [
      { id: 'r1', patientId: 'p4', pName: 'TALEB Nadia', pAge: '46', date: days(0), lines: [line('para1g'), line('chx012')], note: '', createdAt: t0 - 1000 },
      { id: 'r2', patientId: 'p5', pName: 'CHERIF Mourad', pAge: '68', date: days(1), lines: [line('para1g'), line('mico')], note: '', createdAt: t0 - 2000 },
      { id: 'r3', patientId: 'p3', pName: 'HADJ Yacine', pAge: '10', date: days(2), lines: [line('amox1g'), line('para500')], note: '', createdAt: t0 - 3000 },
      { id: 'r4', patientId: 'p2', pName: 'BOUZID Sara', pAge: '31', date: days(3), lines: [line('spira3'), line('para1g')], note: '', createdAt: t0 - 4000 },
      { id: 'r5', patientId: 'p6', pName: 'AMRANI Lina', pAge: '25', date: days(5), lines: [line('desens'), line('gelfluor')], note: '', createdAt: t0 - 5000 },
      { id: 'r6', patientId: 'p1', pName: 'MEZIANE Karim', pAge: '39', date: days(8), lines: [line('clinda300'), line('para1g')], note: '', createdAt: t0 - 6000 }
    ];
    db.draft = { id: null, patientId: '', pName: '', pAge: '', date: new Date().toISOString().slice(0, 10), lines: [], note: '', editTpl: null };
    localStorage.setItem('dentordo_v1', JSON.stringify(db));
  });
  await p.reload();
  await p.addStyleTag({ content: '*{scrollbar-width:none} ::-webkit-scrollbar{display:none} .toast{display:none!important}' });

  const hideNav = async (h) => p.evaluate(h => { document.getElementById('side').style.display = h ? 'none' : ''; }, h);
  const shot = async (name, full) => {
    await p.waitForTimeout(250);
    await hideNav(true);
    await p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: !!full });
    await hideNav(false);
    const h = await p.evaluate(() => document.documentElement.scrollHeight);
    console.log(name, h);
  };
  const nav = async v => { await clk(`[data-act="nav"][data-v="${v}"]`); await p.waitForTimeout(200); };

  // bottom nav bar alone (for overlay) on each view
  for (const v of ['dash', 'rx', 'drugs', 'pat', 'hist']) {
    await nav(v);
    await p.locator('#side').screenshot({ path: path.join(OUT, 'nav-' + v + '.png') });
  }

  const meas = {};
  const abs = (sel, n) => p.evaluate(([sel, n]) => { const e = document.querySelectorAll(sel)[n || 0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + scrollY, w: r.width, h: r.height }; }, [sel, n]);
  await nav('dash');
  meas.dashTplBtn = await abs('[data-act="useTpl"]', 1);
  meas.dashModels = await abs('.card h3', 1);
  await shot('dash', true);

  // Template → prescription for Taleb Nadia (no risk)
  await clk('[data-act="useTpl"] >> nth=1'); // Chirurgie dent de sagesse
  await p.evaluate(()=>{const e=document.querySelector('select[data-d="patientId"]');e.value='p4';e.dispatchEvent(new Event('change',{bubbles:true}))});
  await p.waitForTimeout(200);
  meas.rxLines = await abs('#lines');
  meas.rxLn2 = await abs('.ln', 1);
  meas.rxPv = await abs('#pvWrap');
  meas.rxPatient = await abs('.card');
  await shot('rx-full', true);
  // paper preview high-res element
  await p.locator('#pvPaper .paper').screenshot({ path: path.join(OUT, 'paper-rx.png') });

  // same with allergic patient → warnings
  await p.evaluate(()=>{const e=document.querySelector('select[data-d="patientId"]');e.value='p1';e.dispatchEvent(new Event('change',{bubbles:true}))});
  await p.waitForTimeout(200);
  meas.alPatient = await abs('.card');
  meas.alBadge = await abs('.chips .badge.red');
  meas.alLn = await abs('.ln');
  meas.alWarn = await abs('.warn');
  await shot('rx-allergy', true);
  const warnBox = await p.locator('.warn').first().boundingBox();
  const lnBox = await p.locator('.ln').first().boundingBox();
  const scrollY = await p.evaluate(() => scrollY);
  fs.writeFileSync(path.join(OUT, 'allergy.json'), JSON.stringify({ warnBox, lnBox, scrollY }));
  await p.locator('.ln').first().screenshot({ path: path.join(OUT, 'ln-allergy.png') });

  // drug search
  await nav('drugs'); await shot('drugs', true);
  await p.fill('input[data-q="drugQ"]', 'amox');
  await shot('drugs-amox', false);
  await p.fill('input[data-q="drugQ"]', '');

  await nav('pat'); await shot('pat', true);
  await nav('hist'); await shot('hist', true);
  await nav('tpl'); await shot('tpl', true);
  await nav('set'); await shot('set', true);

  // Cabinet layout paper (A5) too
  await p.evaluate(() => { const db = JSON.parse(localStorage.getItem('dentordo_v1')); db.settings.layout = 'cabinet'; db.settings.couleur = '#1f3a68'; localStorage.setItem('dentordo_v1', JSON.stringify(db)); });
  await p.reload();
  await nav('hist');
  await clk('[data-act="editRx"] >> nth=0');
  await p.waitForTimeout(300);
  await p.locator('#pvPaper .paper').screenshot({ path: path.join(OUT, 'paper-cab.png') });

  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meas, null, 1));
  await b.close();
})();
