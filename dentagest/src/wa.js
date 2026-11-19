/* =====================================================================
   ASSISTANT WHATSAPP (IA) — réglages, essai, demandes des patients
   L'application publie au serveur les informations pratiques du cabinet et
   les créneaux libres (sans aucun nom de patient). Les demandes reçues sont
   chiffrées pour les appareils du cabinet : seule l'équipe peut les lire.
   ===================================================================== */
const Assistant=(()=>{
 const {call,clSheet,busyBtn,err,rel,plural}=Cloud;
 const W={status:null,stAt:0,items:[],dec:{},pubAt:0,pt:0,known:null,sim:[],busy:false};
 const JOURS=[[6,'Samedi'],[0,'Dimanche'],[1,'Lundi'],[2,'Mardi'],[3,'Mercredi'],[4,'Jeudi'],[5,'Vendredi']];
 const H_DEF={0:'09:00-12:00, 14:00-18:00',1:'09:00-12:00, 14:00-18:00',2:'09:00-12:00, 14:00-18:00',3:'09:00-12:00, 14:00-18:00',4:'09:00-12:00, 14:00-18:00',5:'',6:'09:00-12:00, 14:00-18:00'};
 const TYPES={rdv:['📅','Demande de rendez-vous'],urgence:['🚨','Urgence'],annulation:['❌','Annulation'],deplacement:['🔁','Changement de rendez-vous'],question:['💬','Message à traiter']};
 const b64e=b=>{const u=new Uint8Array(b);let s='';for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
 const b64d=s=>{s=String(s).replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u};
 const cfg=()=>S.config.wa||{};
 const ready=()=>Cloud.on()&&!!cfg().pub;
 const canConfig=()=>Cloud.on()&&(Cloud.isOwner()||Cloud.perms().includes('p'));
 const toMin=h=>{const m=/^(\d{1,2})[:h](\d{2})$/.exec(String(h||'').trim());return m?+m[1]*60+ +m[2]:null};
 const hm=t=>String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');
 const ranges=s=>String(s||'').split(/[,;]/).map(x=>x.split('-').map(toMin)).filter(r=>r.length===2&&r[0]!=null&&r[1]!=null&&r[1]>r[0]);
 const telOf=wa=>wa&&/^213\d{9}$/.test(wa)?'0'+wa.slice(3).replace(/(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/,'$1$2 $3 $4 $5'):wa?'+'+wa:'';
 const fmtWa=wa=>String(wa||'').startsWith('sim:')?'Essai dans l’application':telOf(wa);

 /* ---------- créneaux libres et profil publié ---------- */
 function slots(){
  const w=cfg(),dur=Number(w.duree)||30,minT=Date.now()+(Number(w.delai)||2)*3600e3,out=[],H=w.horaires||H_DEF;
  for(let i=0;i<(Number(w.jours)||14);i++){
   const d=addDays(today(),i),wd=new Date(d+'T12:00:00').getDay();
   const busy=S.rdv.filter(r=>r.date===d&&r.statut!=='absent').map(r=>{const s=toMin(r.heure);return s==null?null:[s,s+(Number(r.duree)||dur)]}).filter(Boolean);
   for(const [a,b] of ranges(H[wd]))for(let t=a;t+dur<=b;t+=dur){
    if(new Date(d+'T'+hm(t)+':00').getTime()<minT)continue;
    if(busy.some(([x,y])=>t<y&&t+dur>x))continue;
    out.push({date:d,heure:hm(t)});
   }
  }
  return out.slice(0,80);
 }
 function profile(){
  const w=cfg(),c=S.config,H=w.horaires||H_DEF;
  return {cabinet:c.cabinet,praticien:c.praticien,specialite:c.specialite,adresse:c.adresse,ville:c.ville,tel:c.tel,duree:Number(w.duree)||30,
   horaires:JOURS.map(([k,n])=>'  '+n+' : '+(ranges(H[k]).length?ranges(H[k]).map(([a,b])=>hm(a)+'-'+hm(b)).join(', '):'fermé')).join('\n'),
   tarifs:w.tarifs===false?[]:tarifs(),consignes:String(w.consignes||'').slice(0,3000),slots:slots()};
 }
 async function publish(){
  clearTimeout(W.pt);W.pt=0;
  if(!ready()||!navigator.onLine)return;
  try{await call('wa/profile',{profile:profile()});W.pubAt=Date.now()}catch(e){console.warn('wa profile',e)}
 }
 const publishSoon=()=>{if(!ready())return;clearTimeout(W.pt);W.pt=setTimeout(publish,4000)};
 const _save=Store.save,_del=Store.del,_cfg=Store.saveConfig;
 Store.save=function(col,obj,delay){_save.call(Store,col,obj,delay);if(col==='rdv')publishSoon()};
 Store.del=function(col,id){_del.call(Store,col,id);if(col==='rdv')publishSoon()};
 Store.saveConfig=function(){_cfg.call(Store);publishSoon()};

 /* ---------- demandes reçues ---------- */
 async function decrypt(it){
  if(W.dec[it.id])return W.dec[it.id];
  const priv=await crypto.subtle.importKey('jwk',cfg().priv,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
  const o=JSON.parse(it.data),epk=await crypto.subtle.importKey('raw',b64d(o.epk),{name:'ECDH',namedCurve:'P-256'},false,[]);
  const bits=await crypto.subtle.deriveBits({name:'ECDH',public:epk},priv,256);
  const k=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',bits),'AES-GCM',false,['decrypt']);
  return W.dec[it.id]=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:b64d(o.iv)},k,b64d(o.ct))));
 }
 async function poll(){
  if(!ready()||W.busy)return;W.busy=true;
  try{
   const r=await call('wa/requests');const items=[];
   for(const it of r.items){try{items.push({...it,...await decrypt(it)})}catch(e){console.warn('wa: demande illisible',it.id)}}
   const before=W.known;W.items=items;W.known=new Set(items.map(x=>x.id));
   if(before){const fresh=items.filter(x=>x.status==='new'&&!before.has(x.id));
    if(fresh.some(x=>x.type==='urgence')){toast('🚨 Urgence reçue sur WhatsApp : ouvrez les demandes');try{navigator.vibrate&&navigator.vibrate([300,150,300])}catch(e){}}
    else if(fresh.length)toast('📩 '+plural(fresh.length,'nouvelle demande')+' WhatsApp');
    if(fresh.length)safeRender();}
   else if(items.some(x=>x.status==='new'))safeRender();
   if($('#wa-inbox'))drawInbox();
  }catch(e){console.warn('wa poll',e)}finally{W.busy=false}
 }
 function safeRender(){const a=document.activeElement;if($('#modal').innerHTML||$('#onb')||(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))||route()==='reel')return;render()}
 const pending=()=>W.items.filter(x=>x.status==='new');

 /* ---------- interface ---------- */
 function banner(){
  if(!ready())return '';const p=pending();if(!p.length)return '';
  const u=p.filter(x=>x.type==='urgence').length;
  return '<button class="wa-banner'+(u?' urg':'')+'" data-a="wa-inbox"><span>'+(u?'🚨':'📩')+'</span><b>'+plural(p.length,'demande')+' WhatsApp à traiter'+(u?' · dont '+plural(u,'urgence'):'')+'</b><i>Voir ›</i></button>';
 }
 function card(){
  if(!Cloud.on())return '<div class="card wa-card"><h2>Assistant WhatsApp (IA)</h2><p style="margin:0;color:var(--muted)">Répond à vos patients sur WhatsApp, jour et nuit. Activez d’abord le <b>cloud du cabinet</b> ci-dessus.</p></div>';
  const s=W.status,w=cfg();
  const pill=!w.pub?'<span class="pill plain">Non configuré</span>':s&&s.enabled?'<span class="pill ok">Activé</span>':'<span class="pill warn">En pause</span>';
  const est=s?Math.round(((s.usage.tokens_in||0)*0.10+(s.usage.tokens_out||0)*0.50)/1e6*260):0;
  return '<div class="card wa-card"><h2>Assistant WhatsApp (IA) '+pill+'</h2>'+
   '<p style="margin:0 0 10px">Répond à vos patients sur WhatsApp <b>24 h/24</b>, en darija, en arabe ou en français : adresse, horaires, tarifs, <b>demandes de rendez-vous</b> sur vos créneaux libres, annulations et <b>urgences</b>. Votre équipe confirme chaque rendez-vous en un geste.</p>'+
   (s?'<p style="margin:0 0 12px;color:var(--muted)">'+(s.connected?'WhatsApp : <b>'+esc(s.phone||'numéro relié')+'</b>':'WhatsApp pas encore relié (l’essai dans l’application fonctionne déjà)')+' · Ce mois : <b>'+s.usage.convos+'</b> / '+s.quota+' conversations'+(est?' · coût IA ≈ '+est+' DA':'')+(s.ai?'':' · <span style="color:var(--crit)">IA non configurée sur le serveur</span>')+'</p>':'')+
   '<div class="row"><button class="btn pri" data-a="wa-set">'+(w.pub?'Réglages':'Configurer l’assistant')+'</button>'+(w.pub?'<button class="btn" data-a="wa-test">Tester l’assistant</button><button class="btn" data-a="wa-inbox">Demandes'+(pending().length?' ('+pending().length+')':'')+'</button>':'')+'</div></div>';
 }
 async function refreshStatus(force){
  if(!Cloud.on()||(!force&&Date.now()-W.stAt<5000))return;W.stAt=Date.now();
  try{W.status=await call('wa/status');const el=$('.wa-card');if(el)el.outerHTML=card()}catch(e){}
 }

 function setSheet(){
  const w=cfg(),H=w.horaires||H_DEF,s=W.status||{};
  clSheet('Assistant WhatsApp','<div class="form">'+
   '<p class="lbl" style="margin:0">Horaires d’ouverture (vide = fermé)</p>'+JOURS.map(([k,n])=>'<label class="f wa-day">'+n+'<input type="text" id="wa_h'+k+'" value="'+esc(H[k]||'')+'" placeholder="Fermé"></label>').join('')+'<p class="wa-small" style="margin:0">Format : 09:00-12:00, 14:00-18:00</p>'+
   '<label class="f">Durée d’un créneau<select id="wa_dur">'+[15,20,30,45,60].map(m=>'<option'+((Number(w.duree)||30)===m?' selected':'')+' value="'+m+'">'+m+' minutes</option>').join('')+'</select></label>'+
   '<label class="f">Proposer des créneaux sur<select id="wa_jours">'+[7,14,21,30].map(d=>'<option'+((Number(w.jours)||14)===d?' selected':'')+' value="'+d+'">'+d+' jours</option>').join('')+'</select></label>'+
   '<label class="f">Délai minimum avant un rendez-vous<select id="wa_delai">'+[[1,'1 heure'],[2,'2 heures'],[4,'4 heures'],[24,'1 jour']].map(([v,n])=>'<option'+((Number(w.delai)||2)===v?' selected':'')+' value="'+v+'">'+n+'</option>').join('')+'</select></label>'+
   '<label class="cl-chk"><input type="checkbox" id="wa_tarifs"'+(w.tarifs===false?'':' checked')+'> Donner les tarifs indicatifs (Paramètres › Tarifs des actes)</label>'+
   '<label class="f full">Consignes pour l’assistant (facultatif)<textarea id="wa_cons" rows="4" placeholder="Ex. : Paiement en espèces uniquement. Parking derrière la pharmacie. Pas d’orthodontie au cabinet. Venir 10 minutes avant le rendez-vous.">'+esc(w.consignes||'')+'</textarea></label>'+
   '<p class="lbl" style="margin:10px 0 0">Connexion WhatsApp Business (API Cloud de Meta)</p>'+
   '<label class="f">Numéro WhatsApp du cabinet<input type="tel" id="wa_phone" value="'+esc(s.phone||'')+'" placeholder="0555 12 34 56"></label>'+
   '<label class="f">Identifiant du numéro (Phone number ID)<input type="text" id="wa_pid" inputmode="numeric" value="'+esc(s.phoneNumberId||'')+'" placeholder="Ex. 123456789012345"></label>'+
   '<label class="f">Jeton d’accès<input id="wa_tok" type="password" autocomplete="off" placeholder="'+(s.connected?'Enregistré (laisser vide pour le garder)':'Jeton permanent de l’API WhatsApp')+'"></label>'+
   (s.webhookUrl?'<p class="wa-small">Adresse du webhook à donner à Meta : <b>'+esc(s.webhookUrl)+'</b></p>':'')+
   '<label class="cl-chk" style="margin-top:8px"><input type="checkbox" id="wa_on"'+(!w.pub||s.enabled?' checked':'')+'> Assistant activé (répond aux patients)</label></div>'+
   '<div class="note" style="margin-top:12px">L’assistant ne voit jamais vos dossiers patients : il reçoit seulement les informations ci-dessus et vos créneaux libres, sans aucun nom. Il ne donne aucun conseil médical. Les conversations sont effacées du serveur après 3 jours.</div><div id="cl_err"></div>',
   '<button class="btn" data-a="close">Annuler</button><button class="btn pri" data-a="wa-set-go">Enregistrer</button>');
 }
 async function setGo(el){
  const w={...cfg()},H={};
  for(const [k,n] of JOURS){const v=val('wa_h'+k);if(v&&!ranges(v).length)return err('cl_err',n+' : écrivez les horaires comme « 09:00-12:00, 14:00-18:00 ».');H[k]=v}
  const pid=val('wa_pid'),tok=$('#wa_tok').value.trim();
  if(pid&&!/^\d{6,25}$/.test(pid))return err('cl_err','L’identifiant du numéro ne contient que des chiffres.');
  const done=busyBtn(el,'Enregistrement…');err('cl_err','');
  try{
   if(!w.pub){const kp=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
    w.priv=await crypto.subtle.exportKey('jwk',kp.privateKey);w.pub=b64e(await crypto.subtle.exportKey('raw',kp.publicKey))}
   Object.assign(w,{horaires:H,duree:+$('#wa_dur').value,jours:+$('#wa_jours').value,delai:+$('#wa_delai').value,tarifs:$('#wa_tarifs').checked,consignes:val('wa_cons')});
   S.config.wa=w;Store.saveConfig();
   await call('wa/config',{pubkey:w.pub,enabled:$('#wa_on').checked,phoneNumberId:pid,phone:val('wa_phone'),...(tok?{token:tok}:{})});
   await publish();await refreshStatus(true);
   closeSheet();render();toast('Assistant enregistré. Essayez-le avec « Tester l’assistant ».');
  }catch(e){done();err('cl_err',e.message)}
 }
 const val=id=>(($('#'+id)||{}).value||'').trim();

 /* Essai dans l'application */
 function testSheet(){
  clSheet('Tester l’assistant','<p class="wa-small" style="margin:0 0 10px">Écrivez comme un patient (darija, arabe ou français). Les demandes créées ici arrivent dans vos demandes WhatsApp, marquées « Essai ».'+(W.status&&!W.status.ai?' <b style="color:var(--crit)">La clé IA n’est pas encore configurée sur le serveur : l’assistant répondra par un message d’attente.</b>':'')+'</p><div class="wa-chat" id="wa_chat"></div>'+
   '<div class="wa-in"><textarea id="wa_msg" rows="1" placeholder="Salam, 3andi wja3 f dersi…"></textarea><button class="btn pri" data-a="wa-test-send">Envoyer</button></div>',
   '<button class="btn" data-a="wa-test-reset">Recommencer</button><button class="btn" data-a="wa-inbox">Voir les demandes</button>');
  drawChat();setTimeout(()=>{const t=$('#wa_msg');if(t)t.focus()},100);
 }
 function drawChat(){const c=$('#wa_chat');if(!c)return;c.innerHTML=W.sim.map(m=>'<div class="wa-b '+m.r+'">'+esc(m.t).replace(/\*([^*\n]+)\*/g,'<b>$1</b>').replace(/\n/g,'<br>')+'</div>').join('')||'<div class="wa-small" style="text-align:center;padding:20px">Envoyez un premier message.</div>';c.scrollTop=c.scrollHeight}
 async function testSend(el){
  const t=$('#wa_msg'),text=t.value.trim();if(!text)return;
  W.sim.push({r:'me',t:text},{r:'bot wait',t:'…'});t.value='';drawChat();const done=busyBtn(el,'…');
  try{const r=await call('wa/simulate',{text});W.sim.pop();W.sim.push({r:'bot',t:r.reply})}
  catch(e){W.sim.pop();W.sim.push({r:'bot err',t:e.message})}
  done();drawChat();poll();const i=$('#wa_msg');if(i)i.focus();
 }

 /* Demandes */
 function inbox(){clSheet('Demandes WhatsApp','<div id="wa-inbox"><div class="empty">Chargement…</div></div>');drawInbox();poll()}
 function itemHTML(x){
  const [e,n]=TYPES[x.type]||TYPES.question,act=x.status==='new';
  const det=[x.nom?'<b>'+esc(x.nom)+'</b>':'',x.type==='rdv'?esc(x.motif||'')+' · <b>'+esc(longDate(x.date))+' à '+esc(x.heure)+'</b>':'',x.rdv?'Rendez-vous : '+esc(x.rdv):'',x.nouveau?'Souhaite : '+esc(x.nouveau):'',x.resume?esc(x.resume):''].filter(Boolean).join('<br>');
  return '<div class="wa-item t-'+esc(x.type)+(act?'':' done')+'"><div class="wa-ih"><span>'+e+' '+n+(x.sim?' <span class="pill plain">Essai</span>':'')+'</span><small>'+rel(x.at)+'</small></div><div>'+det+'</div><small class="wa-small">'+esc(fmtWa(x.wa))+'</small>'+
   (act?'<div class="row">'+(x.type==='rdv'?'<button class="btn sm pri" data-a="wa-accept" data-id="'+x.id+'">Accepter</button>':'')+
    '<button class="btn sm" data-a="wa-reply" data-id="'+x.id+'">'+(x.type==='rdv'?'Proposer autre chose':'Répondre')+'</button>'+
    (x.wa&&!String(x.wa).startsWith('sim:')?'<a class="btn sm" href="tel:+'+esc(x.wa)+'">Appeler</a>':'')+
    '<button class="btn sm" data-a="wa-done" data-id="'+x.id+'">'+(x.type==='rdv'?'Ignorer':'Traité')+'</button></div>':'')+'</div>';
 }
 function drawInbox(){
  const el=$('#wa-inbox');if(!el)return;
  const p=pending().sort((a,b)=>(b.type==='urgence')-(a.type==='urgence')||a.at-b.at),d=W.items.filter(x=>x.status!=='new').slice(0,20);
  el.innerHTML=(p.map(itemHTML).join('')||'<div class="empty">Aucune demande en attente.</div>')+(d.length?'<p class="lbl" style="margin:16px 0 6px">Traitées (7 derniers jours)</p>'+d.map(itemHTML).join(''):'');
 }
 const item=id=>W.items.find(x=>x.id===id);
 async function setStatus(id,status){try{await call('wa/requests/update',{id,status});const x=item(id);if(x)x.status=status}catch(e){toast(e.message)}}
 function patientFor(x){
  const wa=String(x.wa||'');
  let p=!wa.startsWith('sim:')&&S.patients.find(q=>[q.tel,q.tel2].some(t=>t&&waNum(t)===wa));
  if(!p){p={id:newId(),nom:String(x.nom||'Patient WhatsApp').trim(),prenom:'',tel:wa.startsWith('sim:')?'':telOf(wa),dents:{},cree:today(),source:'whatsapp'};if(x.sim)p.ex=true;Store.save('patients',p)}
  return p;
 }
 function accept(id){
  const x=item(id);if(!x)return;
  const clash=S.rdv.find(r=>r.date===x.date&&r.heure===x.heure&&r.statut!=='absent');
  const go=()=>{
   const p=patientFor(x),r={id:newId(),patientId:p.id,date:x.date,heure:x.heure,motif:x.motif||'',statut:'confirme',duree:Number(cfg().duree)||30,note:'Demande WhatsApp'};if(x.sim)r.ex=true;
   Store.save('rdv',r);setStatus(id,'done');
   const c=S.config;
   replySheet(x,'Bonjour'+(x.nom?' '+String(x.nom).split(/\s+/)[0]:'')+', votre rendez-vous au '+(c.cabinet||'cabinet')+' est *confirmé* : '+longDate(x.date).toLowerCase()+' à '+x.heure+'.'+(c.adresse?'\nAdresse : '+c.adresse+(c.ville?', '+c.ville:'')+'.':'')+'\nEn cas d’empêchement, merci de nous prévenir'+(c.tel?' au '+c.tel:'')+'. À bientôt !','Rendez-vous ajouté à l’agenda ✓');
  };
  if(clash)ask('Un rendez-vous existe déjà le '+fr(x.date)+' à '+x.heure+' ('+pname(pat(clash.patientId))+'). Accepter quand même ?','Accepter',go);else go();
 }
 function replySheet(x,text,head){
  clSheet(head||'Répondre sur WhatsApp',(head?'<p style="margin:0 0 10px">Message de confirmation pour '+esc(x.nom||fmtWa(x.wa))+' :</p>':'')+'<textarea id="wa_rep" rows="6" style="width:100%">'+esc(text||'')+'</textarea><div id="cl_err"></div>',
   '<button class="btn" data-a="wa-inbox">'+(head?'Ne pas envoyer':'Retour')+'</button><button class="btn pri" data-a="wa-send" data-id="'+x.id+'">Envoyer</button>');
 }
 async function send(id,el){
  const x=item(id),text=$('#wa_rep').value.trim();if(!x||!text)return;
  const done=busyBtn(el,'Envoi…');
  try{const r=await call('wa/send',{to:x.wa,text});if(x.status==='new')await setStatus(id,'done');toast(r.sim?'Message enregistré (essai : rien n’est envoyé)':'Message envoyé sur WhatsApp ✓');inbox()}
  catch(e){done();
   if(e.message==='window'&&!String(x.wa).startsWith('sim:')){
    $('#cl_err').innerHTML='<div class="note" style="margin-top:10px">Le patient a écrit il y a plus de 24 h : WhatsApp n’autorise plus l’envoi automatique. Envoyez-le depuis votre WhatsApp :</div><div class="row" style="margin-top:8px"><a class="btn pri" target="_blank" rel="noopener" href="https://wa.me/'+esc(x.wa)+'?text='+encodeURIComponent(text)+'">Ouvrir WhatsApp</a></div>';
    if(x.status==='new')setStatus(id,'done');
   }else err('cl_err',e.message)}
 }

 Object.assign(A,{
  'wa-set'(){refreshStatus(true).then(setSheet);},'wa-set-go':(d,el)=>setGo(el),
  'wa-test':testSheet,'wa-test-send':(d,el)=>testSend(el),
  async 'wa-test-reset'(){W.sim=[];try{await call('wa/simulate',{reset:true})}catch(e){}drawChat()},
  'wa-inbox':inbox,
  'wa-accept':d=>accept(d.id),
  'wa-reply'(d){const x=item(d.id);if(x)replySheet(x,x.type==='rdv'?'Bonjour'+(x.nom?' '+String(x.nom).split(/\s+/)[0]:'')+', le créneau du '+longDate(x.date).toLowerCase()+' à '+x.heure+' n’est malheureusement plus disponible. Pouvez-vous venir ':'Bonjour'+(x.nom?' '+String(x.nom).split(/\s+/)[0]:'')+', ')},
  'wa-send':(d,el)=>send(d.id,el),
  async 'wa-done'(d){await setStatus(d.id,'done');drawInbox();safeRender()}
 });
 addEventListener('keydown',e=>{if(e.target&&e.target.id==='wa_msg'&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();const b=$('[data-a="wa-test-send"]');if(b)b.click()}});

 /* bandeau sur l'accueil et l'agenda, carte dans les paramètres */
 const _acc=vAccueil,_ag=vAgenda,_vp=vParams;
 vAccueil=function(){return banner()+_acc()};
 vAgenda=function(){return banner()+_ag()};
 vParams=function(){const h=_vp();if(!canConfig()&&Cloud.on())return h;setTimeout(()=>refreshStatus(),0);
  const i=h.indexOf('<div class="card"><h2>Abonnement');return i>0?h.slice(0,i)+card()+h.slice(i):h+card()};

 Cloud.hooks.push(()=>{if(!ready())return;poll();if(Date.now()-W.pubAt>15*60e3)publish()});
 return {poll,publish,slots,profile,state:()=>W};
})();
