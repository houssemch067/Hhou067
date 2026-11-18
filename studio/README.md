# DentaStudio — AI dental photo & reel studio

An installable web app (PWA) for dentists to capture standardised clinical photos and turn
before/after cases into polished social-media videos, with on-device AI. Inspired by the
workflow of dental photography apps, built from scratch.

## Features

**Cases & capture**
- Patient cases with photos tagged *Before / Progress / After* and by clinical view
- Camera with dental framing guides (smile, retracted frontal, laterals, occlusals, portrait, profile),
  grid, 3 s timer, mirror correction for intra-oral mirror shots, zoom/torch where supported, video recording
- AI shot check: warns when the head is tilted or the smile is off-centre

**Photo editor**: rotate, mirror, straighten (AI levels the eye line), crop to social ratios,
AI auto-enhance (exposure, contrast, white balance), whitening preview (consultation simulation,
always saved as a separate photo tagged "simulation")

**Compare**: slider, side-by-side and onion-skin modes, AI auto-alignment of the two smiles, image export

**Video Studio**
- Multi-track timeline: video/photo clips, text track (auto lanes), music track with waveform
- Drag to reorder, trim/resize handles, split at playhead, duplicate, undo/redo, zoomable timeline, keyboard shortcuts
- Before/after clip layouts: animated **swipe reveal** and **split** (both AI-aligned), with labels
- 10 transitions (dissolve, fade, flash, wipe, slide, push, zoom, circle, blur, cut)
- Motion: slow zoom in/out, pans, **AI smile zoom** (pushes in on the detected smile)
- Per-clip colour (brightness, contrast, saturation, warmth) + AI auto-enhance; video speed, trim, volume
- Text with presets, fonts, boxes/pills, animations (slide up, pop, typewriter, zoom, fade), drag on the preview
- Formats 9:16, 4:5, 1:1, 16:9; clinic watermark (logo or handle)
- Music with fades and **AI beat sync** (tempo detection snaps cuts onto the beat)
- **Magic Reel**: pick a before & after photo, choose a template → complete branded edit in seconds
- Export MP4 (H.264 where the browser supports it, else WebM) at 1080p/720p/540p, still-frame PNG, caption ideas

## AI, privacy and data
- Face/smile landmarks use MediaPipe Face Landmarker, loaded from jsDelivr / Google storage on first use
  and then run **locally in the browser**. Photos are never uploaded.
- All cases, media and projects are stored in the browser (IndexedDB) on the device.
- Get written patient consent before using photos in marketing. Whitening previews are simulations.

## Run it
It is a static site with no build step. Serve the repository over HTTPS (the camera needs a secure context) and open `/studio/`.

```bash
python3 -m http.server 8000   # then open http://localhost:8000/studio/
```

Video export renders in real time, so keep the tab visible while it renders. Chrome / Edge / Safari 17+ recommended.

## Code map
| File | Role |
|---|---|
| `js/engine.js` | Timeline renderer (clips, layouts, transitions, text, watermark), shared by preview and export |
| `js/studio.js` | Video editor UI: timeline, inspector, media bin, Magic Reel wizard, export dialog |
| `js/project.js` | Project model, text presets, Magic Reel templates, beat sync |
| `js/ai.js` | Face landmarks, alignment focus, auto-enhance, whitening, beat detection, captions |
| `js/exporter.js` | Canvas + WebAudio → MediaRecorder video export |
| `js/cases.js` / `capture.js` / `compare.js` | Cases & photo editor, camera, comparison |
| `js/store.js` | IndexedDB persistence |
