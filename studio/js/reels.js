// Reels-style editor: full-screen preview, right tool rail, bottom sheets, drag text to trash.
import { h, icon, toast, busy, debounce, clamp, fmtTime, uid, pickFiles } from './util.js';
import { db, getSettings, saveProject, deleteProject, getMedia, addMedia } from './store.js';
import { Player } from './player.js';
import { LOOKS, FONTS, TEXT_STYLES, TEXT_ANIMS, ANIM_LABEL, TRANSITIONS, TR_LABEL, LAYOUTS, MOTIONS, MOTION_LABEL, ASPECTS, layoutTimeline } from './engine.js';
import { newText, newSticker, newClip, DEF_FILTER, scaleTimeline } from './project.js';
import { MUSIC } from './synth.js';
import { TEMPLATES, buildTemplate } from './templates.js';
import { decodeAudio, detectBeats, tryAnalyze } from './ai.js';
import { sheet, confirmSheet, railBtn, ibtn } from './sheet.js';
import { gallerySheet } from './gallery.js';
import { enhanceProject } from './browse.js';

const COLORS = ['#ffffff', '#000000', '#5eead4', '#14b8a6', '#3b82f6', '#a855f7', '#ec4899', '#f43f5e', '#f97316', '#facc15', '#22c55e', '#f5e6c8'];
const EMOJIS = ['😍', '🔥', '🤯', '😱', '✨', '🦷', '💎', '👑', '💯', '😁', '🙌', '❤️', '👀', '⭐', '🥹', '🎉'];

export async function renderEditor(main, id) {
  let p = await db.get('projects', id);
  if (!p) { location.hash = '#/drafts'; return; }
  const settings = await getSettings();
  const hist = [];
  main.innerHTML = '';

  const canvas = h('canvas.stage-canvas');
  const stage = h('div.stage', canvas);
  const playIc = h('div.play-ind', icon('play', 34));
  const trash = h('div.trash', icon('trash', 26));
  const musicChip = h('button.music-chip', { onclick: () => audioSheet() });
  const undoBtn = ibtn('undo', 'Undo', () => undo());
  const top = h('div.top-bar', ibtn('back', 'Drafts', () => (location.hash = '#/drafts')), musicChip, undoBtn);
  const rail = h('div.ed-rail',
    railBtn('Aa', 'Text', () => textEditor()),
    railBtn('sticker', 'Stickers', () => stickerSheet()),
    railBtn('music', 'Audio', () => audioSheet()),
    railBtn('sparkles', 'Effects', () => effectsSheet()),
    railBtn('film', 'Clips', () => clipsSheet()),
    railBtn('layers', 'Template', () => templateSheet()),
    railBtn('more', 'More', () => moreSheet()));
  const strip = h('div.scrub-strip'), head = h('div.scrub-head');
  const scrub = h('div.scrub', strip, head);
  const timeLbl = h('span.time-lbl');
  const bottom = h('div.ed-bottom', scrub, h('div.ed-bar', timeLbl, h('button.pill.white.next-pill', { onclick: () => { player.pause(); location.hash = '#/share/' + p.id; } }, 'Next', icon('next', 18))));
  main.append(h('div.screen.ed-screen', stage, playIc, top, rail, bottom, trash));

  const player = new Player(canvas, { scale: 0.5, loop: true, onTime: (t, d) => { timeLbl.textContent = `${fmtTime(t, false)} / ${fmtTime(d, false)}`; head.style.left = (d ? (t / d) * 100 : 0) + '%'; } });
  player.onState = on => playIc.classList.toggle('show', !on);
  player.fit(stage);

  // ---------- state & history ----------
  const save = debounce(() => saveProject(p).catch(e => toast('Save failed: ' + e.message, 'err')), 500);
  function commit(fn, { reload = true } = {}) {
    hist.push(JSON.stringify(p)); if (hist.length > 60) hist.shift();
    fn();
    changed(reload);
  }
  function undo() { if (!hist.length) return; p = JSON.parse(hist.pop()); changed(true); toast('Undone'); }
  function changed(reload = true) {
    layoutTimeline(p);
    if (reload) player.load(p).then(drawChrome); else player.draw();
    drawChrome(); save();
  }
  function drawChrome() {
    undoBtn.style.visibility = hist.length ? 'visible' : 'hidden';
    const m = MUSIC.find(x => x.id === (p.soundtrack?.style || 'none'));
    musicChip.replaceChildren(icon('music', 14), h('span', p.audio ? '♪ Your track' : m ? `${m.name}` : 'Add music'));
    const dur = layoutTimeline(p) || 1;
    strip.replaceChildren(...p.clips.map(c => {
      const mm = player.engine.media.get(c.mediaId);
      return h('div.scrub-seg', { style: { left: (c._start / dur) * 100 + '%', width: (c.duration / dur) * 100 + '%', backgroundImage: c.kind === 'solid' ? `linear-gradient(135deg, ${c.color}, ${c.color2 || p.accent})` : mm?.thumb ? `url(${mm.thumb})` : '' } });
    }));
  }
  const curClip = () => p.clips.find(c => player.t >= c._start && player.t < c._start + c.duration) || p.clips[p.clips.length - 1];
  const span = () => { const c = curClip(); return c ? { start: +c._start.toFixed(2), duration: +Math.max(2.5, c.duration).toFixed(2) } : { start: 0, duration: 3 }; };

  // ---------- scrubbing ----------
  scrub.addEventListener('pointerdown', e => {
    const r = scrub.getBoundingClientRect(), was = player.playing;
    player.pause();
    const mv = ev => player.seek(clamp((ev.clientX - r.left) / r.width, 0, 1) * player.dur);
    mv(e);
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (was) player.play(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });

  // ---------- tap to play, drag overlays, drop on trash ----------
  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect(), E = player.engine;
    const lx = ((e.clientX - r.left) / r.width) * E.W, ly = ((e.clientY - r.top) / r.height) * E.H;
    const hitId = Object.keys(E.hit).reverse().find(k => { const b = E.hit[k]; return lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h; });
    const o = hitId && p.overlays.find(x => x.id === hitId);
    if (!o) { const up = () => { removeEventListener('pointerup', up); player.engine.audio().resume(); player.toggle(); }; addEventListener('pointerup', up); return; }
    e.preventDefault();
    const was = player.playing; player.pause();
    const snap = JSON.stringify(p), x0 = o.x ?? 0.5, y0 = o.y ?? 0.5, cx = e.clientX, cy = e.clientY;
    let moved = false, overTrash = false;
    const mv = ev => {
      if (Math.hypot(ev.clientX - cx, ev.clientY - cy) > 6) { moved = true; trash.classList.add('show'); }
      if (!moved) return;
      o.x = clamp(x0 + (ev.clientX - cx) / r.width, 0.03, 0.97); if (Math.abs(o.x - 0.5) < 0.02) o.x = 0.5;
      o.y = clamp(y0 + (ev.clientY - cy) / r.height, 0.03, 0.97);
      const tr = trash.getBoundingClientRect();
      overTrash = Math.hypot(ev.clientX - (tr.left + tr.width / 2), ev.clientY - (tr.top + tr.height / 2)) < 60;
      trash.classList.toggle('hot', overTrash);
      player.draw();
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      trash.classList.remove('show', 'hot');
      if (!moved) { if (o.kind === 'text') textEditor(o); else stickerEdit(o); return; }
      hist.push(snap);
      if (overTrash) { p.overlays = p.overlays.filter(x => x !== o); toast('Deleted'); }
      changed(overTrash);
      if (was) player.play();
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });

  // ---------- text editor (full-screen, like a story text tool) ----------
  function textEditor(existing) {
    player.pause();
    const o = existing ? { ...existing } : newText('', 0, { size: 84, y: 0.3, font: 'modern', style: 'classic', anim: 'pop' });
    let whole = existing ? existing.duration >= player.dur - 0.1 : false;
    const input = h('textarea.txt-input', { rows: 2, placeholder: 'Type something…', value: o.text });
    input.value = o.text;
    const fontBtn = h('button.pill.ghost.sm'), styleBtn = h('button.circle-btn'), animBtn = h('button.pill.ghost.sm');
    const paint = () => {
      const F = FONTS[o.font] || FONTS.modern;
      fontBtn.textContent = F.label;
      animBtn.textContent = '✦ ' + ANIM_LABEL[o.anim];
      styleBtn.textContent = { classic: 'A', highlight: 'A', neon: 'A', outline: 'A' }[o.style];
      styleBtn.dataset.s = o.style;
      Object.assign(input.style, {
        fontFamily: F.f, fontWeight: F.w, textTransform: F.up ? 'uppercase' : 'none', color: o.color,
        background: o.style === 'highlight' ? o.bgColor : 'transparent',
        textShadow: o.style === 'neon' ? `0 0 18px ${o.color}, 0 0 4px #fff` : o.style === 'outline' ? '0 0 2px #000, 0 0 2px #000, 0 0 2px #000' : '0 2px 10px rgba(0,0,0,.6)',
      });
      [...dots.children].forEach(d => d.classList.toggle('on', d.dataset.c === (o.style === 'highlight' ? o.bgColor : o.color)));
      [...scope.children].forEach((b, i) => b.classList.toggle('on', (i === 1) === whole));
    };
    fontBtn.onclick = () => { const ks = Object.keys(FONTS); o.font = ks[(ks.indexOf(o.font) + 1) % ks.length]; paint(); };
    styleBtn.onclick = () => {
      o.style = TEXT_STYLES[(TEXT_STYLES.indexOf(o.style) + 1) % TEXT_STYLES.length];
      if (o.style === 'highlight') { o.bgColor = o.color === '#000000' ? '#ffffff' : o.color === '#ffffff' ? '#ffffff' : o.color; o.color = o.bgColor === '#ffffff' ? '#0b0b0b' : '#ffffff'; }
      else if (o.style === 'outline') o.bgColor = '#000000';
      else if (o.color === '#0b0b0b') o.color = '#ffffff';
      paint();
    };
    animBtn.onclick = () => { o.anim = TEXT_ANIMS[(TEXT_ANIMS.indexOf(o.anim) + 1) % TEXT_ANIMS.length]; paint(); };
    const dots = h('div.dots.big', ...COLORS.map(c => h('button.dot', { 'data-c': c, style: { background: c }, onclick: () => { if (o.style === 'highlight') { o.bgColor = c; o.color = ['#ffffff', '#facc15', '#5eead4', '#f5e6c8'].includes(c) ? '#0b0b0b' : '#ffffff'; } else o.color = c; paint(); } })));
    const scope = h('div.seg-pill', h('button', { onclick: () => { whole = false; paint(); } }, 'This clip'), h('button', { onclick: () => { whole = true; paint(); } }, 'Whole video'));
    const size = h('input.vslider', { type: 'range', min: 36, max: 200, value: o.size, oninput: e => { o.size = +e.target.value; input.style.fontSize = Math.round(o.size / 3.2) + 'px'; } });
    input.style.fontSize = Math.round(o.size / 3.2) + 'px';
    const done = () => {
      ov.remove();
      const txt = input.value.trim();
      if (!txt) { if (existing) commit(() => (p.overlays = p.overlays.filter(x => x.id !== existing.id))); return; }
      o.text = txt;
      if (!existing || whole !== (existing.duration >= player.dur - 0.1)) Object.assign(o, whole ? { start: 0, duration: +player.dur.toFixed(2) } : span());
      commit(() => { if (existing) Object.assign(p.overlays.find(x => x.id === existing.id), o); else p.overlays.push(o); });
    };
    const ov = h('div.txt-ed',
      h('div.txt-top', fontBtn, styleBtn, animBtn, h('div.sp'), h('button.pill.white.sm', { onclick: done }, 'Done')),
      h('div.txt-mid', size, input),
      h('div.txt-bot', dots, scope));
    main.querySelector('.ed-screen').append(ov);
    paint();
    setTimeout(() => input.focus(), 50);
  }

  function stickerEdit(o) {
    const editable = { loading: 'Label', rating: 'Question', cta: 'Button text', tag: 'Handle', countdown: 'Numbers (comma separated)', emoji: 'Emoji' }[o.kind];
    sheet('Edit sticker', close => [
      editable && h('label.field', h('span', editable), h('input', { value: o.text || '', oninput: e => (o._t = e.target.value) })),
      o.kind === 'emoji' && h('div.emoji-grid', ...EMOJIS.map(em => h('button', { onclick: () => { commit(() => (o.text = em)); close(); } }, em))),
      h('div.sheet-actions',
        h('button.pill.danger', { onclick: () => { commit(() => (p.overlays = p.overlays.filter(x => x !== o))); close(); } }, icon('trash', 16), 'Remove'),
        editable && h('button.pill.white', { onclick: () => { if (o._t != null) commit(() => { o.text = o._t; delete o._t; }); close(); } }, 'Save')),
    ]);
  }

  // ---------- stickers ----------
  function addSticker(kind, props = {}, dur) {
    const s = span();
    const o = newSticker(kind, s.start, { duration: dur ?? s.duration, ...props });
    commit(() => p.overlays.push(o));
    toast('Added — drag it anywhere, drop on 🗑 to remove');
  }
  function stickerSheet() {
    player.pause();
    const tile = (emoji, label, fn) => h('button.tile', { onclick: fn }, h('span.tile-ic', emoji), h('span', label));
    sheet('Stickers', close => [
      h('div.tiles',
        tile('⏳', 'Loading bar', () => { close(); addSticker('loading', { text: 'Loading new smile…', y: 0.74 }); }),
        tile('⭐', 'Rate 1–10', () => { close(); addSticker('rating', { text: 'Rate this smile 1–10', y: 0.75 }); }),
        tile('3·2·1', 'Countdown', () => { close(); addSticker('countdown', { text: '3,2,1', y: 0.5 }); }),
        tile('🎉', 'Confetti', () => { close(); addSticker('confetti', {}, 4); }),
        tile('📅', 'Book now', () => { close(); addSticker('cta', { text: 'Book your consultation', sub: settings.phone || settings.website || '', y: 0.8 }); }),
        tile('@', 'Clinic tag', () => { close(); addSticker('tag', { text: settings.handle || '@yourclinic', y: 0.88 }); }),
        tile('✨', 'Smile sparkle', () => { close(); const c = curClip(); if (c) commit(() => { c.fx = { ...(c.fx || {}), sparkle: !c.fx?.sparkle }; }); toast(c?.fx?.sparkle ? 'Sparkles on this clip ✨' : 'Sparkles removed'); }),
        tile('💬', 'Hook text', () => { close(); commit(() => p.overlays.push(newText('POV: you finally fixed\nyour smile', span().start, { ...span(), style: 'highlight', bgColor: '#ffffff', color: '#0b0b0b', size: 60, y: 0.16, anim: 'words' }))); })),
      h('div.sheet-sub', 'Emoji'),
      h('div.emoji-grid', ...EMOJIS.map(em => h('button', { onclick: () => { close(); addSticker('emoji', { text: em, size: 160, x: 0.75, y: 0.3 }); } }, em))),
    ], { tall: true });
  }

  // ---------- audio ----------
  function audioSheet() {
    sheet('Audio', (close, body) => {
      const list = h('div.music-list');
      const draw = () => list.replaceChildren(...MUSIC.map(m => h('button.music-row' + (!p.audio && p.soundtrack.style === m.id ? '.on' : ''), {
        onclick: () => { commit(() => { p.soundtrack.style = m.id; p.audio = null; }); draw(); player.seek(Math.max(0, (p.drop ?? 0) - 2)); player.play(); },
      }, h('span.music-ic', m.emoji), h('span.music-txt', h('b', m.name), h('span', m.desc)), !p.audio && p.soundtrack.style === m.id && icon('check', 18))),
      h('button.music-row' + (p.audio ? '.on' : ''), { onclick: importTrack }, h('span.music-ic', '🎵'), h('span.music-txt', h('b', p.audio ? 'Your track ✓' : 'Use your own track'), h('span', 'MP3 / M4A — AI re-times every cut to its beat')), icon('upload', 18)));
      draw();
      const vol = (label, get, set) => h('label.slider-row', h('span', label), h('input', { type: 'range', min: 0, max: 1.5, step: 0.05, value: get(), oninput: e => { set(+e.target.value); player.engine.sync(player.t, player.playing); save(); } }));
      async function importTrack() {
        const [f] = await pickFiles('audio/*', false);
        if (!f) return;
        const b = busy('AI is finding the beat…');
        try {
          const m = await addMedia(f);
          const buf = await decodeAudio(m.blob, m.id);
          let { bpm, beats } = detectBeats(buf);
          while (bpm / p.bpm > 1.4) bpm /= 2;
          while (p.bpm / bpm > 1.4) bpm *= 2;
          commit(() => {
            scaleTimeline(p, p.bpm / bpm);
            p.bpm = Math.round(bpm); p.beatOffset = 0;
            p.audio = { mediaId: m.id, volume: 0.9, offset: 0, in: beats[0] || 0, fadeIn: 0.1, fadeOut: 1.5 };
          });
          toast(`Synced to ${Math.round(bpm)} BPM 🎵`);
          draw();
        } catch (e) { toast('Could not read this audio: ' + e.message, 'err'); }
        b.done();
      }
      return [list,
        vol('Music', () => (p.audio ? p.audio.volume : p.soundtrack.volume) ?? 0.85, v => (p.audio ? (p.audio.volume = v) : (p.soundtrack.volume = v))),
        vol('Sound FX', () => p.soundtrack.sfxVolume ?? 0.9, v => (p.soundtrack.sfxVolume = v)),
        h('label.switch-row', h('span', 'Auto sound effects (whoosh, impact, ticks…)'), h('input', { type: 'checkbox', checked: p.soundtrack.sfx !== false, onchange: e => commit(() => (p.soundtrack.sfx = e.target.checked)) })),
        h('p.sheet-text.sm', 'Built-in tracks are generated on your device — royalty-free, safe to post anywhere.')];
    }, { tall: true });
  }

  // ---------- effects ----------
  function effectsSheet() {
    const media = () => p.clips.filter(c => c.kind !== 'solid');
    const has = k => media().some(c => c.fx?.[k]);
    const setAll = (k, v, only = () => true) => commit(() => media().filter(only).forEach(c => { c.fx = { ...(c.fx || {}) }; if (v) c.fx[k] = true; else delete c.fx[k]; }));
    const isEnh = () => p.clips.some(c => c.filter && Math.abs((c.filter.brightness ?? 1) - 1) > 0.01);
    sheet('Effects', () => {
      const looks = h('div.look-row', ...Object.entries(LOOKS).map(([k, l]) => h('button.look' + ((p.look || 'natural') === k ? '.on' : ''), {
        'data-k': k, onclick: e => { commit(() => (p.look = k)); [...looks.children].forEach(x => x.classList.toggle('on', x === e.currentTarget)); },
      }, h('span.look-sw.' + k), h('span', l.label))));
      const sw = (label, sub, on, fn) => h('label.switch-row', h('span', h('b', label), sub && h('small', sub)), h('input', { type: 'checkbox', checked: on, onchange: e => fn(e.target.checked) }));
      const cmp = p.clips.filter(c => c.layout && c.layout !== 'single');
      return [
        h('div.sheet-sub', 'Look'), looks,
        h('div.sheet-sub', 'AI'),
        sw('AI colour correction', 'Fixes exposure & white balance on every photo', isEnh(), async v => {
          const b = busy('AI colour correction…');
          hist.push(JSON.stringify(p));
          if (v) await enhanceProject(p); else p.clips.forEach(c => { c.filter = DEF_FILTER(); delete c.filter2; });
          b.done(); changed(true);
        }),
        sw('AI smile alignment', 'Lines up both smiles in compare shots', cmp.every(c => c.align !== false), v => commit(() => cmp.forEach(c => (c.align = v)))),
        h('div.sheet-sub', 'Motion & finish'),
        sw('Beat pulse', 'Zoom punch on every beat', has('pulse'), v => setAll('pulse', v)),
        sw('Smile sparkles', 'Twinkles on the new smile', has('sparkle'), v => setAll('sparkle', v, c => c.mediaId === p.inputs?.after || c.layout !== 'single')),
        sw('Film grain', null, has('grain'), v => setAll('grain', v)),
        sw('Cinema bars', null, has('letterbox'), v => setAll('letterbox', v)),
        sw('Before / After labels', null, cmp.every(c => c.labels !== false), v => commit(() => cmp.forEach(c => (c.labels = v)))),
        sw('Clinic watermark', settings.logoMediaId ? 'Your logo' : settings.handle || 'Set it in Settings', !!p.watermark?.on, v => commit(() => { p.watermark = { ...p.watermark, on: v, logoMediaId: settings.logoMediaId, text: settings.handle }; })),
      ];
    }, { tall: true });
  }

  // ---------- clips ----------
  function clipsSheet() {
    player.pause();
    let sel = p.clips.indexOf(curClip());
    sheet('Clips', (close, body) => {
      const stripEl = h('div.clip-strip'), panel = h('div.clip-panel');
      const draw = () => {
        stripEl.replaceChildren(...p.clips.map((c, i) => {
          const m = player.engine.media.get(c.mediaId);
          return h('button.clip-card' + (i === sel ? '.on' : ''), { onclick: () => { sel = i; player.seek(c._start + 0.05); draw(); },
            style: { backgroundImage: c.kind === 'solid' ? `linear-gradient(135deg, ${c.color}, ${c.color2 || p.accent})` : m?.thumb ? `url(${m.thumb})` : '' } },
          h('span', c.duration.toFixed(1) + 's'), c.layout && c.layout !== 'single' && h('i', LAYOUTS.find(l => l[0] === c.layout)?.[1]));
        }), h('button.clip-card.add', { onclick: addClip }, icon('plus', 22)));
        const c = p.clips[sel];
        if (!c) return panel.replaceChildren();
        const m = player.engine.media.get(c.mediaId);
        const chips = (opts, val, fn) => h('div.chips.scroll', ...opts.map(([k, l]) => h('button.chip' + (k === val ? '.on' : ''), { onclick: () => { fn(k); draw(); } }, l)));
        panel.replaceChildren(...[
          h('label.slider-row', h('span', 'Duration'), h('input', { type: 'range', min: 0.3, max: m?.kind === 'video' ? Math.max(0.5, m.duration - (c.in || 0)) : 15, step: 0.05, value: c.duration, onchange: e => { commit(() => (c.duration = +e.target.value)); draw(); } }), h('b.slider-val', c.duration.toFixed(1) + 's')),
          c.kind !== 'solid' && m?.kind === 'image' && [h('div.sheet-sub', 'Layout'), chips(LAYOUTS, c.layout || 'single', k => commit(() => { c.layout = k; if (k !== 'single' && !c.mediaId2) c.mediaId2 = p.inputs?.after || c.mediaId; }))],
          c.kind !== 'solid' && [h('div.sheet-sub', 'Motion'), chips(MOTIONS.map(k => [k, MOTION_LABEL[k]]), c.motion || 'none', k => commit(() => (c.motion = k)))],
          sel < p.clips.length - 1 && [h('div.sheet-sub', 'Transition to next'), chips(TRANSITIONS.map(k => [k, TR_LABEL[k]]), c.transition?.type || 'none', k => commit(() => (c.transition = { type: k, dur: k === 'none' ? 0 : Math.max(0.25, c.transition?.dur || 0.4) })))],
          h('div.clip-actions',
            c.kind !== 'solid' && h('button.pill.ghost.sm', { onclick: async () => { const x = await gallerySheet({ single: true }); if (x) { if (x.kind === 'image') await tryAnalyze(x); commit(() => { c.mediaId = x.id; c.in = 0; }); draw(); } } }, icon('image', 16), 'Replace'),
            h('button.pill.ghost.sm', { disabled: sel === 0, onclick: () => { commit(() => p.clips.splice(sel - 1, 0, p.clips.splice(sel, 1)[0])); sel--; draw(); } }, '◀'),
            h('button.pill.ghost.sm', { disabled: sel === p.clips.length - 1, onclick: () => { commit(() => p.clips.splice(sel + 1, 0, p.clips.splice(sel, 1)[0])); sel++; draw(); } }, '▶'),
            h('button.pill.ghost.sm', { onclick: () => { commit(() => p.clips.splice(sel + 1, 0, { ...JSON.parse(JSON.stringify(c)), id: uid() })); draw(); } }, icon('copy', 16)),
            h('button.pill.danger.sm', { disabled: p.clips.length < 2, onclick: () => { commit(() => p.clips.splice(sel, 1)); sel = Math.min(sel, p.clips.length - 1); draw(); } }, icon('trash', 16)))].flat().filter(Boolean));
      };
      async function addClip() {
        const x = await gallerySheet({ single: true });
        if (!x) return;
        if (x.kind === 'image') await tryAnalyze(x);
        const at = p.clips[p.clips.length - 1]?.kind === 'solid' ? p.clips.length - 1 : p.clips.length;
        commit(() => p.clips.splice(at, 0, newClip(x, { duration: x.kind === 'video' ? Math.min(6, x.duration) : 2, motion: 'zoomIn', transition: { type: 'flash', dur: 0.3 } })));
        sel = at; draw();
      }
      draw();
      return [stripEl, panel];
    }, { tall: true });
  }

  // ---------- template switch ----------
  function templateSheet() {
    sheet('Templates', close => [
      h('p.sheet-text', 'Switch style — your photos stay, texts & timing are rebuilt.'),
      h('div.tpl-list', ...TEMPLATES.map(t => h('button.tpl-card' + (p.template === t.id ? '.on' : ''), {
        onclick: async () => {
          if (!p.inputs) return toast('This project was not made from a template');
          close();
          const b = busy('Rebuilding…');
          const before = await getMedia(p.inputs.before), after = await getMedia(p.inputs.after);
          const extras = (await Promise.all((p.inputs.extras || []).map(getMedia))).filter(Boolean);
          if (!before || !after) { b.done(); return toast('Original photos were deleted', 'err'); }
          const np = buildTemplate(t.id, { before, after, extras, settings, treatment: p.inputs.treatment });
          await enhanceProject(np);
          commit(() => {
            const keep = { id: p.id, createdAt: p.createdAt, watermark: p.watermark, aspect: p.aspect };
            p = Object.assign(np, keep);
          });
          b.done(); player.seek(0); player.play();
        },
      }, h('b', t.name), h('span.tpl-tag', t.tag), h('span.muted', t.desc)))),
    ], { tall: true });
  }

  // ---------- more ----------
  function moreSheet() {
    sheet('More', close => [
      h('label.field', h('span', 'Name'), h('input', { value: p.name, oninput: e => { p.name = e.target.value; save(); } })),
      h('div.sheet-sub', 'Format'),
      h('div.chips', ...Object.keys(ASPECTS).map(a => h('button.chip' + (p.aspect === a ? '.on' : ''), { onclick: () => { commit(() => (p.aspect = a)); close(); setTimeout(() => player.refit(), 50); } }, { '9:16': '9:16 Reel', '4:5': '4:5 Feed', '1:1': '1:1 Square', '16:9': '16:9 YouTube' }[a]))),
      h('div.menu',
        h('button.menu-row', { onclick: () => { close(); player.pause(); location.hash = '#/pro/' + p.id; } }, icon('layers', 20), h('span', h('b', 'Pro timeline'), h('small', 'Frame-precise multi-track editing'))),
        h('button.menu-row', { onclick: async () => { const c = { ...JSON.parse(JSON.stringify(p)), id: uid(), name: p.name + ' (copy)' }; await saveProject(c); close(); location.hash = '#/edit/' + c.id; } }, icon('copy', 20), h('span', h('b', 'Duplicate'))),
        h('button.menu-row.danger', { onclick: async () => { if (await confirmSheet('Delete this reel?', 'This cannot be undone.', 'Delete', true)) { await deleteProject(p.id); close(); location.hash = '#/drafts'; } } }, icon('trash', 20), h('span', h('b', 'Delete reel')))),
    ]);
  }

  // ---------- go ----------
  layoutTimeline(p);
  await player.load(p);
  drawChrome();
  player.play();
  return () => { save(); player.destroy(); };
}
