# DentaGest DZ — vertical ad (Reels / TikTok / Shorts)

- `DentaGestDZ-ad.mp4`: 1080×1920, 30 fps, 32 s, H.264 + AAC, normalized to -14 LUFS
- `DentaGestDZ-ad-cover.jpg`: cover / thumbnail frame
- `source/hook-dentist.mp4`: original UGC clip (used for 0–10 s, with its own audio)

## Storyboard
| Time | Scene |
|---|---|
| 0–10 s | Hook: dentist tired of handwritten prescriptions → discovers DentaGest DZ (captions, brand reveal) |
| 10–14 s | 01 · Prescription in 30 s from a ready-made template (real app screens) |
| 14–18 s | 02 · Automatic allergy alert (penicillin) |
| 18–22 s | 03 · 43 drugs ready to prescribe |
| 22–25.6 s | 04 · Printed letterhead FR / عربي, classic and cabinet layouts |
| 25.6–28.4 s | 05 · Patients, history, offline, installable, backup |
| 28.4–32 s | Call to action |

## Rebuild
Screens come from the real app (`index.html`) with fictional demo data, captured by `build/capture.js` (Playwright, 390×844 @3x).
`build/ad.html` is the animated timeline; `build/render.js video` renders it frame by frame; `build/music.py` synthesizes the original music bed and sound effects from `build/cues.txt`; ffmpeg mixes the voice and music.
