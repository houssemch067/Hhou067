const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8787/';
const SHOTS = __dirname + '/../.shots/';
require('fs').mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log('•', ...a);
const assert = (c, m) => { if (!c) throw new Error('ÉCHEC : ' + m); log('OK', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function phone(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, locale: 'fr-FR', serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('[' + name + ' erreur JS]', e.message));
  p.on('console', m => { if (m.type() === 'error' && !/TUNNEL|401|INTERNET/.test(m.text())) console.log('[' + name + ' console]', m.text()); });
  await p.goto(BASE);
  const skip = await p.waitForSelector('#dgi-skip', { timeout: 5000 }).catch(() => null);
  if (skip && await skip.isVisible()) { await skip.click(); await sleep(400); }
  return { ctx, p };
}
const waitSynced = (p, ms = 20000) => p.waitForFunction(() => { const C = Cloud.state(); return Cloud.on() && !C.busy && !Object.keys(C.out).length && !C.err && C.st.last; }, null, { timeout: ms });
const click = async (p, a) => { const m = await p.$('#modal [data-a="' + a + '"]'); return m ? m.click() : p.click('[data-a="' + a + '"]'); };

(async () => {
  const browser = await chromium.launch();
  try {
    /* ---------- Titulaire ---------- */
    const A = await phone(browser, 'titulaire'); const a = A.p;
    await a.waitForSelector('#ob_praticien', { timeout: 15000 });
    await sleep(3000);
    await a.screenshot({ path: SHOTS + '01-onboarding.png' });
    await a.fill('#ob_praticien', 'Benali Karim'); await a.fill('#ob_cabinet', 'Cabinet Les Oliviers');
    await a.fill('#ob_tel', '0550 11 22 33'); await a.fill('#ob_ville', 'Blida');
    await click(a, 'onb-go'); await sleep(800);
    await a.evaluate(() => {
      for (let i = 0; i < 25; i++) Store.save('patients', { id: 'p' + i, nom: 'PATIENT' + i, prenom: 'Test', tel: '0550 00 00 ' + String(i).padStart(2, '0'), dents: {}, cree: today() });
      Store.save('paiements', { id: 'pay1', patientId: 'p1', acte: 'Détartrage', montant: 4000, verse: 4000, date: today(), num: 1 });
      Store.save('ordos', { id: 'o1', patientId: 'p2', date: today(), lignes: [], conseils: '', num: 1 });
    });
    await a.evaluate(() => location.hash = 'parametres'); await sleep(500);
    await a.screenshot({ path: SHOTS + '02-parametres-avant.png' });
    await click(a, 'cl-create');
    assert(await a.inputValue('#cl_login') === 'dr.benali.karim', 'identifiant proposé à partir du nom : ' + await a.inputValue('#cl_login'));
    await a.fill('#cl_login', 'dr.benali');
    await a.fill('#cl_pw', 'court'); await a.fill('#cl_pw2', 'court'); await click(a, 'cl-create-go');
    assert((await a.textContent('#cl_err')).includes('8 caractères'), 'mot de passe trop court refusé');
    await a.fill('#cl_pw', 'Oliviers2026!'); await a.fill('#cl_pw2', 'Oliviers2026!');
    const t0 = Date.now(); await click(a, 'cl-create-go');
    await a.waitForSelector('#cl_rc', { timeout: 30000 }); log('création + dérivation des clés en', Date.now() - t0, 'ms');
    const rc = (await a.textContent('#cl_rc')).trim();
    assert(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/.test(rc), 'code de secours affiché : ' + rc);
    await a.screenshot({ path: SHOTS + '03-code-secours.png' });
    await click(a, 'cl-rc-done'); assert((await a.textContent('#cl_err')).includes('Cochez'), 'case de confirmation exigée');
    await a.check('#cl_rc_ok'); await click(a, 'cl-rc-done');
    await waitSynced(a);
    assert((await a.textContent('#sync')).includes('Synchronisé'), 'indicateur : ' + await a.textContent('#sync'));
    await a.screenshot({ path: SHOTS + '04-parametres-cloud.png' });

    /* le serveur ne contient que du chiffré */
    const raw = await a.evaluate(async () => { const r = await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + Cloud.state().st.token }, body: '{"since":0}' }); return r.text(); });
    assert(!raw.includes('PATIENT') && !raw.includes('Oliviers') && !raw.includes('Benali'), 'aucune donnée lisible côté serveur (' + raw.length + ' octets)');
    assert(JSON.parse(raw).changes.length === 28, 'toutes les fiches envoyées : ' + JSON.parse(raw).changes.length);

    /* ---------- Ajout d'une assistante ---------- */
    await click(a, 'cl-team'); await a.waitForSelector('[data-a="cl-mem-add"]');
    await click(a, 'cl-mem-add');
    await a.fill('#cl_mname', 'Amina Kaci'); await a.fill('#cl_mlogin', 'amina.oliviers');
    await a.selectOption('#cl_prof', 'assistante');
    assert(await a.evaluate(() => [...document.querySelectorAll('.cl-perm')].filter(x => x.checked).map(x => x.value).join('')) === 'o', 'profil Assistante = ordonnances seulement');
    await a.screenshot({ path: SHOTS + '05-ajout-membre.png' });
    await click(a, 'cl-mem-add-go'); await a.waitForSelector('.cl-cred', { timeout: 30000 });
    const tmp = (await a.textContent('.cl-cred .cl-mono')).trim();
    assert(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(tmp), 'mot de passe provisoire : ' + tmp);
    await a.screenshot({ path: SHOTS + '06-identifiants.png' });
    await click(a, 'cl-team'); await a.waitForSelector('.cl-mem >> nth=1');
    await a.screenshot({ path: SHOTS + '07-equipe.png' });
    await click(a, 'close');

    /* ---------- Assistante sur un 2e téléphone ---------- */
    const B = await phone(browser, 'assistante'); const b = B.p;
    await b.waitForSelector('.ob-join', { timeout: 15000 });
    await b.click('.ob-join');
    await b.fill('#cl_login', 'amina.oliviers'); await b.fill('#cl_pw', 'MAUVAIS'); await click(b, 'cl-login-go');
    await b.waitForFunction(() => document.querySelector('#cl_err') && document.querySelector('#cl_err').textContent.includes('incorrect'), null, { timeout: 30000 });
    log('OK mauvais mot de passe refusé');
    await b.fill('#cl_pw', tmp); await click(b, 'cl-login-go');
    await b.waitForSelector('#cl_pw2', { timeout: 30000 });
    assert((await b.textContent('.sheet h2')).includes('Choisissez votre mot de passe'), 'mot de passe personnel demandé à la 1re connexion');
    await b.screenshot({ path: SHOTS + '08-choix-mdp.png' });
    await b.fill('#cl_pw', 'AminaKaci99'); await b.fill('#cl_pw2', 'AminaKaci99'); await click(b, 'cl-pwd-go');
    await b.waitForFunction(() => !document.querySelector('#modal').innerHTML, null, { timeout: 30000 });
    await waitSynced(b);
    const bs = await b.evaluate(() => ({ pat: S.patients.length, pay: S.paiements.length, ordos: S.ordos.length, cab: S.config.cabinet, onb: !!document.querySelector('#onb'), nav: NAV.map(n => n[0]).join(','), lic: LIC.status, dev: licDevice(), owner: S.config.device }));
    log(JSON.stringify(bs));
    assert(bs.pat === 25 && bs.ordos === 1, 'patients et ordonnances reçus');
    assert(bs.pay === 0, 'la caisse n’est pas envoyée à l’assistante');
    assert(bs.cab === 'Cabinet Les Oliviers' && !bs.onb, 'paramètres du cabinet reçus, pas d’écran d’accueil');
    assert(!bs.nav.includes('caisse') && !bs.nav.includes('stats') && bs.nav.includes('ordonnances'), 'menu adapté aux droits');
    assert(bs.lic === 'trial' && bs.dev === bs.owner, 'abonnement partagé avec le cabinet');
    await b.evaluate(() => location.hash = 'patients'); await sleep(600);
    await b.screenshot({ path: SHOTS + '09-assistante-patients.png' });
    await b.evaluate(() => location.hash = 'caisse'); await sleep(300);
    assert(await b.evaluate(() => route()) === 'accueil', 'page Caisse inaccessible');
    await b.evaluate(() => Store.save('paiements', { id: 'hack', patientId: 'p1', acte: 'x', montant: 1, verse: 1, date: today() }));
    assert(await b.evaluate(() => !S.paiements.length && !Object.keys(Cloud.state().out).length), 'encaissement bloqué pour l’assistante');
    await b.evaluate(() => location.hash = 'parametres'); await sleep(400);
    await b.screenshot({ path: SHOTS + '10-assistante-parametres.png' });

    /* ---------- Échanges dans les deux sens ---------- */
    await b.evaluate(() => Store.save('rdv', { id: 'r1', patientId: 'p3', date: today(), heure: '10:30', motif: 'Contrôle', statut: 'prevu', duree: 30 }));
    await waitSynced(b);
    await a.evaluate(() => Cloud.sync()); await waitSynced(a);
    assert(await a.evaluate(() => S.rdv.some(r => r.id === 'r1' && r.heure === '10:30')), 'RDV de l’assistante reçu par le titulaire');
    await a.evaluate(() => { const p = pat('p3'); p.allergies = ['penicilline']; Store.save('patients', p) });
    await waitSynced(a); await b.evaluate(() => Cloud.sync()); await waitSynced(b);
    assert(await b.evaluate(() => (pat('p3').allergies || []).includes('penicilline')), 'allergie ajoutée par le titulaire visible chez l’assistante');
    await a.evaluate(() => Store.del('patients', 'p24')); await waitSynced(a);
    await b.evaluate(() => Cloud.sync()); await waitSynced(b);
    assert(await b.evaluate(() => !pat('p24')), 'suppression propagée');

    /* conflit : les deux modifient la même fiche, la plus récente gagne */
    await a.evaluate(() => { const p = pat('p5'); p.tel = 'A'; Store.save('patients', p) });
    await sleep(50);
    await b.evaluate(() => { const p = pat('p5'); p.tel = 'B'; Store.save('patients', p) });
    await waitSynced(a); await waitSynced(b);
    await a.evaluate(() => Cloud.sync()); await waitSynced(a); await b.evaluate(() => Cloud.sync()); await waitSynced(b);
    const tels = [await a.evaluate(() => pat('p5').tel), await b.evaluate(() => pat('p5').tel)];
    assert(tels[0] === 'B' && tels[1] === 'B', 'conflit résolu identiquement sur les deux appareils : ' + tels);

    /* ---------- Hors connexion ---------- */
    await A.ctx.setOffline(true);
    await a.evaluate(() => Store.save('patients', { id: 'off1', nom: 'HORSLIGNE', prenom: 'Patient', dents: {}, cree: today() }));
    await sleep(2500);
    const badgeOff = await a.textContent('#sync');
    assert(/Hors ligne/.test(badgeOff) && /1 en attente/.test(badgeOff), 'hors ligne : ' + badgeOff);
    await a.route('**/api/**', r => r.abort('internetdisconnected'));
    await A.ctx.setOffline(false); await a.reload(); await a.waitForFunction(() => ui.ready);
    await sleep(1500);
    assert(await a.evaluate(() => !!pat('off1') && Object.keys(Cloud.state().out).length === 1), 'modification hors ligne conservée après fermeture de l’appli');
    log('badge serveur injoignable :', await a.textContent('#sync'));
    await a.unroute('**/api/**'); await a.evaluate(() => dispatchEvent(new Event('online')));
    await waitSynced(a); await b.evaluate(() => Cloud.sync()); await waitSynced(b);
    assert(await b.evaluate(() => !!pat('off1')), 'fiche créée hors ligne arrivée chez l’assistante');

    /* ---------- Historique ---------- */
    await a.evaluate(() => location.hash = 'parametres'); await sleep(400);
    await click(a, 'cl-activity'); await a.waitForSelector('.cl-act', { timeout: 15000 }).catch(async e => { await a.screenshot({ path: SHOTS + 'fail.png' }); console.log(await a.evaluate(() => document.querySelector('#modal').innerText.slice(0, 500))); throw e; });
    const act = await a.$$eval('.cl-act', l => l.slice(0, 8).map(x => x.textContent));
    log(act.join(' | '));
    assert(act.some(x => x.includes('Amina Kaci') && x.includes('rendez-vous')), 'historique : qui a fait quoi');
    await a.screenshot({ path: SHOTS + '11-historique.png' });

    /* ---------- Retrait des droits en direct ---------- */
    await a.evaluate(() => location.hash = 'parametres'); await click(a, 'close').catch(() => { });
    const aminaId = await a.evaluate(async () => (await (await fetch('/api/team', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + Cloud.state().st.token }, body: '{}' })).json()).users.find(u => u.login === 'amina.oliviers').id);
    await a.evaluate(async id => { await fetch('/api/team/update', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + Cloud.state().st.token }, body: JSON.stringify({ id, perms: 'f' }) }) }, aminaId);
    await b.evaluate(() => Cloud.sync()); await waitSynced(b); await b.evaluate(() => Cloud.sync()); await waitSynced(b);
    const b2 = await b.evaluate(() => ({ ordos: S.ordos.length, pay: S.paiements.length, nav: NAV.map(n => n[0]).join(',') }));
    assert(b2.ordos === 0 && b2.pay === 1 && b2.nav.includes('caisse') && !b2.nav.includes('ordonnances'), 'droits modifiés appliqués en direct : ' + JSON.stringify(b2));

    /* ---------- Appareil perdu : déconnexion à distance ---------- */
    await click(a, 'cl-devices'); await a.waitForSelector('[data-a="cl-dev-revoke"]', { timeout: 15000 });
    await a.screenshot({ path: SHOTS + '12-appareils.png' });
    await click(a, 'cl-dev-revoke'); await click(a, 'confirm'); await sleep(1500);
    await b.evaluate(() => Cloud.sync()); await b.waitForSelector('[data-a="cl-reload"]', { timeout: 15000 });
    await b.screenshot({ path: SHOTS + '13-appareil-deconnecte.png' });
    assert(await b.evaluate(async () => !S.patients.length && !Cloud.on() && !JSON.parse(await IDB.get('state')).patients.length), 'données effacées de l’appareil déconnecté');

    /* ---------- Code de secours ---------- */
    const Cc = await phone(browser, 'nouveau téléphone'); const c = Cc.p;
    await c.waitForSelector('.ob-join', { timeout: 15000 }); await c.click('.ob-join');
    await click(c, 'cl-forgot');
    await c.fill('#cl_login', 'dr.benali'); await c.fill('#cl_rc', rc.toLowerCase().replace(/-/g, ' '));
    await c.fill('#cl_pw', 'NouveauMdp2026'); await c.fill('#cl_pw2', 'NouveauMdp2026'); await click(c, 'cl-forgot-go');
    await waitSynced(c, 40000);
    assert(await c.evaluate(() => S.patients.length === 25 && S.paiements.length === 1 && S.config.cabinet === 'Cabinet Les Oliviers'), 'accès retrouvé avec le code de secours, toutes les données déchiffrées');
    await a.evaluate(() => Cloud.sync()); await a.waitForSelector('[data-a="cl-reload"]', { timeout: 15000 });
    log('OK anciens appareils du titulaire déconnectés après réinitialisation');
    await c.evaluate(() => location.hash = 'accueil'); await sleep(600);
    await c.screenshot({ path: SHOTS + '14-accueil-synchronise.png' });
    console.log('\nTOUS LES TESTS SONT PASSÉS');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { await browser.close(); }
})();
