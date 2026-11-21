// shared: open DentaGest DZ with demo data, payment host blocked
const { chromium } = require('playwright');
module.exports = async function open(dsf){
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:dsf||1,isMobile:true,hasTouch:true,locale:'fr-FR'});
  await ctx.route(/dentagest-paiement/, r=>r.abort());
  await ctx.addInitScript(()=>{try{sessionStorage.setItem('dg_install_skip','1')}catch(e){}});
  const p=await ctx.newPage(); p.on('pageerror',e=>console.log('ERR',e.message));
  await p.goto('https://dentagest-dz.dentagestdz.workers.dev/',{waitUntil:'networkidle'});
  await p.waitForTimeout(3200);
  const f={ob_praticien:'Dr Nadia Kaci',ob_cabinet:'Sourire Bab Ezzouar',ob_tel:'0550 12 34 56',ob_ville:'Alger',ob_adresse:'Cité 500 Logements, Bab Ezzouar',ob_ordre:'16/0000',ob_mentions:'Soins esthétiques - Extraction - Prothèse - Blanchiment'};
  for(const k in f){const l=p.locator('#'+k);if(await l.count()&&await l.isVisible())await l.fill(f[k]);}
  await p.evaluate(()=>{const el=[...document.querySelectorAll('button')].find(e=>e.offsetParent&&/Commencer mon essai/.test(e.innerText));el&&el.click()});
  await p.waitForTimeout(900);
  await p.evaluate(()=>{const el=document.querySelector('[data-a="demo-load"]');el&&el.click()});
  await p.waitForTimeout(1200);
  p.go=async h=>{await p.evaluate(h=>location.hash=h,h);await p.waitForTimeout(700);await p.evaluate(()=>scrollTo(0,0))};
  p.clickSel=async(sel,i=0)=>{const ok=await p.evaluate(([s,i])=>{const e=document.querySelectorAll(s)[i];if(e){e.click();return true}return false},[sel,i]);await p.waitForTimeout(700);return ok};
  p.clickText=async t=>{const ok=await p.evaluate(t=>{const el=[...document.querySelectorAll('button,a,[data-a]')].reverse().find(e=>e.offsetParent&&e.innerText&&e.innerText.trim().startsWith(t));if(el){el.click();return true}return false},t);await p.waitForTimeout(700);return ok};
  return {b,ctx,p};
}
