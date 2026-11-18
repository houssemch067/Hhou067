/* DentaGest DZ — serveur de paiement (Cloudflare Worker)
   POST /checkout   {device, plan}  -> crée un paiement Chargily et renvoie {url}
   POST /webhook    (appelé par Chargily) -> vérifie la signature, émet la licence signée
   GET  /licence?device=DG-XXXX-XXXX -> {code} quand le paiement est confirmé
   POST /trial      {device, date}  -> compte anonymement un nouvel essai (trial:<device>, une seule fois)
   GET/POST /stats  (clé secrète)   -> essais par jour, essais en cours, appareils payants
   POST /admin/licence (Authorization: Bearer STATS_KEY) {device, plan} -> émet un code (paiements BaridiMob)
   Formules : m/y = Standard, pm/py = Pro (avec l'assistante IA WhatsApp)
   Secrets : CHARGILY_SECRET (clé secrète Chargily), LICENCE_PRIVATE_JWK (contenu de cle-privee.json), STATS_KEY (accès à /stats)
   Variables : CHARGILY_MODE = "test" ou "live" ; stockage KV : LICENCES */
const PRICES={m:{amount:2000,months:1,label:'Mensuel'},y:{amount:20000,months:12,label:'Annuel'},
 pm:{amount:4000,months:1,label:'Pro mensuel'},py:{amount:40000,months:12,label:'Pro annuel'}};
const tier=p=>p==='pm'||p==='py'?'pro':'std';
const b64uJson=s=>{try{s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0))))}catch(e){return null}};
/* émet et enregistre une licence. Prolonge à partir de la fin de l'abonnement en cours s'il est de la même formule ;
   en passant de Standard à Pro (ou l'inverse), la nouvelle formule commence aujourd'hui. */
async function issueLicence(env,device,plan){
 const P=PRICES[plan],today=new Date();
 const prev=await env.LICENCES.get('end:'+device),prevCode=await env.LICENCES.get('lic:'+device);
 const prevPlan=prevCode?(b64uJson(prevCode.split('.')[0])||{}).p:null;
 const same=!prevPlan||tier(prevPlan)===tier(plan);
 const start=same&&prev&&new Date(prev+'T12:00:00Z')>today?new Date(prev+'T12:00:00Z'):today;
 const payload={d:device,e:iso(addMonths(start,P.months)),p:plan,i:iso(today)},code=await signLicence(env,payload);
 await env.LICENCES.put('lic:'+device,code);await env.LICENCES.put('end:'+device,payload.e,{metadata:{e:payload.e}});
 return {code,payload};
}
const DEV=/^DG-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'Content-Type':'application/json',...cors}});
const page=(t,m)=>new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0A0A0A;color:#fff;font:16px system-ui;text-align:center;padding:24px"><div><h1 style="font-size:24px">'+t+'</h1><p style="color:#bbb">'+m+'</p></div>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
const b64u=b=>{let s='';const u=new Uint8Array(b);for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const iso=d=>d.toISOString().slice(0,10);
function addMonths(d,n){const x=new Date(d);const day=x.getUTCDate();x.setUTCMonth(x.getUTCMonth()+n);if(x.getUTCDate()<day)x.setUTCDate(0);return x}
async function hmacHex(secret,body){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(body)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
function safeEq(a,b){if(a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0}
async function signLicence(env,payload){
 const key=await crypto.subtle.importKey('jwk',JSON.parse(env.LICENCE_PRIVATE_JWK),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const data=b64u(new TextEncoder().encode(JSON.stringify(payload)));return data+'.'+b64u(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(data)));
}
/* liste toutes les clés d'un préfixe (avec leurs métadonnées), page par page */
async function listAll(kv,prefix){const out=[];let cursor;do{const r=await kv.list({prefix,cursor});out.push(...r.keys);cursor=r.list_complete?null:r.cursor}while(cursor);return out}
const TRIAL_DAYS=7;
async function stats(env){
 const today=new Date(),td=iso(today),since=d=>Math.floor((Date.parse(td+'T00:00:00Z')-Date.parse(d+'T00:00:00Z'))/864e5);
 const [trials,lics,ends]=await Promise.all([listAll(env.LICENCES,'trial:'),listAll(env.LICENCES,'lic:'),listAll(env.LICENCES,'end:')]);
 const paying=new Set(lics.map(k=>k.name.slice(4)));
 const endOf=async k=>(k.metadata&&k.metadata.e)||await env.LICENCES.get(k.name);
 const endDates=await Promise.all(ends.map(endOf));const activeSubs=endDates.filter(e=>e&&e>=td).length;
 const perDay={};let active=0;
 for(const k of trials){const d=(k.metadata&&k.metadata.d)||'?';perDay[d]=(perDay[d]||0)+1;const dev=k.name.slice(6);if(d!=='?'&&since(d)<TRIAL_DAYS&&!paying.has(dev))active++}
 const days=[];for(let i=29;i>=0;i--){const d=iso(new Date(today.getTime()-i*864e5));days.push({date:d,trials:perDay[d]||0})}
 const convertedTrials=trials.filter(k=>paying.has(k.name.slice(6))).length;
 return {date:td,totalTrials:trials.length,activeTrials:active,payingDevices:paying.size,activeSubscriptions:activeSubs,conversion:trials.length?Math.round(convertedTrials/trials.length*1000)/10:0,last30Days:days};
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const NOSTORE={'Cache-Control':'no-store','X-Robots-Tag':'noindex','Referrer-Policy':'no-referrer'};
const statsShell=body=>new Response('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>DentaGest DZ — statistiques</title><style>body{margin:0;background:#0A0A0A;color:#F3F3F3;font:15px/1.45 system-ui,sans-serif}main{max-width:720px;margin:0 auto;padding:24px 16px;display:grid;gap:16px}h1{font-size:22px;margin:0}.k{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.c{background:#151515;border:1px solid #2A2A2A;border-radius:14px;padding:14px}.c span{color:#9C9C9C;font-size:12.5px}.c b{display:block;font-size:26px;margin-top:2px}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:4px 6px;border-bottom:1px solid #222}td.n{text-align:right;width:40px}.bar{height:10px;background:#3DBFA8;border-radius:4px}input,button{font:inherit;padding:11px 14px;border-radius:10px;border:1px solid #2A2A2A;background:#1E1E1E;color:#fff}button{background:#fff;color:#0A0A0A;font-weight:700;border:0;cursor:pointer}form{display:flex;gap:8px;flex-wrap:wrap}input{flex:1;min-width:200px}p.m{color:#9C9C9C;margin:0;font-size:13px}</style><main>'+body+'</main></html>',{headers:{'Content-Type':'text/html; charset=utf-8',...NOSTORE}});
const statsForm=err=>statsShell('<h1>Statistiques DentaGest DZ</h1>'+(err?'<p style="color:#F0786D">'+err+'</p>':'')+'<form method="post" action="/stats"><input type="password" name="key" placeholder="Clé d’accès" autocomplete="current-password" required autofocus><button>Voir</button></form>');
function statsPage(s){
 const max=Math.max(1,...s.last30Days.map(d=>d.trials));
 const card=(l,v)=>'<div class="c"><span>'+l+'</span><b>'+esc(v)+'</b></div>';
 return statsShell('<h1>Statistiques DentaGest DZ</h1><p class="m">Au '+esc(s.date)+' — données anonymes (code appareil uniquement).</p><div class="k">'+card('Essais au total',s.totalTrials)+card('Essais en cours ('+TRIAL_DAYS+' j)',s.activeTrials)+card('Appareils payants',s.payingDevices)+card('Abonnements actifs',s.activeSubscriptions)+card('Conversion essai → payant',s.conversion+' %')+'</div>'+
  '<div class="c"><span>Nouveaux essais par jour (30 derniers jours)</span><table>'+s.last30Days.slice().reverse().map(d=>'<tr><td>'+esc(d.date)+'</td><td><div class="bar" style="width:'+(d.trials/max*100).toFixed(1)+'%"></div></td><td class="n">'+d.trials+'</td></tr>').join('')+'</table></div>'+
  '<p class="m">« Appareils payants » compte les paiements par carte (Chargily). Les codes BaridiMob créés à la main avec le générateur ne passent pas par ce serveur.</p>');
}
const api=env=>env.CHARGILY_MODE==='live'?'https://pay.chargily.net/api/v2':'https://pay.chargily.net/test/api/v2';
export default{
 async fetch(req,env,ctx){
  const url=new URL(req.url),path=url.pathname.replace(/\/+$/,'')||'/';
  if(req.method==='OPTIONS')return new Response(null,{headers:cors});
  try{
   if(path==='/checkout'&&req.method==='POST'){
    if(!env.CHARGILY_SECRET)return json({error:'Paiement par carte pas encore activé'},503);
    const {device,plan}=await req.json().catch(()=>({}));const P=PRICES[plan];
    if(!DEV.test(device||'')||!P)return json({error:'Demande invalide'},400);
    const r=await fetch(api(env)+'/checkouts',{method:'POST',headers:{'Authorization':'Bearer '+env.CHARGILY_SECRET,'Content-Type':'application/json'},
     body:JSON.stringify({amount:P.amount,currency:'dzd',locale:'fr',success_url:url.origin+'/ok',failure_url:url.origin+'/echec',webhook_endpoint:url.origin+'/webhook',description:'DentaGest DZ — '+P.label+' — '+device,metadata:{device,plan}})});
    const co=await r.json().catch(()=>({}));if(!r.ok||!co.checkout_url)return json({error:'Chargily indisponible'},502);
    await env.LICENCES.put('co:'+co.id,JSON.stringify({device,plan,at:Date.now()}),{expirationTtl:60*60*24*7});
    return json({url:co.checkout_url});
   }
   if(path==='/webhook'&&req.method==='POST'){
    if(!env.CHARGILY_SECRET)return new Response('not configured',{status:503});
    const raw=await req.text(),sig=req.headers.get('signature');if(!sig)return new Response('missing signature',{status:400});
    if(!safeEq(await hmacHex(env.CHARGILY_SECRET,raw),sig))return new Response('bad signature',{status:403});
    const ev=JSON.parse(raw);if(ev.type!=='checkout.paid')return new Response('ok');
    const co=ev.data||{};if(await env.LICENCES.get('done:'+co.id))return new Response('ok');
    const meta=JSON.parse(await env.LICENCES.get('co:'+co.id)||'null')||co.metadata||{};const P=PRICES[meta.plan];
    if(!P||!DEV.test(meta.device||'')||Number(co.amount)<P.amount)return new Response('ignored');
    await issueLicence(env,meta.device,meta.plan);await env.LICENCES.put('done:'+co.id,iso(new Date()));
    return new Response('ok');
   }
   /* code d'activation pour un paiement BaridiMob vérifié à la main (clé STATS_KEY) */
   if(path==='/admin/licence'&&req.method==='POST'){
    const auth=req.headers.get('Authorization')||'',key=auth.startsWith('Bearer ')?auth.slice(7).trim():'';
    if(!env.STATS_KEY||!key||!safeEq(await hmacHex('k',key),await hmacHex('k',env.STATS_KEY)))return json({error:'Clé invalide'},403);
    const {device,plan}=await req.json().catch(()=>({}));
    if(!DEV.test(device||'')||!PRICES[plan])return json({error:'Demande invalide (device DG-XXXX-XXXX, plan m, y, pm ou py)'},400);
    const {code,payload}=await issueLicence(env,device,plan);return json({code,fin:payload.e,formule:PRICES[plan].label});
   }
   if(path==='/licence'&&req.method==='GET'){
    const d=url.searchParams.get('device')||'';if(!DEV.test(d))return json({error:'Appareil invalide'},400);
    const code=await env.LICENCES.get('lic:'+d);return code?json({code}):json({pending:true},404);
   }
   if(path==='/trial'&&req.method==='POST'){
    const {device,date}=await req.json().catch(()=>({}));if(!DEV.test(device||''))return json({error:'Appareil invalide'},400);
    const k='trial:'+device;if(await env.LICENCES.get(k))return json({ok:true,known:true});
    /* date du serveur (fiable) ; la date du téléphone est gardée pour information */
    const d=iso(new Date()),c=/^\d{4}-\d{2}-\d{2}$/.test(date||'')?date:'';
    await env.LICENCES.put(k,d,{metadata:{d,c}});return json({ok:true});
   }
   if(path==='/stats'){
    if(!env.STATS_KEY)return new Response('Statistiques non configurées',{status:503,headers:NOSTORE});
    let key='';const auth=req.headers.get('Authorization')||'';
    if(auth.startsWith('Bearer '))key=auth.slice(7).trim();
    else if(req.method==='POST'){const f=await req.formData().catch(()=>null);key=f?String(f.get('key')||'').trim():''}
    if(!key)return req.method==='GET'&&!auth?statsForm(''):statsForm('Clé manquante.');
    if(!safeEq(await hmacHex('k',key),await hmacHex('k',env.STATS_KEY)))return auth?new Response(JSON.stringify({error:'Clé invalide'}),{status:403,headers:{'Content-Type':'application/json',...NOSTORE}}):statsForm('Clé invalide.');
    const s=await stats(env);
    return auth?new Response(JSON.stringify(s),{headers:{'Content-Type':'application/json',...NOSTORE}}):statsPage(s);
   }
   if(path==='/ok')return page('Paiement reçu ✓','Retournez dans l’application DentaGest DZ : votre abonnement s’active automatiquement.');
   if(path==='/echec')return page('Paiement non abouti','Aucun montant n’a été prélevé. Retournez dans l’application pour réessayer ou payer par BaridiMob.');
   return json({service:'DentaGest DZ paiement',ok:true,cards:!!env.CHARGILY_SECRET,mode:env.CHARGILY_MODE||'test'});
  }catch(e){return json({error:'Erreur serveur'},500)}
 }
};
