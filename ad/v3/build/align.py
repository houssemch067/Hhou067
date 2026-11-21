import json, difflib, unicodedata, re
W = {
'c1': [[0.52,1.04,"Docteur,"],[1.24,1.34,"si"],[1.34,1.5,"vous"],[1.5,1.86,"germez"],[1.86,2.04,"encore"],[2.04,2.4,"votre"],[2.4,2.82,"cabinet"],[2.82,3.04,"qu"],[3.04,3.24,"'avec"],[3.24,3.36,"ce"],[3.36,3.76,"carnet,"],[4.14,4.56,"restez"],[4.56,4.68,"jusqu"],[4.68,4.9,"'à"],[4.9,5.0,"la"],[5.0,5.2,"fin,"],[5.52,5.62,"la"],[5.62,5.88,"dernière"],[5.88,6.36,"fonction"],[6.36,6.72,"va"],[6.72,6.86,"vous"],[6.86,6.98,"s"],[6.98,7.02,"'en"],[7.02,7.34,"prendre."],[8.06,8.5,"Voici"],[8.5,8.82,"d"],[8.82,8.88,"'un"],[8.88,9.36,"tigette"],[9.36,9.62,"des"],[9.62,10.4,"êtres."],[10.52,10.58,"1."],[11.16,11.34,"L"],[11.34,11.74,"'agende"],[11.74,12.14,"envée"],[12.14,12.28,"vos"],[12.28,12.68,"repels"],[12.68,12.96,"sur"],[12.96,13.34,"WhatsApp,"],[13.66,13.74,"le"],[13.74,14.04,"message"],[14.04,14.22,"est"],[14.22,14.42,"déjà"],[14.42,14.72,"écrit."]],
'c2': [[0.0,0.9,"Deux,"],[1.4,1.46,"le"],[1.46,1.8,"dossier"],[1.8,2.2,"patient"],[2.2,2.78,"avec"],[2.78,3.02,"les"],[3.02,3.5,"allergies"],[3.5,4.0,"et"],[4.0,4.14,"le"],[4.14,4.4,"chême"],[4.4,4.52,"d"],[4.52,4.92,"'antique."],[5.4,5.92,"Trois,"],[6.52,6.6,"l"],[6.6,7.22,"'ordenture"],[7.22,7.44,"en"],[7.44,7.6,"un"],[7.6,7.8,"clic"],[7.8,8.24,"à"],[8.24,8.46,"votre"],[8.46,9.06,"entaîdre."],[9.26,9.92,"Quatre,"],[10.36,10.48,"la"],[10.48,10.94,"caisse."],[11.52,11.52,"Vous"],[11.52,11.76,"voyez"],[11.76,11.94,"tout"],[11.94,12.08,"de"],[12.08,12.36,"suite"],[12.36,12.9,"qui"],[12.9,13.02,"n"],[13.02,13.04,"'a"],[13.04,13.2,"pas"],[13.2,13.36,"encore"],[13.36,13.8,"payé."]],
'c3': [[0.0,0.48,"Et"],[0.48,0.6,"la"],[0.6,0.98,"dernière,"],[1.4,1.58,"vos"],[1.58,1.98,"photos"],[1.98,2.4,"avant"],[2.4,2.86,"après"],[2.86,3.54,"devinent"],[3.54,3.74,"une"],[3.74,4.22,"vidéo"],[4.22,4.88,"prête"],[4.88,5.06,"à"],[5.06,5.6,"publier."],[6.12,6.5,"7"],[6.5,6.7,"jours"],[6.7,6.84,"d"],[6.84,7.08,"'essai"],[7.08,7.64,"gratuite,"],[8.04,8.2,"le"],[8.2,8.42,"lien"],[8.42,8.88,"est"],[8.88,9.02,"en"],[9.02,9.24,"bio."]]}
A = {
'c1': "Docteur, si vous gérez encore votre cabinet avec ce carnet… restez jusqu'à la fin, la dernière fonction va vous surprendre. Voici DentaGest DZ. Un : l'agenda envoie vos rappels sur WhatsApp, le message est déjà écrit.",
'c2': "Deux : le dossier patient, avec les allergies et le schéma dentaire. Trois : l'ordonnance en un clic, à votre en-tête. Quatre : la caisse — vous voyez tout de suite qui n'a pas encore payé.",
'c3': "Et la dernière : vos photos avant-après deviennent une vidéo prête à publier. 7 jours d'essai gratuit, le lien est en bio."}
OFF = {'c1': 0.0, 'c2': 15.05, 'c3': 30.10}
def n(s): s=unicodedata.normalize('NFD',s.lower()); s=''.join(c for c in s if unicodedata.category(c)!='Mn'); return re.sub(r"[^a-z0-9]","",s)
out=[]
for c in ['c1','c2','c3']:
    # whisper: merge apostrophe splits ("qu" + "'avec")
    ws=[]
    for s,e,w in W[c]:
        if w.startswith("'") and ws: ws[-1]=[ws[-1][0],e,ws[-1][2]+w]
        else: ws.append([s,e,w])
    au=[t for t in re.sub(r"\s[:—]\s"," ",A[c].replace(" : ",": ")).split() if t not in [':','—']]
    au=[t for t in A[c].replace(' :',':').replace(' —','').split()]
    a_n=[n(x) for x in au]; w_n=[n(x[2]) for x in ws]
    sm=difflib.SequenceMatcher(None,a_n,w_n,autojunk=False)
    tim=[None]*len(au)
    for op,i1,i2,j1,j2 in sm.get_opcodes():
        if op=='equal':
            for k in range(i2-i1): tim[i1+k]=(ws[j1+k][0],ws[j1+k][1])
        elif op=='replace':
            s0,e0=ws[j1][0],ws[j2-1][1]
            for k in range(i2-i1):
                f0=k/(i2-i1); f1=(k+1)/(i2-i1); tim[i1+k]=(s0+(e0-s0)*f0, s0+(e0-s0)*f1)
    # fill gaps (insertions) by interpolation
    for i in range(len(au)):
        if tim[i] is None:
            p=next((tim[j][1] for j in range(i-1,-1,-1) if tim[j]),0.0)
            q=next((tim[j][0] for j in range(i+1,len(au)) if tim[j]),p+0.3)
            tim[i]=(p,max(p+0.05,min(q,p+0.35)))
    for t,(s,e) in zip(au,tim): out.append({'w':t,'s':round(s+OFF[c],3),'e':round(e+OFF[c],3)})
def find(word,after=0):
    for x in out:
        if x['s']>=after and n(x['w'])==n(word): return x['s']
an={'un':find('Un',9),'deux':find('Deux',14),'trois':find('Trois',18),'quatre':find('Quatre',22),'der':find('Et',29),'hookEnd':find('restez',3)}
T={'words':out,'anchors':an,'vidEnd':40.2,'nFrames':1205}
json.dump(T,open('timing.json','w'),ensure_ascii=False)
print(an); print(' '.join(f"{x['w']}@{x['s']:.1f}" for x in out))
