// Test de l'assistant WhatsApp : titulaire + assistante, faux services Claude et WhatsApp (tests/mock.cjs)
const { chromium } = require('playwright');
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://127.0.0.1:8787/';
const MOCK = 'http://127.0.0.1:8790';
const SHOTS = __dirname + '/../.shots/';
require('fs').mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log('•', ...a);
const assert = (c, m) => { if (!c) throw new Error('ÉCHEC : ' + m); log('OK', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mock = async (p) => (await fetch(MOCK + p)).json();

async function phone(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, locale: 'fr-FR', serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('[' + name + ' erreur JS]', e.message));
  await p.goto(BASE);
  const skip = await p.waitForSelector('#dgi-skip', { timeout: 5000 }).catch(() => null);
  if (skip && await skip.isVisible()) { await skip.click(); await sleep(400); }
  return { ctx, p };
}
const click = async (p, a) => { const m = await p.$('#modal [data-a="' + a + '"]'); return m ? m.click() : p.click('[data-a="' + a + '"]'); };
const waitSynced = (p, ms = 20000) => p.waitForFunction(() => { const C = Cloud.state(); return Cloud.on() && !C.busy && !Object.keys(C.out).length && !C.err && C.st.last; }, null, { timeout: ms });
async function hook(body, secret = 'testsecret') {
  const raw = JSON.stringify(body), sig = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const r = await fetch(BASE + 'wa/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: raw });
  return r.status;
}
const waMsg = (id, from, text, type = 'text') => ({ object: 'whatsapp_business_account', entry: [{ id: 'x', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1234567890', display_phone_number: '213555000000' }, contacts: [{ wa_id: from, profile: { name: 'Karima B.' } }], messages: [type === 'text' ? { id, from, timestamp: '1', type: 'text', text: { body: text } } : { id, from, timestamp: '1', type: 'audio', audio: { id: 'm1' } }] } }] }] });

(async () => {
  const browser = await chromium.launch();
  try {
    await mock('/__reset');
    const A = await phone(browser, 'titulaire'); const a = A.p;
    await a.waitForSelector('#ob_praticien', { timeout: 15000 }); await sleep(3000);
    await a.fill('#ob_praticien', 'Benali Karim'); await a.fill('#ob_cabinet', 'Cabinet Les Oliviers');
    await a.fill('#ob_tel', '0550 11 22 33'); await a.fill('#ob_ville', 'Blida'); await a.fill('#ob_adresse', '12 rue des Oliviers');
    await click(a, 'onb-go'); await sleep(800);
    // un patient avec un RDV demain 09:00 : ce créneau ne doit pas être proposé
    await a.evaluate(() => { Store.save('patients', { id: 'pz', nom: 'ZERROUKI', prenom: 'Secret', tel: '0555 44 55 66', dents: {}, cree: today() }); Store.save('rdv', { id: 'rz', patientId: 'pz', date: (() => { let d = addDays(today(), 1); if (new Date(d + 'T12:00:00').getDay() === 5) d = addDays(d, 1); return d; })(), heure: '09:00', motif: 'Extraction', statut: 'prevu', duree: 30 }); });
    await a.evaluate(() => location.hash = 'parametres'); await sleep(500);
    assert(await a.$('.wa-card') && (await a.textContent('.wa-card')).includes('cloud du cabinet'), 'carte assistant : demande d’activer le cloud d’abord');
    await click(a, 'cl-create'); await a.fill('#cl_login', 'dr.benali.wa'); await a.fill('#cl_pw', 'Oliviers2026!'); await a.fill('#cl_pw2', 'Oliviers2026!');
    await click(a, 'cl-create-go'); await a.waitForSelector('#cl_rc', { timeout: 30000 }); await a.check('#cl_rc_ok'); await click(a, 'cl-rc-done'); await waitSynced(a);

    /* réglages */
    await click(a, 'wa-set'); await a.waitForSelector('#wa_h0');
    await a.screenshot({ path: SHOTS + 'wa-01-reglages.png' });
    await a.fill('#wa_h0', 'n’importe quoi'); await click(a, 'wa-set-go');
    assert((await a.textContent('#cl_err')).includes('Dimanche'), 'horaires mal écrits refusés');
    for (const k of [0, 1, 2, 3, 4, 6]) await a.fill('#wa_h' + k, '09:00-12:00, 14:00-17:00');
    await a.fill('#wa_cons', 'Paiement en espèces uniquement.');
    await a.fill('#wa_phone', '0555 00 00 00'); await a.fill('#wa_pid', '1234567890'); await a.fill('#wa_tok', 'EAAG-test-token');
    await click(a, 'wa-set-go'); await a.waitForFunction(() => !document.querySelector('#modal').innerHTML, null, { timeout: 15000 });
    await a.waitForFunction(() => /Activé/.test(document.querySelector('.wa-card').textContent), null, { timeout: 10000 });
    await a.screenshot({ path: SHOTS + 'wa-02-carte.png' });
    log('OK réglages enregistrés, assistant activé');

    /* essai dans l'application */
    await click(a, 'wa-test'); await a.fill('#wa_msg', 'Salam, win rakoum ?'); await click(a, 'wa-test-send');
    await a.waitForFunction(() => [...document.querySelectorAll('.wa-b.bot')].some((b) => /Oliviers/.test(b.textContent)), null, { timeout: 15000 });
    assert(true, 'réponse de l’assistant avec l’adresse du cabinet');
    await a.fill('#wa_msg', 'Nheb rendez-vous svp'); await click(a, 'wa-test-send');
    await a.waitForFunction(() => [...document.querySelectorAll('.wa-b.bot')].some((b) => /confirmer/.test(b.textContent)), null, { timeout: 15000 });
    await a.screenshot({ path: SHOTS + 'wa-03-essai.png' });
    let L = await mock('/__log'); const req0 = L.claude[0], sys = req0.system.map((s) => s.text).join('\n');
    assert(req0.model === 'claude-haiku-5-5' && req0.output_config.effort === 'low' && req0.tools.every((t) => t.strict), 'appel Claude : Haiku 5.5, effort bas, outils stricts');
    assert(sys.includes('Cabinet Les Oliviers') && sys.includes('12 rue des Oliviers') && sys.includes('Paiement en espèces') && sys.includes('Détartrage'), 'consignes : infos du cabinet, tarifs et consignes');
    assert(!sys.includes('ZERROUKI') && !sys.includes('Secret') && !sys.includes('0555 44'), 'aucune donnée patient envoyée à l’IA');
    const tomorrow = await a.evaluate(() => S.rdv.find((r) => r.id === 'rz').date);
    assert(!new RegExp('\\(' + tomorrow + '\\) : 09:00').test(sys) && new RegExp('\\(' + tomorrow + '\\) : 09:30').test(sys), 'créneau déjà pris (' + tomorrow + ' 09:00) non proposé, 09:30 proposé');

    /* demande d'essai → acceptée */
    await a.waitForFunction(() => Assistant.state().items.some((x) => x.status === 'new' && x.type === 'rdv'), null, { timeout: 15000 });
    await click(a, 'wa-inbox'); await a.waitForSelector('[data-a="wa-accept"]');
    await a.screenshot({ path: SHOTS + 'wa-04-demandes.png' });
    await click(a, 'wa-accept'); await a.waitForSelector('#wa_rep');
    assert((await a.inputValue('#wa_rep')).includes('confirmé'), 'message de confirmation préparé');
    await click(a, 'wa-send'); await sleep(800);
    const rdvA = await a.evaluate(() => S.rdv.filter((r) => r.note === 'Demande WhatsApp'));
    assert(rdvA.length === 1 && rdvA[0].statut === 'confirme', 'RDV ajouté à l’agenda');
    await click(a, 'close').catch(() => {});

    /* vrai message WhatsApp (webhook signé) */
    assert(await hook(waMsg('wamid.1', '213555000111', 'Bonsoir'), 'mauvais') === 401, 'webhook : signature invalide refusée');
    assert(await hook(waMsg('wamid.1', '213555000111', 'Bonjour, je voudrais un rendez-vous')) === 200, 'webhook : message accepté');
    await sleep(2500);
    assert(await hook(waMsg('wamid.1', '213555000111', 'Bonjour, je voudrais un rendez-vous')) === 200, 'webhook : renvoi du même message');
    await sleep(1500);
    L = await mock('/__log');
    const sent = L.graph.filter((g) => g.body.type === 'text');
    assert(sent.length === 1 && sent[0].body.to === '213555000111' && /confirmer/.test(sent[0].body.text.body) && sent[0].auth === 'Bearer EAAG-test-token' && sent[0].url.includes('/1234567890/messages'), 'réponse envoyée au patient sur WhatsApp, une seule fois');
    assert(L.graph.some((g) => g.body.status === 'read'), 'message marqué comme lu');
    assert(await hook(waMsg('wamid.2', '213555000222', '', 'audio')) === 200, 'message vocal reçu'); await sleep(2000);
    assert(await hook(waMsg('wamid.3', '213555000333', 'Ma joue est gonflée et j’ai de la fièvre')) === 200, 'urgence reçue'); await sleep(2500);

    /* l'assistante voit et traite les demandes sur son téléphone */
    await click(a, 'cl-team').catch(async () => { await a.evaluate(() => location.hash = 'parametres'); await sleep(300); await click(a, 'cl-team'); });
    await a.waitForSelector('[data-a="cl-mem-add"]'); await click(a, 'cl-mem-add');
    await a.fill('#cl_mname', 'Amina Kaci'); await a.fill('#cl_mlogin', 'amina.wa'); await a.selectOption('#cl_prof', 'secretaire');
    await click(a, 'cl-mem-add-go'); await a.waitForSelector('.cl-cred', { timeout: 30000 });
    const tmp = (await a.textContent('.cl-cred .cl-mono')).trim(); await click(a, 'cl-team'); await sleep(500); await click(a, 'close').catch(() => {});
    const B = await phone(browser, 'assistante'); const b = B.p;
    await b.waitForSelector('.ob-join', { timeout: 15000 }); await b.click('.ob-join');
    await b.fill('#cl_login', 'amina.wa'); await b.fill('#cl_pw', tmp); await click(b, 'cl-login-go');
    await b.waitForSelector('#cl_pw2', { timeout: 30000 }); await b.fill('#cl_pw', 'AminaKaci99'); await b.fill('#cl_pw2', 'AminaKaci99'); await click(b, 'cl-pwd-go');
    await b.waitForFunction(() => !document.querySelector('#modal').innerHTML, null, { timeout: 30000 }); await waitSynced(b);
    await b.waitForFunction(() => Assistant.state().items.filter((x) => x.status === 'new').length === 3, null, { timeout: 20000 });
    await b.evaluate(() => { location.hash = 'agenda'; render(); }); await sleep(500);
    const ban = await b.textContent('.wa-banner');
    assert(/3 demandes/.test(ban) && /1 urgence/.test(ban), 'bandeau chez l’assistante : ' + ban.trim());
    await b.screenshot({ path: SHOTS + 'wa-05-bandeau.png' });
    await b.click('.wa-banner'); await b.waitForSelector('.wa-item');
    assert((await b.textContent('.wa-item')).includes('Urgence'), 'urgence en premier');
    await b.screenshot({ path: SHOTS + 'wa-06-demandes-assistante.png' });
    await b.click('.wa-item.t-rdv [data-a="wa-accept"]'); await b.waitForSelector('#wa_rep'); await click(b, 'wa-send'); await sleep(1200);
    L = await mock('/__log');
    assert(L.graph.some((g) => g.body.to === '213555000111' && /confirmé/.test(g.body.text && g.body.text.body)), 'confirmation envoyée au patient depuis le téléphone de l’assistante');
    const pB = await b.evaluate(() => S.patients.find((p) => p.source === 'whatsapp' && !p.ex));
    assert(pB && pB.tel === '0555 00 01 11', 'nouvelle fiche patient créée avec son numéro : ' + (pB && pB.tel));
    await waitSynced(b); await a.evaluate(() => Cloud.sync()); await waitSynced(a);
    assert(await a.evaluate((id) => S.rdv.some((r) => r.patientId === id), pB.id), 'RDV visible sur le téléphone du titulaire');

    /* consommation */
    await a.evaluate(() => { location.hash = 'parametres'; render(); }); await sleep(1500);
    const card = await a.textContent('.wa-card'); log(card.replace(/\s+/g, ' ').slice(280, 420));
    assert(/Ce mois : 3 \/ 500 conversations/.test(card), 'compteur : 3 conversations (le message vocal n’utilise pas l’IA)');
    console.log('\nTOUS LES TESTS DE L’ASSISTANT SONT PASSÉS');
  } catch (e) { console.error(e); process.exitCode = 1; } finally { await browser.close(); }
})();
