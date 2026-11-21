# DentaGest DZ — site deployed on Cloudflare (Worker `dentagest-dz`)

This folder is the whole site at dentagest-dz.dentagestdz.workers.dev, live since 2026-11-17 with the **Importer des patients** feature.

- `public/`: the site files (index.html = the app, sw.js, manifest, fonts, icons, vendor/jsPDF, installer-android.html, downloads/DentaGest-DZ.apk).
- `worker.js`: serves `public/index.html` at `/` and `/index.html`; everything else is a static asset. `public/.assetsignore` keeps index.html out of the assets.
- `wrangler.jsonc`: Worker config.

## Deploy
```
npm i wrangler@4
npx wrangler deploy
```
From a Claude cloud session, the Cloudflare token is stored on the environment and injected by its proxy: run with `CLOUDFLARE_API_TOKEN=proxy-injected` (plus `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`). There, only changes to `index.html` and `worker.js` can be deployed: uploading a new or changed static file (APK, icons...) is refused, because the proxy replaces Cloudflare's upload key with the token. Deploy such changes from a normal computer.

Roll back: `npx wrangler rollback` (previous versions are kept by Cloudflare).

## What the dentist sees
- **Patients › Importer**, or **Paramètres › Données › Importer des patients d’un autre logiciel**.
- Choose the patients file exported from the old software: **Excel .xlsx** or **CSV / TXT** (`;` `,` tab or `|`, UTF-8, UTF-16 or Windows/ANSI encoding).
- Columns are recognised from their titles (French, English, Arabic): nom, prénom, nom + prénom together, téléphone (+ second phone), date de naissance or âge, sexe, adresse, ville/commune, antécédents, allergies, notes/observations, n° de dossier, date de création. The title row can be below a few title lines. Each column can be corrected with a menu before importing.
- Preview of the first patients, and counts: to import / already in DentaGest (skipped) / rows without a name (skipped).
- **Annuler l’import** in Paramètres › Données removes the patients of the last import.
- **Télécharger le modèle Excel (CSV)**: a blank template for dentists coming from paper files.

## Cleaning applied
- Phones: `+213…`, `00213…` and numbers that lost their leading 0 in Excel become `0550 12 34 56`.
- Dates: `jj/mm/aaaa`, `jj-mm-aa`, `aaaa-mm-jj`, year only, and real Excel date cells. Age only → estimated birth year (1 January).
- Names: NOM in capitals. "BENALI Yasmine" in one column is split on the word in capitals; otherwise the first word is taken as the nom.
- Allergies: the text is kept, and Pénicillines, AINS/aspirine, macrolides, codéine/tramadol, paracétamol, métronidazole, chlorhexidine, anesthésiques and latex are ticked so the prescription allergy alert works.
- "RAS", "néant", "aucun", "non", "-" are treated as empty.
- Duplicates: same name (any word order) and same phone or same birth date, against existing patients and within the file.

## Not supported
- Old `.xls` (Excel 97–2003), `.ods`, Access/DBF databases: the app asks to re-save as .xlsx or CSV.
- Appointments, prescriptions, payments and dental charts from the old software: patients only.
- In cloud mode the app loads at most 1 000 documents per collection (existing limit in `Store.loadRemote`); the import warns above that.

`exemples-import/` holds two test files (a Windows-encoded CSV and an .xlsx with a title above the table).
