# DentaGest DZ — reel v4 (French version of the Darija reel + new features)

- `DentaGestDZ-reel-FR.mp4`: 1080×1920, 30 fps, 35 s, H.264 + AAC, about -15 LUFS
- `DentaGestDZ-reel-FR-cover.jpg`: cover frame

| Time | Scene |
|---|---|
| 0–6 s | Hook (French Higgsfield clip): pharmacist « Docteur… ça, c'est un cinq ou un S ? » / dentist « Quatrième appel cette semaine… ». Headlines « Le pharmacien m'a appelée 4 fois cette semaine 😳 », « Jusqu'à ce que je change… une seule chose 👇 » |
| 6–7.2 s | Brand card: DentaGest DZ, « 10 fonctions qui font le travail pour vous » |
| 7.2–28.2 s | 10 features, 2.1 s each, counter 1/10 → 10/10 and « attendez la n°10 👀 »: patient file, **medical questionnaire**, dental chart, agenda + **waiting room**, WhatsApp reminders, prescription + allergy alert, **quotes & certificates (PDF)**, cash register, **statistics**, before/after video reels |
| 28.2–30.4 s | Payoff: pharmacist « Ah… là, je lis tout ! » + « Claire. Nette. Imprimée ✅ » |
| 30.4–33.1 s | Dentist « Trente secondes. Plus jamais d'appel. » + offer card + « Essayer gratuitement → » |
| 33.1–35 s | End card: 7 jours d'essai gratuit, 2 000 DA/mois ou 20 000 DA/an, lien en bio |

## Rebuild (from `build/`)
1. `node capture4.js` and `node cap_allergy.js`: capture the live app screens (sample data, fictional Dr Nadia Kaci) into `scr/`, plus before/after reel frames rendered by the app's own engine
2. Extract the hook clip frames to `hook/f%05d.jpg` (30 fps, 1080×1920). The clip is Higgsfield job 4a7e91b7 (Seedance 2.5, French dialogue)
3. `node render4.js preview 1.6 18.0 …` for stills, `node render4.js video` for the silent video
4. `python3 music4.py cues4.txt` synthesizes the original music and sound effects
5. ffmpeg mixes the clip's French voices (0–6 s, clip 10.0–12.2 s → 28.2 s, clip 12.3–15.0 s → 30.4 s) with the music
