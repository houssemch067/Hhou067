# DentaGest DZ — import de patients depuis un autre logiciel

`index.html` is the live app's `index.html` (dentagest-dz.dentagestdz.workers.dev, downloaded 2026-11-17) with a new **Importer des patients** feature. Only this file changed: deploy it in place of the current `index.html` on the Worker, and keep the other files (sw.js, fonts, icons, vendor, manifest).

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
