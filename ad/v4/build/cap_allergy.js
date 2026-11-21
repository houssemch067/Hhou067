const open = require('../../v2/build/dgsession');
(async () => {
  const { b, p } = await open(3);
  await p.go('patients'); await p.clickSel('[data-a="pat-open"]', 0);
  await p.clickSel('[data-a="ordo-new"]');
  const inp = p.locator('input[placeholder*="amoxicilline"]').first();
  await inp.fill('amoxi'); await p.waitForTimeout(700);
  const opts = await p.evaluate(() => [...document.querySelectorAll('[data-a]')].filter(e=>e.offsetParent&&/amoxi/i.test(e.innerText)).map(e=>e.getAttribute('data-a')+'|'+e.innerText.slice(0,40)));
  console.log(opts);
  await p.evaluate(() => { const e=[...document.querySelectorAll('[data-a]')].filter(e=>e.offsetParent&&/amoxi/i.test(e.innerText))[0]; e&&e.click(); });
  await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelectorAll('.toast,#toast,[class*=toast]').forEach(e => e.style.display = 'none'));
  await p.screenshot({ path: 'scr/ordo-alert.png' });
  console.log(await p.evaluate(()=>{const e=[...document.querySelectorAll('div')].find(d=>/allerg/i.test(d.innerText)&&d.children.length<4&&d.offsetParent);if(!e)return null;const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height,e.innerText.slice(0,120)]}));
  await b.close();
})();
