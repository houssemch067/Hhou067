# DentaGest DZ — Cloud du cabinet

Application DentaGest DZ (copie de la version en ligne) + synchronisation chiffrée de bout en bout et comptes d'équipe.

- Version en ligne : https://dentagest-dz.dentagestdz.workers.dev (base D1 `dentagest-prod`, **sans** l'assistant WhatsApp) : `npm run deploy:prod`
- Version de test : https://dentagest-dz-test.dentagestdz.workers.dev (base D1 `dentagest-test`, avec l'assistant) : `npm run deploy:test`
- Retour à l'ancienne version en ligne (avant le cloud) si besoin : `npx wrangler rollback 17e5a2f9-6eed-4626-b8e2-eb76346f4b48 --env production`

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

## Assistant WhatsApp (IA) — en attente, pas encore lancé
Activé seulement si `ASSISTANT=1` (variable du worker) et inclus dans l'appli seulement si la construction n'a pas `ASSISTANT=0`. La version en ligne est construite et déployée sans lui.

- Répond aux patients sur WhatsApp avec **Claude Haiku 5.5** (`src/assistant.js`) : infos pratiques, tarifs, demandes de rendez-vous sur les créneaux libres, annulations, urgences. Aucun conseil médical.
- L'application publie seulement les informations du cabinet et les **créneaux libres sans aucun nom** (`src/wa.js`). Les demandes sont chiffrées pour les appareils du cabinet (ECDH P-256 + AES-GCM). Les conversations sont effacées du serveur après 3 jours.
- L'équipe traite les demandes dans l'appli (« Demandes WhatsApp ») : *Accepter* crée la fiche et le RDV puis envoie la confirmation WhatsApp.
- Limite mensuelle de conversations par cabinet (`wa_config.quota`, 500 par défaut) ; au-delà, message d'attente et transmission à l'équipe.
- Secrets du worker : `ANTHROPIC_API_KEY` (clé Claude), `WA_APP_SECRET` (secret de l'application Meta), `WA_VERIFY_TOKEN` (jeton de vérification du webhook). Webhook : `/wa/webhook`.
- Tests : `node tests/mock.cjs` (faux Claude + faux WhatsApp), `.dev.vars` local, puis `node tests/e2e-wa.cjs`.
