# DentaStudio — viral before/after smile reels

A phone-first web app (PWA) that turns a dentist's before & after photos into scroll-stopping reels in seconds.
Instagram-camera-style UI, beat-synced templates, built-in royalty-free music and sound effects, on-device AI.

**Live:** https://dentastudio.dentagestdz.workers.dev

## The flow
1. **Camera** — full-screen camera with dental framing guides (smile, retracted, portrait, profile, sides, arches)
   in a swipeable carousel inside the shutter ring. Shoot BEFORE then AFTER, or pick from the gallery.
2. **Templates** — every template plays live with *your* photos and music. Swipe to browse, tap ✓ to use.
3. **Editor** — full-screen preview with a right-hand tool rail: Text, Stickers, Audio, Effects, Clips, Template, More.
   Drag text/stickers on the video, drop them on the bin to delete, undo anything.
4. **Share** — AI caption ideas, render MP4 (1080p/720p), share sheet / download, cover image.

## Viral templates (timed in beats, reveal lands on the drop)
| Template | Hook |
|---|---|
| Loading Smile | "POV" hook + loading bar → glitch → NEW SMILE UNLOCKED, confetti, magnifier, rating |
| Wait For It | 3·2·1 countdown with shake → boom reveal, confetti, "NO WAY" |
| POV | typewriter POV hook → punch reveal → swipe compare → rating |
| Glow Up Cuts | before/after cuts accelerating with the beat → hold with sparkles |
| Magnifier | a lens glides over the smile showing the after inside, then reveals all |
| Cinematic | letterbox, film grain, blinds flip reveal, taiko + boom |
| Polaroid Drop | Day 1 / Final day polaroids drop with shutter flashes |
| Luxury | serif titles, diagonal light-sweep reveal, glam look |

## Engine highlights
- Layouts: swipe, split, magnifier lens, blinds, diagonal, polaroid — all **AI-aligned** (MediaPipe face landmarks)
- Transitions: glitch (RGB split + slices), whip, punch, shake, flash, dissolve, fade, wipe, slide, push, zoom, circle, blur
- FX: beat pulse, camera shake, smile sparkles, chromatic aberration, bloom, grain, vignette, cinema bars, looks
- Text: 5 fonts, highlight / neon / outline styles, word-by-word, typewriter, pop… Stickers: loading bar, rating slider,
  countdown, confetti, emoji, "Book now" CTA, clinic tag
- **Sound**: music generated in the browser (5 styles, built around the drop) + automatic SFX on every cut and reveal
  (whoosh, riser, impact, glitch, shutter, ticks, sparkle). Royalty-free. Or import your own track — AI detects its
  tempo and re-times the whole edit to the beat.
- Pro timeline (⋯ → Pro timeline) for frame-precise multi-track editing of the same reel.

Photos never leave the device (IndexedDB). Get written patient consent before posting.

## Run locally
Static site, no build: `python3 -m http.server 8000` → http://localhost:8000/studio/
