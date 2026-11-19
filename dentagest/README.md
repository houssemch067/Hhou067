# DentaGest DZ — Cloud du cabinet

Application DentaGest DZ (copie de la version en ligne) + synchronisation chiffrée de bout en bout et comptes d'équipe.

- Version de test : https://dentagest-dz-test.dentagestdz.workers.dev (base D1 `dentagest-test`)
- Version en ligne (non modifiée) : https://dentagest-dz.dentagestdz.workers.dev

## Fonctionnement
- **Hors connexion d'abord** : l'appli enregistre toujours sur l'appareil (IndexedDB). Les modifications partent dans une file d'attente envoyée dès que internet revient (toutes les 20 s, au retour en ligne, à l'ouverture).
- **Chiffrement de bout en bout** : chaque fiche est chiffrée sur l'appareil (AES-256-GCM) avec la clé du cabinet. Cette clé est protégée par le mot de passe de chaque membre (PBKDF2-SHA256, 310 000 itérations) et par le code de secours du titulaire. Le serveur ne stocke que des données illisibles, et jamais les mots de passe.
- **Conflits** : par fiche, la modification la plus récente l'emporte (horloge corrigée avec celle du serveur). L'historique garde la trace de toutes les modifications.
- **Droits** : tout le monde voit agenda, patients, salle d'attente. En plus : `f` caisse, devis, statistiques ; `o` ordonnances, certificats, modèles, médicaments ; `p` paramètres du cabinet. Le serveur refuse d'envoyer ou d'accepter les fiches hors des droits.
- **Sécurité** : blocage après 5 mauvais mots de passe, déconnexion à distance d'un appareil (ses données sont effacées), mot de passe provisoire pour les nouveaux membres, changement de mot de passe = déconnexion des autres appareils.
- **Abonnement** : une seule licence pour tout le cabinet (celle de l'appareil du titulaire, partagée par la synchronisation).

## Fichiers
- `src/app.html` : l'application d'origine (inchangée)
- `src/cloud.js`, `src/cloud.css` : module Cloud, inséré par `build.mjs`
- `src/worker.js` : serveur (pages + API `/api/*`)
- `schema.sql` : tables D1
- `public/` : icônes, polices, jsPDF, service worker (intégrés au worker à la construction)
- `tests/e2e.cjs` : test complet à deux téléphones (Playwright)

## Commandes
```
npm install
npm run dev            # local : http://127.0.0.1:8787 (base locale : npx wrangler d1 execute dentagest-test --local --file=schema.sql)
BASE=http://127.0.0.1:8787/ node tests/e2e.cjs
npm run deploy:test    # publie la version de test
```
