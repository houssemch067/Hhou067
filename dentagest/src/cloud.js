/* =====================================================================
   CLOUD DU CABINET — synchronisation chiffrée de bout en bout + équipe
   - Hors connexion d'abord : tout reste enregistré sur l'appareil, les
     modifications partent dès que internet revient.
   - Chiffré sur l'appareil (AES-256-GCM) : le serveur ne voit que des
     données illisibles. La clé du cabinet est protégée par le mot de passe
     de chaque membre (PBKDF2 310 000 itérations) et par un code de secours.
   - Comptes par membre avec droits : caisse (f), ordonnances (o), paramètres (p).
   ===================================================================== */
const Cloud=(()=>{
 const ITER=310000,SEP='\u0001',te=new TextEncoder(),td=new TextDecoder();
 const NEED={ordos:'o',certifs:'o',modeles:'o',meds:'o',paiements:'f',devis:'f'};
 const NAVNEED={caisse:'f',stats:'f',ordonnances:'o',modeles:'o',medicaments:'o'};
 const PERM_TXT={f:'Caisse, devis et statistiques',o:'Ordonnances, certificats, modèles et médicaments',p:'Modifier les paramètres du cabinet'};
 const PROFILS=[['dentiste','Dentiste collaborateur','fop'],['assistante','Assistante','o'],['secretaire','Secrétaire / accueil','f'],['libre','Personnalisé','']];
 const C={st:null,out:{},busy:false,again:false,err:'',skew:0,pushed:{},rv:0,ot:0};
 const NAV_ALL=NAV.slice();

 /* ---------- outils ---------- */
 const b64e=b=>{const u=new Uint8Array(b);let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
 const b64d=s=>{s=String(s).replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u};
 const rand=n=>crypto.getRandomValues(new Uint8Array(n));
 const ALPH='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
 const code=(groups,len)=>{const r=rand(groups*len);return Array.from({length:groups},(_,g)=>[...r.subarray(g*len,g*len+len)].map(x=>ALPH[x%ALPH.length]).join('')).join('-')};
 const now=()=>Date.now()+C.skew;
 const on=()=>!!(C.st&&C.st.token&&C.st.key);
 const perms=()=>on()?(C.st.me.role==='owner'?'fop':C.st.me.perms||''):'fop';
 const isOwner=()=>on()&&C.st.me.role==='owner';
 const canRead=col=>!NEED[col]||perms().includes(NEED[col]);
 const canWrite=col=>col==='config'?perms().includes('p'):canRead(col);
 const val=id=>(($('#'+id)||{}).value||'').trim();
 const slug=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/^(dr|pr)\.?\s+/,'dr ').replace(/[^a-z0-9]+/g,'.').replace(/^\.+|\.+$/g,'').slice(0,30);
 const rel=t=>{if(!t)return 'jamais';const d=(Date.now()-t)/1000;if(d<60)return 'à l’instant';if(d<3600)return 'il y a '+Math.floor(d/60)+' min';if(d<86400)return 'il y a '+Math.floor(d/3600)+' h';const x=new Date(t);return 'le '+x.toLocaleDateString('fr-FR')+' à '+x.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})};
 const devName=()=>{const u=navigator.userAgent,os=/iPad/.test(u)?'iPad':/iPhone/.test(u)?'iPhone':/Android/.test(u)?'Android':/Windows/.test(u)?'PC Windows':/Mac/.test(u)?'Mac':/Linux/.test(u)?'Linux':'Appareil',br=/Edg\//.test(u)?'Edge':/SamsungBrowser/.test(u)?'Samsung Internet':/Firefox/.test(u)?'Firefox':/Chrome/.test(u)?'Chrome':/Safari/.test(u)?'Safari':'';return os+(br?' · '+br:'')};
 const plural=(n,w)=>n+' '+w+(n>1?'s':'');

 /* ---------- chiffrement ---------- */
 async function derive(secret,salt){
  const base=await crypto.subtle.importKey('raw',te.encode(String(secret).normalize('NFKC')),'PBKDF2',false,['deriveBits']);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:b64d(salt),iterations:ITER},base,512));
  return {auth:b64e(bits.slice(0,32)),kek:await crypto.subtle.importKey('raw',bits.slice(32),'AES-KW',false,['wrapKey','unwrapKey'])};
 }
 const wrap=async(K,kek)=>b64e(await crypto.subtle.wrapKey('raw',K,kek,'AES-KW'));
 const unwrap=(w,kek)=>crypto.subtle.unwrapKey('raw',b64d(w),kek,'AES-KW',{name:'AES-GCM'},true,['encrypt','decrypt']);
 /* identifiants protégés par un secret : sel aléatoire, clé d'accès (serveur) et clé du cabinet emballée */
 async function creds(K,secret){const salt=b64e(rand(16)),d=await derive(secret,salt);return {salt,auth:d.auth,wrapped:await wrap(K,d.kek)}}
 async function seal(o,K){K=K||C.st.key;const iv=rand(12),ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},K,te.encode(JSON.stringify(o)))),out=new Uint8Array(14+ct.length);out[0]=1;out[1]=0;out.set(iv,2);out.set(ct,14);return b64e(out)}
 async function open(s,K){K=K||C.st.key;const u=b64d(s);if(u[0]!==1||u[1]!==0)throw new Error('format');return JSON.parse(td.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:u.subarray(2,14)},K,u.subarray(14))))}
 const openName=async s=>{try{return await open(s)}catch(e){return '—'}};

 /* ---------- serveur ---------- */
 async function call(path,body,anon){
  let r;
  try{r=await fetch('/api/'+path,{method:'POST',cache:'no-store',headers:Object.assign({'content-type':'application/json'},!anon&&C.st?{authorization:'Bearer '+C.st.token}:{}),body:JSON.stringify(body||{})})}
  catch(e){const x=new Error('Pas de connexion internet. Réessayez quand vous êtes connecté.');x.offline=1;throw x}
  const j=await r.json().catch(()=>({error:'Le serveur ne répond pas correctement. Réessayez.'}));
  if(!r.ok){const x=new Error(j.error||'Erreur');x.status=r.status;throw x}
  return j;
 }

 /* ---------- état local ---------- */
 async function saveSt(){try{await IDB.set('cloud',C.st)}catch(e){console.warn('cloud save',e)}}
 function saveOut(){clearTimeout(C.ot);C.ot=setTimeout(()=>{C.ot=0;IDB.set('outbox',C.out).catch(e=>console.warn('outbox',e))},250)}
 function track(col,id,del){
  if(!on()||C.hold)return;
  C.out[col+SEP+id]={col,id,del:del?1:0,t:now()};saveOut();badge();
  clearTimeout(C.soon);C.soon=setTimeout(()=>sync(),1500);
 }
 function trackAll(withConfig){
  Object.keys(S).filter(c=>COLS.includes(c)&&canWrite(c)).forEach(c=>S[c].forEach(x=>{if(x&&x.id&&!x.ex)C.out[c+SEP+x.id]={col:c,id:x.id,del:0,t:now()}}));
  if(withConfig)C.out['config'+SEP+'cabinet']={col:'config',id:'cabinet',del:0,t:now()};
  saveOut();
 }

 /* ---------- branchement sur l'enregistrement existant ---------- */
 const _save=Store.save.bind(Store),_del=Store.del.bind(Store),_cfg=Store.saveConfig.bind(Store);
 Store.save=function(col,obj,delay){
  if(on()&&!canWrite(col)){toast('Votre compte n’a pas accès à cette fonction. Demandez au titulaire du cabinet.');return}
  _save(col,obj,delay);if(on()&&!licLocked()&&obj&&S[col].some(x=>x.id===obj.id))track(col,obj.id,0);
 };
 Store.del=function(col,id){
  if(on()&&!canWrite(col)){toast('Votre compte n’a pas accès à cette fonction.');return}
  _del(col,id);if(on()&&!licLocked()&&!S[col].some(x=>x.id===id))track(col,id,1);
 };
 Store.saveConfig=function(){_cfg();if(on()&&canWrite('config'))track('config','cabinet',0)};
 /* une seule licence pour tout le cabinet : celle du titulaire, partagée par la synchronisation */
 const _licDevice=licDevice;
 licDevice=function(){const d=S.config.device;if(on()&&d&&/^DG-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(d))return d;return _licDevice()};

 /* ---------- synchronisation ---------- */
 async function apply(x){
  if(x.col==='config'){
   if(x.del)return false;const c=await open(x.data);
   Object.keys(S.config).forEach(k=>delete S.config[k]);Object.assign(S.config,DEF_CONFIG,c);return true;
  }
  if(!COLS.includes(x.col))return false;
  const arr=S[x.col],i=arr.findIndex(o=>o.id===x.id);
  if(x.del){if(i<0)return false;arr.splice(i,1);return true}
  const o=await open(x.data);if(i>=0)arr[i]=o;else arr.push(o);return true;
 }
 async function sync(manual){
  if(!on()||C.hold)return;
  if(C.busy){C.again=true;return}
  if(!navigator.onLine){C.err='offline';badge();if(manual)toast('Pas de connexion : vos modifications restent sur l’appareil et partiront automatiquement.');return}
  C.busy=true;badge();let changed=false,cfg=false,skipped=0;
  try{
   for(let round=0;round<300;round++){
    const keys=Object.keys(C.out).slice(0,60),snap={},changes=[];
    for(const k of keys){
     const o=C.out[k];snap[k]=o.t;
     if(!canWrite(o.col)){delete C.out[k];continue}
     const rec=o.del?null:o.col==='config'?clone(S.config):(S[o.col]||[]).find(x=>x.id===o.id);
     if(!rec){changes.push({col:o.col,id:o.id,t:o.t,del:1});continue}
     const data=await seal(rec);
     if(data.length>1400000){delete C.out[k];skipped++;continue}
     changes.push({col:o.col,id:o.id,t:o.t,data});
    }
    const r=await call('sync',{since:C.st.seq||0,changes});
    C.skew=r.now-Date.now();
    keys.forEach(k=>{if(C.out[k]&&C.out[k].t===snap[k])delete C.out[k]});
    changes.forEach(c=>C.pushed[c.col+SEP+c.id]=c.t);
    (r.denied||[]).forEach(d=>delete C.out[d.col+SEP+d.id]);
    for(const x of (r.rejected||[]).concat(r.changes||[])){
     const k=x.col+SEP+x.id;
     if(C.pushed[k]===x.t)continue;            // notre propre envoi qui revient
     const p=C.out[k];if(p&&p.t>x.t)continue;   // modification locale plus récente : elle partira
     if(p)delete C.out[k];
     try{if(await apply(x)){changed=true;if(x.col==='config')cfg=true}}catch(e){console.warn('cloud: fiche illisible',x.col,x.id,e)}
    }
    C.st.seq=r.seq;await applyMe(r.me);
    if(!r.more&&!Object.keys(C.out).length)break;
   }
   C.st.last=Date.now();C.err='';await saveSt();saveOut();
   if(skipped)toast(plural(skipped,'fiche')+' trop volumineuse'+(skipped>1?'s':'')+' (photos) n’a pas pu être synchronisée.');
   if(changed){await Store.persistNow();if(cfg&&typeof licRefresh==='function')await licRefresh();refreshView()}
   if(manual)toast('Synchronisation terminée');
  }catch(e){
   if(e.status===401){C.busy=false;return kicked(e.message)}
   C.err=e.offline?'offline':'error';C.errMsg=e.message;console.warn('sync',e);
   if(manual)toast(e.message);
  }finally{
   C.busy=false;badge();
   if(C.again){C.again=false;setTimeout(()=>sync(),300)}
  }
 }
 async function applyMe(m){
  if(!m||!C.st)return;
  const before=perms();
  C.st.me=Object.assign({},C.st.me,m);
  const after=perms();
  if(before!==after){
   COLS.filter(c=>!canRead(c)).forEach(c=>{S[c]=[];Object.keys(C.out).forEach(k=>{if(C.out[k].col===c)delete C.out[k]})});
   if([...after].some(p=>!before.includes(p)))C.st.seq=0;   // nouveaux droits : on récupère les fiches correspondantes
   applyNav();await Store.persistNow();refreshView();
   toast('Vos accès ont été modifiés par le titulaire du cabinet.');
  }
  if(m.mustChange&&!C.mc){C.mc=1;setTimeout(()=>pwdSheet(true),600)}
 }
 function refreshView(){
  if(!ui.ready)return;
  const a=document.activeElement,busy=$('#modal').innerHTML||$('#onb')||(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))||route()==='reel';
  clearTimeout(C.rv);if(busy){C.rv=setTimeout(refreshView,2000);return}
  render();
 }
 function applyNav(){const p=perms();NAV.splice(0,NAV.length,...NAV_ALL.filter(n=>!NAVNEED[n[0]]||p.includes(NAVNEED[n[0]])))}

 async function wipe(){
  COLS.forEach(c=>S[c]=[]);Object.keys(S.config).forEach(k=>delete S.config[k]);Object.assign(S.config,DEF_CONFIG);
  C.st=null;C.out={};C.pushed={};
  try{await IDB.set('cloud',null);await IDB.set('outbox',{})}catch(e){}
  await Store.persistNow();applyNav();
 }
 async function kicked(msg){
  if(msg==='revoked'){
   await wipe();
   clSheet('Appareil déconnecté','<div class="alertbox">Cet appareil a été déconnecté du cabinet (par le titulaire, ou après un changement de mot de passe).</div><p>Par sécurité, les données du cabinet ont été effacées de cet appareil. Reconnectez-vous avec votre identifiant pour les retrouver.</p>','<button class="btn pri" data-a="cl-reload">OK</button>');
  }else{
   C.st=null;C.out={};try{await IDB.set('cloud',null);await IDB.set('outbox',{})}catch(e){}applyNav();render();
   toast('Session du cabinet expirée : reconnectez-vous (Paramètres › Cloud du cabinet).');
  }
 }

 /* ---------- indicateur ---------- */
 function badge(){
  const s=$('#sync');if(!s||!on())return;
  const n=Object.keys(C.out).length;let t,k='';
  if(C.busy){t='Synchronisation…'}
  else if(C.err==='offline'||!navigator.onLine){t='Hors ligne'+(n?' · '+n+' en attente':'');k='warn'}
  else if(C.err){t='Synchro en échec';k='bad'}
  else if(n){t=n+' en attente';k='warn'}
  else{t='✓ Synchronisé';k='ok'}
  s.textContent=t;s.className='sync cl '+k;s.dataset.a='cl-open';s.setAttribute('role','button');
  s.title=C.st.last?'Dernière synchronisation '+rel(C.st.last):'';
 }

 /* ---------- fenêtres ---------- */
 function clSheet(title,body,footer){sheet(title,body,footer);const o=$('#modal .overlay');if(o)o.style.zIndex=120}
 const busyBtn=(el,txt)=>{if(!el)return()=>{};const h=el.innerHTML;el.disabled=true;el.textContent=txt||'Patientez…';return()=>{el.disabled=false;el.innerHTML=h}};
 const err=(id,m)=>{const e=$('#'+id);if(e)e.innerHTML=m?'<div class="alertbox" style="margin-top:10px">'+esc(m)+'</div>':''};
 const pwOk=p=>p.length>=8;

 function card(){
  if(!on())return '<div class="card cl-card"><h2>Cloud du cabinet <span class="pill plain">Non activé</span></h2>'+
   '<p style="margin:0 0 10px">Vos patients sur <b>tous vos appareils</b>, le travail <b>à plusieurs</b> (assistante, secrétaire, collaborateur) chacun avec son propre compte, et plus rien de perdu si un téléphone casse ou disparaît.</p>'+
   '<ul class="cl-ul"><li>🔒 <b>Chiffré de bout en bout</b> : même nous ne pouvons pas lire vos dossiers patients.</li><li>📶 <b>Marche sans internet</b> : tout est envoyé dès que la connexion revient.</li><li>👥 <b>Accès par personne</b> : choisissez qui voit la caisse, les ordonnances…</li><li>📱 <b>Téléphone perdu ?</b> Déconnectez-le à distance, ses données sont effacées.</li></ul>'+
   '<div class="row"><button class="btn pri" data-a="cl-create">Activer le cloud du cabinet</button><button class="btn" data-a="cl-login">J’ai un identifiant (rejoindre)</button></div></div>';
  const m=C.st.me,n=Object.keys(C.out).length;
  return '<div class="card cl-card"><h2>Cloud du cabinet <span class="pill ok">Activé</span></h2>'+
   '<p style="margin:0 0 6px">Connecté : <b>'+esc(C.st.name||m.login)+'</b> <span style="color:var(--muted)">(@'+esc(m.login)+')</span> · '+(m.role==='owner'?'Titulaire':'Membre de l’équipe')+'</p>'+
   '<p style="margin:0 0 12px;color:var(--muted)">Dernière synchronisation : '+rel(C.st.last)+(n?' · <b>'+plural(n,'modification')+' en attente</b>':'')+' · 🔒 chiffré de bout en bout</p>'+
   '<div class="row"><button class="btn pri" data-a="cl-sync">Synchroniser maintenant</button>'+
   (isOwner()?'<button class="btn" data-a="cl-team">Équipe et accès</button><button class="btn" data-a="cl-devices">Appareils connectés</button><button class="btn" data-a="cl-activity">Historique des modifications</button><button class="btn" data-a="cl-rec-new">Nouveau code de secours</button>':'')+
   '<button class="btn" data-a="cl-pwd">Changer mon mot de passe</button><button class="btn danger" data-a="cl-logout">Se déconnecter</button></div></div>';
 }

 /* Création du cloud par le titulaire */
 function createSheet(){
  const sug=slug(S.config.praticien)||slug(S.config.cabinet);
  clSheet('Activer le cloud du cabinet','<p style="margin:0 0 12px">Vous serez le <b>titulaire</b> : vous ajouterez ensuite votre équipe et choisirez ce que chacun peut voir.</p><div class="form">'+
   '<label class="f">Votre identifiant de connexion<input id="cl_login" autocomplete="username" autocapitalize="none" spellcheck="false" value="'+esc(sug)+'" placeholder="dr.benali"></label>'+
   '<label class="f">Votre nom (affiché à l’équipe)<input id="cl_name" value="'+esc(S.config.praticien||'')+'"></label>'+
   '<label class="f">Mot de passe (8 caractères minimum)<input id="cl_pw" type="password" autocomplete="new-password"></label>'+
   '<label class="f">Confirmer le mot de passe<input id="cl_pw2" type="password" autocomplete="new-password"></label></div>'+
   '<div class="note" style="margin-top:12px">Votre mot de passe sert à chiffrer les données : il n’est jamais envoyé, nous ne pouvons pas le retrouver. Vous recevrez un <b>code de secours</b> à conserver précieusement.</div><div id="cl_err"></div>',
   '<button class="btn" data-a="close">Annuler</button><button class="btn pri" data-a="cl-create-go">Activer</button>');
 }
 async function createGo(el){
  const login=val('cl_login').toLowerCase(),name=val('cl_name')||S.config.praticien||login,pw=$('#cl_pw').value,pw2=$('#cl_pw2').value;
  if(!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(login))return err('cl_err','Identifiant : 3 à 40 caractères, lettres minuscules, chiffres, point ou tiret, sans espace.');
  if(!pwOk(pw))return err('cl_err','Le mot de passe doit faire au moins 8 caractères.');
  if(pw!==pw2)return err('cl_err','Les deux mots de passe sont différents.');
  const done=busyBtn(el,'Sécurisation…');err('cl_err','');
  try{
   const K=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
   const rc=code(5,4),me=await creds(K,pw),rec=await creds(K,rc);
   const r=await call('register',{login,name:await seal(name,K),salt:me.salt,auth:me.auth,wrapped:me.wrapped,rsalt:rec.salt,rauth:rec.auth,rwrapped:rec.wrapped,device:devName()},1);
   C.st={token:r.token,me:r.me,key:K,seq:0,name,last:0};C.out={};C.pushed={};await saveSt();
   trackAll(true);applyNav();render();
   recSheet(rc,true);sync();
  }catch(e){done();err('cl_err',e.message)}
 }
 function recSheet(rc,first){
  clSheet('Votre code de secours','<p style="margin:0 0 10px">'+(first?'Le cloud est activé ✓. ':'')+'Ce code est le <b>seul moyen</b> de retrouver l’accès à vos données si vous oubliez votre mot de passe. Notez-le sur papier et rangez-le en lieu sûr.</p>'+
   '<div class="cl-code" id="cl_rc">'+esc(rc)+'</div><div class="row" style="justify-content:center;margin:10px 0"><button class="btn sm" data-a="cl-copy" data-v="'+esc(rc)+'">Copier</button><button class="btn sm" data-a="cl-rc-dl" data-v="'+esc(rc)+'">Télécharger</button></div>'+
   '<label class="cl-chk"><input type="checkbox" id="cl_rc_ok"> J’ai noté ce code en lieu sûr</label><div id="cl_err"></div>',
   '<button class="btn pri" data-a="cl-rc-done">Terminer</button>');
 }

 /* Connexion / rejoindre */
 function loginSheet(){
  clSheet('Connexion au cabinet','<p style="margin:0 0 12px">Entrez l’identifiant et le mot de passe donnés par le titulaire du cabinet.</p><div class="form">'+
   '<label class="f">Identifiant<input id="cl_login" autocomplete="username" autocapitalize="none" spellcheck="false"></label>'+
   '<label class="f">Mot de passe<input id="cl_pw" type="password" autocomplete="current-password"></label></div><div id="cl_err"></div>'+
   '<p style="margin:12px 0 0"><a href="#" data-a="cl-forgot">Mot de passe oublié ?</a></p>',
   '<button class="btn" data-a="cl-cancel">Annuler</button><button class="btn pri" data-a="cl-login-go">Se connecter</button>');
  setTimeout(()=>{const i=$('#cl_login');if(i)i.focus()},100);
 }
 async function loginGo(el){
  const login=val('cl_login').toLowerCase(),pw=$('#cl_pw').value;
  if(!login||!pw)return err('cl_err','Entrez votre identifiant et votre mot de passe.');
  const done=busyBtn(el,'Connexion…');err('cl_err','');
  try{
   const {salt}=await call('prelogin',{login},1),d=await derive(pw,salt);
   const r=await call('login',{login,auth:d.auth,device:devName()},1);
   const K=await unwrap(r.wrapped,d.kek);
   await joined(r,K,pw);
  }catch(e){done();err('cl_err',e.message)}
 }
 async function joined(r,K,pw){
  C.st={token:r.token,me:r.me,key:K,seq:0,name:'',last:0};C.out={};C.pushed={};
  C.st.name=await openName(r.me.name);C.pw=pw||null;
  const n=COLS.reduce((a,c)=>a+S[c].filter(x=>!x.ex).length,0);
  if(n){
   C.hold=true;
   clSheet('Données déjà présentes','<p style="margin:0 0 10px">Cet appareil contient déjà <b>'+plural(S.patients.filter(x=>!x.ex).length,'patient')+'</b> et d’autres fiches ('+n+' au total) qui ne sont pas dans le cabinet.</p>'+
    '<div class="note">« Ajouter au cabinet » envoie ces fiches au cloud : toute l’équipe les verra. « Remplacer » les efface de cet appareil (exportez une sauvegarde avant si besoin).</div>',
    '<button class="btn" data-a="backup">Exporter une sauvegarde</button><button class="btn danger" data-a="cl-join-replace">Remplacer</button><button class="btn pri" data-a="cl-join-merge">Ajouter au cabinet</button>');
   return;
  }
  await finishJoin(false);
 }
 async function finishJoin(merge){
  C.hold=false;
  if(merge)trackAll(false);
  else{COLS.forEach(c=>S[c]=[]);Object.keys(S.config).forEach(k=>delete S.config[k]);Object.assign(S.config,DEF_CONFIG)}
  await saveSt();applyNav();closeSheet();
  toast('Connecté au cabinet. Récupération des données…');
  await sync();
  const o=$('#onb');if(o){if(S.config.onboarded)o.remove();else o.style.display=''}
  if(typeof licRefresh==='function')await licRefresh();
  ui.patient=null;render();
 }

 /* Mot de passe */
 function pwdSheet(forced){
  clSheet(forced?'Choisissez votre mot de passe':'Changer mon mot de passe',(forced?'<p style="margin:0 0 12px">Vous utilisez un mot de passe provisoire. Choisissez maintenant votre mot de passe personnel.</p>':'')+'<div class="form">'+
   (forced&&C.pw?'':'<label class="f">Mot de passe actuel'+(forced?' (provisoire)':'')+'<input id="cl_cur" type="password" autocomplete="current-password"></label>')+
   '<label class="f">Nouveau mot de passe (8 caractères minimum)<input id="cl_pw" type="password" autocomplete="new-password"></label>'+
   '<label class="f">Confirmer<input id="cl_pw2" type="password" autocomplete="new-password"></label></div><div id="cl_err"></div>',
   (forced?'':'<button class="btn" data-a="close">Annuler</button>')+'<button class="btn pri" data-a="cl-pwd-go">Enregistrer</button>');
 }
 async function pwdGo(el){
  const cur=$('#cl_cur')?$('#cl_cur').value:C.pw,pw=$('#cl_pw').value,pw2=$('#cl_pw2').value;
  if(!cur)return err('cl_err','Entrez votre mot de passe actuel.');
  if(!pwOk(pw))return err('cl_err','Le mot de passe doit faire au moins 8 caractères.');
  if(pw!==pw2)return err('cl_err','Les deux mots de passe sont différents.');
  const done=busyBtn(el,'Sécurisation…');err('cl_err','');
  try{
   const {salt}=await call('prelogin',{login:C.st.me.login},1),d=await derive(cur,salt);
   const nw=await creds(C.st.key,pw);
   await call('password',{current:d.auth,salt:nw.salt,auth:nw.auth,wrapped:nw.wrapped});
   C.pw=null;C.st.me.mustChange=false;await saveSt();closeSheet();toast('Mot de passe enregistré. Vos autres appareils devront se reconnecter.');
  }catch(e){done();err('cl_err',e.message)}
 }

 /* Mot de passe oublié (titulaire) */
 function forgotSheet(){
  clSheet('Mot de passe oublié','<p style="margin:0 0 12px"><b>Titulaire</b> : utilisez votre code de secours. <b>Membre de l’équipe</b> : demandez au titulaire un nouveau mot de passe provisoire (Paramètres › Équipe).</p><div class="form">'+
   '<label class="f">Identifiant du titulaire<input id="cl_login" autocapitalize="none" spellcheck="false" value="'+esc(val('cl_login'))+'"></label>'+
   '<label class="f">Code de secours<input id="cl_rc" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"></label>'+
   '<label class="f">Nouveau mot de passe<input id="cl_pw" type="password" autocomplete="new-password"></label>'+
   '<label class="f">Confirmer<input id="cl_pw2" type="password" autocomplete="new-password"></label></div><div id="cl_err"></div>',
   '<button class="btn" data-a="cl-cancel">Annuler</button><button class="btn pri" data-a="cl-forgot-go">Valider</button>');
 }
 async function forgotGo(el){
  const login=val('cl_login').toLowerCase(),rc=val('cl_rc').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/(.{4})(?=.)/g,'$1-'),pw=$('#cl_pw').value,pw2=$('#cl_pw2').value;
  if(!login||rc.length<24)return err('cl_err','Entrez votre identifiant et le code de secours complet.');
  if(!pwOk(pw))return err('cl_err','Le mot de passe doit faire au moins 8 caractères.');
  if(pw!==pw2)return err('cl_err','Les deux mots de passe sont différents.');
  const done=busyBtn(el,'Vérification…');err('cl_err','');
  try{
   const {salt}=await call('recover/start',{login},1),d=await derive(rc,salt);
   const {rwrapped}=await call('recover/key',{login,rauth:d.auth},1),K=await unwrap(rwrapped,d.kek);
   const nw=await creds(K,pw);
   const r=await call('recover/finish',{login,rauth:d.auth,salt:nw.salt,auth:nw.auth,wrapped:nw.wrapped,device:devName()},1);
   await joined(r,K,null);toast('Nouveau mot de passe enregistré.');
  }catch(e){done();err('cl_err',e.message)}
 }

 /* Équipe */
 async function teamSheet(){
  clSheet('Équipe et accès','<div class="empty">Chargement…</div>');
  try{
   const t=await call('team');C.team=t;
   const rows=await Promise.all(t.users.map(async u=>{
    const name=await openName(u.name),devs=t.sessions.filter(s=>s.user===u.id),seen=Math.max(0,...devs.map(s=>s.seen));
    const tags=u.role==='owner'?'<span class="pill ok">Titulaire · tous les accès</span>':[...'fop'].filter(p=>u.perms.includes(p)).map(p=>'<span class="pill plain">'+PERM_TXT[p].split(',')[0]+'</span>').join(' ')||'<span class="pill plain">Agenda et patients</span>';
    return '<div class="cl-mem'+(u.active?'':' off')+'"><div><b>'+esc(name)+'</b> <span style="color:var(--muted)">@'+esc(u.login)+'</span>'+(u.active?'':' <span class="pill crit">Désactivé</span>')+(u.mustChange&&u.active?' <span class="pill warn">Mot de passe provisoire</span>':'')+
     '<div class="cl-tags">'+tags+'</div><small>'+(devs.length?plural(devs.length,'appareil')+' · vu '+rel(seen):'Aucun appareil connecté')+'</small></div>'+
     (u.role==='owner'?'':'<div class="row"><button class="btn sm" data-a="cl-mem-perms" data-id="'+u.id+'">Accès</button><button class="btn sm" data-a="cl-mem-reset" data-id="'+u.id+'">Nouveau mot de passe</button><button class="btn sm'+(u.active?' danger':'')+'" data-a="cl-mem-active" data-id="'+u.id+'" data-v="'+(u.active?0:1)+'">'+(u.active?'Désactiver':'Réactiver')+'</button></div>')+'</div>';
   }));
   $('#sheet-b').innerHTML='<p style="margin:0 0 12px;color:var(--muted)">Chaque personne a son propre identifiant. Tout le monde voit l’agenda, les patients et la salle d’attente ; vous choisissez le reste.</p>'+rows.join('')+'<div class="row" style="margin-top:14px"><button class="btn pri" data-a="cl-mem-add">'+ic('plus')+'Ajouter un membre</button></div>';
  }catch(e){$('#sheet-b').innerHTML='<div class="alertbox">'+esc(e.message)+'</div>'}
 }
 const permBoxes=p=>'<p class="lbl" style="margin:12px 0 6px">Accès en plus de l’agenda, des patients et de la salle d’attente</p>'+[...'fop'].map(k=>'<label class="cl-chk"><input type="checkbox" class="cl-perm" value="'+k+'"'+(p.includes(k)?' checked':'')+'> '+PERM_TXT[k]+'</label>').join('');
 const readPerms=()=>[...document.querySelectorAll('.cl-perm')].filter(x=>x.checked).map(x=>x.value).join('');
 function addSheet(){
  clSheet('Ajouter un membre','<div class="form"><label class="f">Nom et prénom<input id="cl_mname" placeholder="Amina Kaci"></label>'+
   '<label class="f">Identifiant de connexion<input id="cl_mlogin" autocapitalize="none" spellcheck="false" placeholder="amina.kaci"></label>'+
   '<label class="f">Profil<select id="cl_prof">'+PROFILS.map(([k,n,p])=>'<option value="'+k+'" data-p="'+p+'">'+n+'</option>').join('')+'</select></label></div>'+
   '<div id="cl_perms">'+permBoxes('fop')+'</div><div id="cl_err"></div>',
   '<button class="btn" data-a="cl-team">Retour</button><button class="btn pri" data-a="cl-mem-add-go">Créer le compte</button>');
 }
 async function addGo(el){
  const name=val('cl_mname'),login=val('cl_mlogin').toLowerCase(),p=readPerms();
  if(!name)return err('cl_err','Indiquez le nom de la personne.');
  if(!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(login))return err('cl_err','Identifiant : 3 à 40 caractères, lettres minuscules, chiffres, point ou tiret, sans espace.');
  const done=busyBtn(el,'Création…');err('cl_err','');
  try{const tmp=code(3,4),c=await creds(C.st.key,tmp);
   await call('team/add',{login,name:await seal(name),perms:p,...c});
   credSheet(name,login,tmp,true);
  }catch(e){done();err('cl_err',e.message)}
 }
 function credSheet(name,login,tmp,isNew){
  const msg='DentaGest DZ — '+(S.config.cabinet||'cabinet')+'\nIdentifiant : '+login+'\nMot de passe provisoire : '+tmp+'\nOuvrez '+location.origin+' puis « J’ai un identifiant ». Vous choisirez votre mot de passe à la première connexion.';
  clSheet(isNew?'Compte créé ✓':'Nouveau mot de passe','<p style="margin:0 0 10px">Donnez ces informations à <b>'+esc(name)+'</b>. Le mot de passe provisoire sera remplacé à sa première connexion.</p>'+
   '<div class="cl-cred"><span>Identifiant</span><b>'+esc(login)+'</b><span>Mot de passe provisoire</span><b class="cl-mono">'+esc(tmp)+'</b></div>'+
   '<p style="margin:10px 0 0;color:var(--muted);font-size:13px">Ce mot de passe ne sera plus affiché après fermeture.</p>',
   '<button class="btn" data-a="cl-copy" data-v="'+esc(msg)+'">Copier</button><a class="btn" href="https://wa.me/?text='+encodeURIComponent(msg)+'" target="_blank" rel="noopener">WhatsApp</a><button class="btn pri" data-a="cl-team">Terminé</button>');
 }
 async function memName(id){const u=(C.team&&C.team.users||[]).find(x=>x.id===id);return u?{u,name:await openName(u.name)}:null}
 async function permsSheet(id){
  const m=await memName(id);if(!m)return;
  clSheet('Accès de '+m.name,permBoxes(m.u.perms)+'<div id="cl_err"></div>','<button class="btn" data-a="cl-team">Retour</button><button class="btn pri" data-a="cl-mem-perms-go" data-id="'+id+'">Enregistrer</button>');
 }

 /* Appareils */
 async function devicesSheet(){
  clSheet('Appareils connectés','<div class="empty">Chargement…</div>');
  try{
   const t=await call('team');C.team=t;const names={};for(const u of t.users)names[u.id]=await openName(u.name);
   $('#sheet-b').innerHTML='<p style="margin:0 0 12px;color:var(--muted)">Un appareil perdu ou volé ? Déconnectez-le : il ne pourra plus rien lire, et ses données du cabinet seront effacées dès qu’il se reconnectera à internet.</p>'+
    (t.sessions.map(s=>'<div class="cl-mem"><div><b>'+esc(s.device||'Appareil')+'</b>'+(s.current?' <span class="pill ok">Cet appareil</span>':'')+'<small>'+esc(names[s.user]||'?')+' · actif '+rel(s.seen)+' · connecté le '+new Date(s.created).toLocaleDateString('fr-FR')+'</small></div>'+
     (s.current?'':'<div class="row"><button class="btn sm danger" data-a="cl-dev-revoke" data-id="'+s.id+'">Déconnecter</button></div>')+'</div>').join('')||'<div class="empty">Aucun appareil.</div>');
  }catch(e){$('#sheet-b').innerHTML='<div class="alertbox">'+esc(e.message)+'</div>'}
 }

 /* Historique */
 const VERB={create:'a ajouté',update:'a modifié',delete:'a supprimé'};
 function what(col,id){
  const r=COLS.includes(col)?S[col].find(x=>x.id===id):null,P=x=>x&&x.patientId?pname(pat(x.patientId)):'';
  switch(col){
   case 'patients':return r?'la fiche de '+pname(r):'une fiche patient';
   case 'rdv':return 'un rendez-vous'+(r?' ('+P(r)+', '+fr(r.date)+' '+(r.heure||'')+')':'');
   case 'ordos':return 'une ordonnance'+(r?' ('+P(r)+')':'');
   case 'certifs':return 'un certificat'+(r?' ('+P(r)+')':'');
   case 'paiements':return 'un encaissement'+(r?' ('+P(r)+(r.montant?', '+fmtDA(r.montant):'')+')':'');
   case 'devis':return 'un devis'+(r?' ('+P(r)+')':'');
   case 'modeles':return 'un modèle d’ordonnance'+(r&&r.nom?' ('+r.nom+')':'');
   case 'meds':return 'un médicament'+(r&&r.n?' ('+r.n+')':'');
   case 'config':return 'les paramètres du cabinet';
  }return 'une fiche';
 }
 async function activitySheet(before){
  if(!before)clSheet('Historique des modifications','<div class="empty">Chargement…</div>');
  try{
   if(!C.names||!before){const t=await call('team');C.names={};for(const u of t.users)C.names[u.id]=await openName(u.name)}
   const r=await call('activity',{before});let day='';
   const html=r.items.map(i=>{const d=new Date(i.at),k=d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});const h=(k!==day?'<p class="lbl" style="margin:14px 0 6px">'+k+'</p>':'');day=k;
    return h+'<div class="cl-act"><span>'+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})+'</span><div><b>'+esc(C.names[i.user]||'?')+'</b> '+VERB[i.action]+' '+esc(what(i.col,i.rid))+'</div></div>'}).join('');
   const more=r.items.length===100?'<div class="row" style="margin-top:12px"><button class="btn sm" data-a="cl-activity-more" data-v="'+r.items[r.items.length-1].at+'">Plus ancien</button></div>':'';
   const b=$('#sheet-b');if(!b)return;
   if(before){const m=b.querySelector('[data-a="cl-activity-more"]');if(m)m.parentNode.remove();b.insertAdjacentHTML('beforeend',html+more)}
   else b.innerHTML='<p style="margin:0;color:var(--muted)">Qui a ajouté, modifié ou supprimé quoi, et quand. Conservé dans le cloud, non modifiable.</p>'+(html||'<div class="empty">Aucune modification pour l’instant.</div>')+more;
  }catch(e){const b=$('#sheet-b');if(b)b.innerHTML='<div class="alertbox">'+esc(e.message)+'</div>'}
 }

 /* Code de secours renouvelé */
 function recNewSheet(){
  clSheet('Nouveau code de secours','<p style="margin:0 0 12px">L’ancien code ne fonctionnera plus. Confirmez avec votre mot de passe.</p><div class="form"><label class="f">Mot de passe<input id="cl_cur" type="password" autocomplete="current-password"></label></div><div id="cl_err"></div>',
   '<button class="btn" data-a="close">Annuler</button><button class="btn pri" data-a="cl-rec-new-go">Créer un nouveau code</button>');
 }

 /* Déconnexion */
 function logoutSheet(){
  const n=Object.keys(C.out).length;
  clSheet('Se déconnecter du cabinet',(n?'<div class="alertbox">'+plural(n,'modification')+' n’'+(n>1?'ont':'a')+' pas encore été envoyée'+(n>1?'s':'')+'. Connectez-vous à internet et synchronisez avant de vous déconnecter, sinon elle'+(n>1?'s':'')+' sera perdue'+(n>1?'s':'')+'.</div>':'')+
   '<label class="cl-chk" style="margin-top:10px"><input type="checkbox" id="cl_wipe" checked> Effacer les données du cabinet de cet appareil (recommandé sur un appareil partagé)</label>',
   '<button class="btn" data-a="close">Annuler</button><button class="btn danger" data-a="cl-logout-go">Se déconnecter</button>');
 }

 /* ---------- actions ---------- */
 Object.assign(A,{
  'cl-open'(){location.hash='parametres';closeSheet();setTimeout(()=>{const c=$('.cl-card');if(c)c.scrollIntoView({behavior:'smooth',block:'center'})},200)},
  'cl-create':createSheet,'cl-create-go':(d,el)=>createGo(el),
  'cl-login'(){const o=$('#onb');if(o)o.style.display='none';loginSheet()},
  'cl-cancel'(){closeSheet();const o=$('#onb');if(o)o.style.display=''},
  'cl-login-go':(d,el)=>loginGo(el),
  'cl-forgot'(d,el,e){if(e)e.preventDefault();forgotSheet()},'cl-forgot-go':(d,el)=>forgotGo(el),
  'cl-join-merge':()=>finishJoin(true),
  'cl-join-replace'(){ask('Effacer les fiches de cet appareil et les remplacer par celles du cabinet ?','Remplacer',()=>finishJoin(false))},
  'cl-sync':()=>sync(true),
  'cl-pwd':()=>pwdSheet(false),'cl-pwd-go':(d,el)=>pwdGo(el),
  'cl-copy'(d){const v=d.v;(navigator.clipboard?navigator.clipboard.writeText(v):Promise.reject()).then(()=>toast('Copié'),()=>{prompt('Copiez :',v)})},
  'cl-rc-dl'(d){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['DentaGest DZ — code de secours du cabinet '+(S.config.cabinet||'')+'\nIdentifiant : '+(C.st?C.st.me.login:'')+'\nCode de secours : '+d.v+'\n\nConservez ce document en lieu sûr. Il permet de retrouver l’accès aux données si vous oubliez votre mot de passe.\n'],{type:'text/plain'}));a.download='DentaGest-code-de-secours.txt';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)},
  'cl-rc-done'(){if(!$('#cl_rc_ok').checked)return err('cl_err','Cochez la case pour confirmer que vous avez noté le code.');closeSheet();render();toast('Cloud du cabinet activé. Ajoutez votre équipe dans Paramètres.')},
  'cl-team':teamSheet,'cl-mem-add':addSheet,'cl-mem-add-go':(d,el)=>addGo(el),
  'cl-mem-perms':d=>permsSheet(d.id),
  async 'cl-mem-perms-go'(d,el){const done=busyBtn(el);try{await call('team/update',{id:d.id,perms:readPerms()});toast('Accès enregistrés');teamSheet()}catch(e){done();err('cl_err',e.message)}},
  async 'cl-mem-reset'(d){const m=await memName(d.id);if(!m)return;ask('Créer un nouveau mot de passe provisoire pour '+m.name+' ? Ses appareils seront déconnectés.','Créer',async()=>{try{const tmp=code(3,4),c=await creds(C.st.key,tmp);await call('team/update',{id:d.id,reset:c});credSheet(m.name,m.u.login,tmp,false)}catch(e){toast(e.message)}})},
  async 'cl-mem-active'(d){const m=await memName(d.id);if(!m)return;const act=d.v==='1';
   const go=async()=>{try{await call('team/update',{id:d.id,active:act});toast(act?'Compte réactivé':'Compte désactivé, ses appareils sont déconnectés');teamSheet()}catch(e){toast(e.message)}};
   if(act)go();else ask('Désactiver le compte de '+m.name+' ? Il sera immédiatement déconnecté de tous ses appareils, et les données du cabinet y seront effacées.','Désactiver',go)},
  'cl-devices':devicesSheet,
  'cl-dev-revoke'(d){ask('Déconnecter cet appareil ? Il ne pourra plus accéder au cabinet, et ses données seront effacées dès sa prochaine connexion à internet.','Déconnecter',async()=>{try{await call('sessions/revoke',{id:d.id});toast('Appareil déconnecté');devicesSheet()}catch(e){toast(e.message)}})},
  'cl-activity':()=>activitySheet(0),'cl-activity-more':d=>activitySheet(Number(d.v)),
  'cl-rec-new':recNewSheet,
  async 'cl-rec-new-go'(d,el){const cur=$('#cl_cur').value;if(!cur)return err('cl_err','Entrez votre mot de passe.');const done=busyBtn(el,'Sécurisation…');
   try{const {salt}=await call('prelogin',{login:C.st.me.login},1),dd=await derive(cur,salt),rc=code(5,4),r=await creds(C.st.key,rc);
    await call('recovery',{current:dd.auth,rsalt:r.salt,rauth:r.auth,rwrapped:r.wrapped});recSheet(rc,false)}catch(e){done();err('cl_err',e.message)}},
  'cl-logout':logoutSheet,
  async 'cl-logout-go'(){const w=$('#cl_wipe').checked;try{await call('logout')}catch(e){}
   if(w){await wipe();closeSheet();location.reload()}else{C.st=null;C.out={};try{await IDB.set('cloud',null);await IDB.set('outbox',{})}catch(e){}applyNav();closeSheet();render();toast('Déconnecté du cabinet. Les données restent sur cet appareil.')}},
  'cl-reload'(){location.reload()}
 });
 addEventListener('change',e=>{if(e.target&&e.target.id==='cl_prof'){const o=e.target.selectedOptions[0];if(o&&o.value!=='libre')document.querySelectorAll('.cl-perm').forEach(x=>x.checked=o.dataset.p.includes(x.value))}});

 /* ---------- intégration à l'interface ---------- */
 const _render=render;
 render=function(){if(on()&&ui.patient&&!pat(ui.patient))ui.patient=null;_render();badge()};
 const _vParams=vParams;
 vParams=function(){
  const h=_vParams(),head=h.indexOf('</div></div>')+12;
  if(on()&&!perms().includes('p')){
   const a=h.indexOf('<div class="card"><h2>Apparence'),b=h.indexOf('<div class="card"><h2>Modèle');
   return h.slice(0,head)+card()+(a>0&&b>a?h.slice(a,b):'')+'<div class="note">Les informations du cabinet, l’en-tête des ordonnances et les tarifs sont gérés par le titulaire du cabinet.</div>';
  }
  return h.slice(0,head)+card()+h.slice(head);
 };
 const _closeSheet=closeSheet;
 closeSheet=function(){_closeSheet();const o=$('#onb');if(o&&o.style.display==='none'&&!C.hold)o.style.display=''};
 const _onbOpen=onbOpen;
 onbOpen=function(){_onbOpen();const f=$('#onb .ob-foot');if(f)f.insertAdjacentHTML('afterend','<button class="btn ob-join" data-a="cl-login">Je fais partie d’un cabinet : j’ai un identifiant</button>')};

 async function boot(){
  try{C.st=(await IDB.get('cloud'))||null;C.out=(await IDB.get('outbox'))||{}}catch(e){C.st=null;C.out={}}
  if(on()){applyNav();setTimeout(()=>sync(),600)}
  setInterval(()=>{if(on()&&!document.hidden)sync()},20000);
  addEventListener('online',()=>{C.err='';sync()});addEventListener('offline',badge);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&on())sync()});
 }
 return {boot,sync,on,state:()=>C};
})();
