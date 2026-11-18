// Video Studio: multi-track timeline editor (video, text, music), live preview, inspector.
import { h, icon, $, clamp, fmtTime, debounce, toast, modal, busy, pickFiles, downloadBlob, uid } from './util.js';
import { Engine, ASPECTS, TRANSITIONS, MOTIONS, TEXT_ANIMS, layoutTimeline } from './engine.js';
import { allMedia, getMedia, addMedia, imageEl, saveProject, allProjects, deleteProject, db, getSettings } from './store.js';
import { newProject, newClip, newText, TEXT_PRESETS, TEMPLATES, buildTemplate, beatSync, DEF_FILTER } from './project.js';
import { tryAnalyze, autoEnhanceParams, decodeAudio, detectBeats, waveformPeaks, captionIdeas } from './ai.js';
import { exportProject, exportFrame, pickMime, QUALITIES } from './exporter.js';
import { range, num, select, color, toggle, text, seg, section, mediaThumb, pickMedia, emptyState } from './ui.js';

const TR_LABEL = { none: 'Cut', dissolve: 'Dissolve', fade: 'Fade black', flash: 'Flash', wipe: 'Wipe', slide: 'Slide', push: 'Push up', zoom: 'Zoom', circle: 'Circle', blur: 'Blur' };
const MOTION_LABEL = { none: 'Static', zoomIn: 'Slow zoom in', zoomOut: 'Slow zoom out', smileZoom: 'AI smile zoom', panLeft: 'Pan left', panRight: 'Pan right' };

let current = null; // active editor instance (to clean up on navigation)
export function leaveStudio() { current?.destroy(); current = null; }

// ================= project list =================
export async function renderStudio(main, params = {}) {
  leaveStudio();
  if (params.project) {
    const p = await db.get('projects', params.project);
    if (p) return openEditor(main, p);
  }
  const projects = await allProjects();
  main.innerHTML = '';
  main.append(
    h('div.top', h('div', h('h1', 'Video Studio'), h('p.muted', 'Edit before/after reels with a multi-track timeline, transitions, text, music and AI tools.')),
      h('div.actions',
        h('button.btn', { onclick: async () => { const p = newProject(await getSettings()); await saveProject(p); location.hash = '#/studio/' + p.id; } }, icon('plus'), 'Blank project'),
        h('button.btn.primary', { onclick: () => magicReel() }, icon('sparkles'), 'Magic Reel (AI)'))),
    projects.length
      ? h('div.grid.cards', ...projects.map(p => h('div.card.proj', { onclick: () => (location.hash = '#/studio/' + p.id) },
          h('div.proj-ar', { style: { aspectRatio: p.aspect.replace(':', '/') } }, icon('film', 30)),
          h('div.proj-b', h('b', p.name), h('span.muted', `${p.aspect} · ${p.clips.length} clips · ${fmtTime(layoutTimeline(p), false)}`),
            h('span.muted.sm', new Date(p.updatedAt).toLocaleString())),
          h('button.icon-btn.del', { title: 'Delete', onclick: async e => { e.stopPropagation(); if (confirm(`Delete "${p.name}"?`)) { await deleteProject(p.id); renderStudio(main); } } }, icon('trash')))))
      : emptyState('film', 'No video projects yet', 'Let the AI build a reel from a before/after pair, or start from a blank timeline.',
          h('button.btn.primary', { onclick: () => magicReel() }, icon('sparkles'), 'Magic Reel (AI)')));
}

// ================= Magic Reel wizard =================
export async function magicReel(pre = {}) {
  const settings = await getSettings();
  const st = { before: pre.before || null, after: pre.after || null, extras: [], tpl: 'reveal', treatment: pre.treatment || '', music: null, enhance: true, sync: true };
  const audios = (await allMedia()).filter(m => m.kind === 'audio');
  const res = await modal('Magic Reel — AI auto-edit', close => {
    const slot = (key, label) => {
      const box = h('button.slot', { type: 'button' });
      const draw = () => { box.innerHTML = ''; box.append(st[key] ? h('img', { src: st[key].thumb }) : icon('plus', 26), h('span', label)); };
      box.onclick = async () => { const m = await pickMedia({ kinds: ['image'], title: `Choose the ${label.toLowerCase()} photo`, caseId: pre.caseId }); if (m) { st[key] = m; draw(); } };
      draw();
      return box;
    };
    const extrasLbl = h('span.muted');
    const tpls = h('div.tpls', ...TEMPLATES.map(t => {
      const c = h('button.tpl' + (t.id === st.tpl ? '.on' : ''), { type: 'button', onclick: () => { st.tpl = t.id; [...tpls.children].forEach(x => x.classList.toggle('on', x === c)); } },
        h('div.tpl-ar', { style: { aspectRatio: t.aspect.replace(':', '/') } }), h('b', t.name), h('span', t.desc), h('span.muted.sm', `${t.aspect} · ${t.len}`));
      return c;
    }));
    return [
      h('div.slots', slot('before', 'Before'), h('div.slot-arrow', '→'), slot('after', 'After')),
      h('div.row-btns', h('button.btn.sm', { type: 'button', onclick: async () => { const l = await pickMedia({ kinds: ['image', 'video'], multi: true, title: 'Extra shots (optional)', caseId: pre.caseId }); if (l) { st.extras = l; extrasLbl.textContent = `${l.length} extra shot(s)`; } } }, icon('plus'), 'Extra shots'), extrasLbl),
      h('h4', 'Template'), tpls,
      text('Treatment', st.treatment, v => (st.treatment = v), { placeholder: 'e.g. Veneers, Invisalign, Whitening' }),
      select('Music', '', [['', audios.length ? 'No music' : 'No music (import audio in the studio)'], ...audios.map(a => [a.id, a.name])], v => (st.music = v || null)),
      toggle('AI auto-enhance colours', st.enhance, v => (st.enhance = v)),
      toggle('AI beat-sync cuts to the music', st.sync, v => (st.sync = v)),
      h('div.modal-foot', h('button.btn.primary', { onclick: () => {
        if (!st.before || !st.after) return toast('Choose a before and an after photo', 'err');
        close(st);
      } }, icon('sparkles'), 'Create my reel')),
    ];
  }, { wide: true });
  if (!res) return;
  const b = busy('AI is finding the smile in your photos…');
  try {
    await tryAnalyze(res.before); await tryAnalyze(res.after);
    for (const m of res.extras) if (m.kind === 'image') await tryAnalyze(m);
    b.set('Building the edit…');
    const p = buildTemplate(res.tpl, { before: res.before, after: res.after, extras: res.extras, treatment: res.treatment, settings, musicId: res.music });
    if (res.enhance) {
      for (const c of p.clips) {
        const m = c.mediaId && await getMedia(c.mediaId);
        if (m?.kind === 'image') c.filter = autoEnhanceParams(await imageEl(m));
        const m2 = c.mediaId2 && await getMedia(c.mediaId2);
        if (m2?.kind === 'image') c.filter2 = autoEnhanceParams(await imageEl(m2));
      }
    }
    if (res.music && res.sync) {
      b.set('Listening to the music for beats…');
      const am = await getMedia(res.music);
      const buf = await decodeAudio(am.blob, am.id);
      const { beats, period } = detectBeats(buf);
      // keep texts glued to their clips while durations change
      const before = layoutTimeline(p), starts = p.clips.map(c => c._start);
      const owners = p.overlays.map(o => { const i = p.clips.findLastIndex(c => c._start <= o.start + 1e-3); return [i, o.start - starts[i]]; });
      beatSync(p, beats, period * (period < 0.45 ? 2 : 1));
      layoutTimeline(p);
      p.overlays.forEach((o, k) => { const [i, off] = owners[k]; if (i >= 0) o.start = +(p.clips[i]._start + off).toFixed(2); o.duration = Math.min(o.duration, p.clips[i].duration - off + 0.01); });
      void before;
    }
    await saveProject(p);
    location.hash = '#/studio/' + p.id;
    toast('Your reel is ready — tweak anything on the timeline ✨', 'ok');
  } catch (e) { console.error(e); toast('Could not build the reel: ' + e.message, 'err'); }
  finally { b.done(); }
}

// ================= editor =================
async function openEditor(main, project) {
  const settings = await getSettings();
  const S = { p: project, sel: null, t: 0, playing: false, pps: 70, hist: [], fut: [], loop: false, lastKey: '', lastAt: 0 };
  main.innerHTML = '';
  main.classList.add('studio-main');

  // ---------- layout ----------
  const canvas = h('canvas.preview');
  const stage = h('div.stage', h('div.stage-inner', canvas));
  const timeLbl = h('span.time', '0:00.0 / 0:00.0');
  const playBtn = h('button.icon-btn.play', { title: 'Play / pause (Space)', onclick: () => togglePlay() }, icon('play', 20));
  const transport = h('div.transport',
    h('button.icon-btn', { title: 'Go to start', onclick: () => seek(0) }, icon('back')),
    playBtn, timeLbl,
    h('label.chk', h('input', { type: 'checkbox', onchange: e => (S.loop = e.target.checked) }), 'Loop'));
  const bin = h('aside.bin');
  const insp = h('aside.insp');
  const tl = h('div.tl');
  const nameIn = h('input.pname', { value: project.name, oninput: () => { S.p.name = nameIn.value; save(); } });
  const undoBtn = h('button.icon-btn', { title: 'Undo (Ctrl+Z)', onclick: () => undo() }, icon('undo'));
  const redoBtn = h('button.icon-btn', { title: 'Redo (Ctrl+Shift+Z)', onclick: () => redo() }, icon('redo'));
  const bar = h('div.sbar',
    h('button.icon-btn', { title: 'All projects', onclick: () => (location.hash = '#/studio') }, icon('back')),
    nameIn, undoBtn, redoBtn,
    h('div.sp'),
    h('button.btn.sm', { onclick: () => captionModal() }, icon('text'), h('span.hide-s', 'Captions')),
    h('button.btn.sm', { onclick: () => snapshot() }, icon('image'), h('span.hide-s', 'Frame')),
    h('button.btn.sm.primary', { onclick: () => exportModal() }, icon('download'), 'Export'));
  const editor = h('div.editor', bar, h('div.ed-mid', bin, h('div.center', stage, transport), insp), tl);
  main.append(editor);

  const engine = new Engine(canvas, { scale: 0.5, onFrameReady: () => !S.playing && draw() });

  // ---------- history ----------
  const snap = () => JSON.stringify(S.p);
  function edit(fn, { key = '', structural = true } = {}) {
    const now = Date.now();
    if (!(key && key === S.lastKey && now - S.lastAt < 900)) { S.hist.push(snap()); if (S.hist.length > 80) S.hist.shift(); S.fut = []; }
    S.lastKey = key; S.lastAt = now;
    fn();
    changed(structural);
  }
  function undo() { if (!S.hist.length) return; S.fut.push(snap()); S.p = JSON.parse(S.hist.pop()); S.lastKey = ''; changed(true, true); }
  function redo() { if (!S.fut.length) return; S.hist.push(snap()); S.p = JSON.parse(S.fut.pop()); S.lastKey = ''; changed(true, true); }

  const save = debounce(() => saveProject(S.p).catch(e => toast('Save failed: ' + e.message, 'err')), 600);
  let prepping = Promise.resolve();
  async function changed(structural, rebuildInsp = false) {
    S.dur = layoutTimeline(S.p);
    if (S.sel && !findSel()) { S.sel = null; rebuildInsp = true; }
    if (structural) { prepping = engine.prepare(S.p); await prepping; }
    else { engine.p = S.p; engine.duration = S.dur; }
    S.t = clamp(S.t, 0, S.dur);
    if (!S.playing) { engine.sync(S.t, false); draw(); }
    drawTimeline();
    if (rebuildInsp) drawInspector();
    undoBtn.disabled = !S.hist.length; redoBtn.disabled = !S.fut.length;
    save();
  }
  const findSel = () => {
    if (!S.sel) return null;
    if (S.sel.type === 'clip') return S.p.clips.find(c => c.id === S.sel.id);
    if (S.sel.type === 'text') return S.p.overlays.find(o => o.id === S.sel.id);
    if (S.sel.type === 'audio') return S.p.audio;
    return null;
  };
  function select_(sel) { S.sel = sel; drawTimeline(); drawInspector(); }

  // ---------- playback ----------
  function draw() { engine.render(S.t); timeLbl.textContent = `${fmtTime(S.t)} / ${fmtTime(S.dur)}`; movePlayhead(); }
  let raf = 0, t0 = 0;
  async function play() {
    if (!S.p.clips.length) return;
    await prepping;
    engine.audio().resume();
    if (S.t >= S.dur - 0.05) S.t = 0;
    S.playing = true; playBtn.replaceChildren(icon('pause', 20));
    t0 = performance.now() - S.t * 1000;
    const loop = () => {
      if (!S.playing) return;
      S.t = (performance.now() - t0) / 1000;
      if (S.t >= S.dur) {
        if (S.loop) { S.t = 0; t0 = performance.now(); engine.stopAll(); }
        else { S.t = S.dur; pause(); draw(); return; }
      }
      engine.sync(S.t, true); draw(); followPlayhead();
      raf = requestAnimationFrame(loop);
    };
    loop();
  }
  function pause() { S.playing = false; cancelAnimationFrame(raf); engine.stopAll(); engine.sync(S.t, false); playBtn.replaceChildren(icon('play', 20)); }
  const togglePlay = () => (S.playing ? pause() : play());
  function seek(t) { S.t = clamp(t, 0, S.dur || 0); if (S.playing) { t0 = performance.now() - S.t * 1000; engine.stopAll(); } engine.sync(S.t, S.playing); draw(); }

  // ---------- media bin ----------
  let binTab = 'image';
  async function drawBin() {
    const list = (await allMedia()).filter(m => binTab === 'all' || m.kind === binTab);
    bin.innerHTML = '';
    const tabs = h('div.tabs', ...[['image', 'Photos'], ['video', 'Videos'], ['audio', 'Music']].map(([k, l]) =>
      h('button' + (binTab === k ? '.on' : ''), { onclick: () => { binTab = k; drawBin(); } }, l)));
    const grid = h('div.bin-grid');
    list.forEach(m => {
      const t = mediaThumb(m, { draggable: true, title: (m.kind === 'audio' ? 'Click to use as music' : 'Click to add · drag onto the timeline') + '\n' + m.name });
      t.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-media', m.id); e.dataTransfer.effectAllowed = 'copy'; });
      t.onclick = () => addFromBin(m);
      grid.append(t);
    });
    if (!list.length) grid.append(h('p.muted.sm', binTab === 'audio' ? 'Import an MP3 / M4A track for your reel.' : 'Import files or capture photos in a case.'));
    bin.append(tabs, h('button.btn.sm.wide', { onclick: importFiles }, icon('upload'), 'Import'), grid);
  }
  async function importFiles() {
    const files = await pickFiles(binTab === 'audio' ? 'audio/*' : binTab === 'video' ? 'video/*' : 'image/*,video/*,audio/*');
    if (!files.length) return;
    const b = busy('Importing…');
    try { for (const f of files) await addMedia(f); } catch (e) { toast('Import failed: ' + e.message, 'err'); }
    b.done(); drawBin();
  }
  function addFromBin(m, index) {
    if (m.kind === 'audio') return setMusic(m);
    edit(() => {
      const c = newClip(m);
      const i = index ?? S.p.clips.length;
      S.p.clips.splice(i, 0, c);
      S.sel = { type: 'clip', id: c.id };
    });
    if (m.kind === 'image') tryAnalyze(m).then(() => changed(true));
    drawInspector();
  }
  function setMusic(m) {
    edit(() => { S.p.audio = { mediaId: m.id, volume: 0.8, offset: 0, in: 0, fadeIn: 0.3, fadeOut: 1.5 }; S.sel = { type: 'audio' }; });
    drawInspector();
    toast('Music added — try "AI beat sync" in the inspector 🎵');
  }

  // ---------- timeline ----------
  const tlTools = h('div.tl-tools');
  const labels = h('div.tl-labels');
  const scroll = h('div.tl-scroll');
  const inner = h('div.tl-inner');
  const ruler = h('div.ruler');
  const vTrack = h('div.track.vtrack');
  const tTrack = h('div.track.ttrack');
  const aTrack = h('div.track.atrack');
  const playhead = h('div.playhead', h('div.ph-knob'));
  inner.append(ruler, vTrack, tTrack, aTrack, playhead);
  scroll.append(inner);
  tl.append(tlTools, h('div.tl-body', labels, scroll));

  tlTools.append(
    h('button.btn.sm', { title: 'Split at playhead (S)', onclick: () => split() }, icon('scissors'), h('span.hide-s', 'Split')),
    h('button.btn.sm', { title: 'Duplicate (Ctrl+D)', onclick: () => duplicate() }, icon('copy')),
    h('button.btn.sm', { title: 'Delete (Del)', onclick: () => remove() }, icon('trash')),
    h('span.divider'),
    h('button.btn.sm', { onclick: () => addTitleCard() }, icon('layers'), h('span.hide-s', 'Title card')),
    h('button.btn.sm', { onclick: () => addText() }, icon('text'), h('span.hide-s', 'Text')),
    h('button.btn.sm', { onclick: async () => { const m = await pickMedia({ kinds: ['audio'], title: 'Choose music' }); if (m) setMusic(m); else { binTab = 'audio'; drawBin(); } } }, icon('music'), h('span.hide-s', 'Music')),
    h('div.sp'),
    h('span.muted.sm.hide-s', 'Zoom'),
    h('input.zoom', { type: 'range', min: 15, max: 300, value: S.pps, oninput: e => { S.pps = +e.target.value; drawTimeline(); } }));

  scroll.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    S.pps = clamp(S.pps * (e.deltaY < 0 ? 1.12 : 0.89), 15, 300);
    $('.zoom', tlTools).value = S.pps; drawTimeline();
  }, { passive: false });

  const X = t => t * S.pps;
  function drawTimeline() {
    const p = S.p, dur = S.dur || 0;
    inner.style.width = Math.max(scroll.clientWidth, X(dur) + 240) + 'px';
    // ruler
    ruler.innerHTML = '';
    const step = S.pps > 120 ? 0.5 : S.pps > 50 ? 1 : S.pps > 25 ? 2 : 5;
    for (let t = 0; t <= dur + 3; t += step) ruler.append(h('span.tick' + (t % (step * 2) ? '.minor' : ''), { style: { left: X(t) + 'px' } }, t % (step * 2) ? '' : fmtTime(t, false)));
    // video clips
    vTrack.innerHTML = '';
    p.clips.forEach((c, i) => {
      const sel = S.sel?.type === 'clip' && S.sel.id === c.id;
      const m = engine.media.get(c.mediaId), m2 = engine.media.get(c.mediaId2);
      const el = h('div.clip' + (sel ? '.sel' : '') + (c.kind === 'solid' ? '.solid' : ''), {
        style: { left: X(c._start) + 'px', width: Math.max(8, X(c.duration)) + 'px', zIndex: sel ? 5 : 1,
          backgroundImage: c.kind === 'solid' ? `linear-gradient(135deg, ${c.color}, ${c.gradient ? c.color2 || p.accent : c.color})` : m?.thumb ? `url(${m.thumb})` + (m2?.thumb ? `, url(${m2.thumb})` : '') : '' },
      },
      h('div.clip-lbl', c.kind === 'solid' ? 'Title card' : c.layout === 'wipe' ? '⇆ Before/After swipe' : c.layout === 'split' ? '◫ Split compare' : (m?.kind === 'video' ? '▶ ' : '') + (m?.name || 'Clip')),
      h('div.clip-dur', fmtTime(c.duration)),
      h('div.hdl.l'), h('div.hdl.r'));
      el.addEventListener('pointerdown', e => clipDrag(e, c, i, el));
      vTrack.append(el);
      if (i < p.clips.length - 1) {
        const tr = c.transition?.type || 'none';
        vTrack.append(h('button.trn' + (tr === 'none' ? '.cut' : ''), {
          style: { left: X(c._start + c.duration - c._tr / 2) + 'px' }, title: 'Transition: ' + TR_LABEL[tr],
          onclick: e => { e.stopPropagation(); select_({ type: 'clip', id: c.id }); setTimeout(() => $('.sec-trans', insp)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 30); },
        }, tr === 'none' ? '|' : '◆'));
      }
    });
    if (!p.clips.length) vTrack.append(h('div.track-hint', 'Drop photos or videos here — or click them in the media bin'));
    // text overlays in lanes
    tTrack.innerHTML = '';
    const lanes = [];
    [...p.overlays].sort((a, b) => a.start - b.start).forEach(o => {
      let li = lanes.findIndex(end => end <= o.start + 1e-3);
      if (li < 0) { li = lanes.length; lanes.push(0); }
      lanes[li] = o.start + o.duration;
      const sel = S.sel?.type === 'text' && S.sel.id === o.id;
      const el = h('div.ov' + (sel ? '.sel' : ''), { style: { left: X(o.start) + 'px', width: Math.max(10, X(o.duration)) + 'px', top: 4 + li * 26 + 'px' } },
        h('span', o.text.replace(/\n/g, ' ') || 'Text'), h('div.hdl.l'), h('div.hdl.r'));
      el.addEventListener('pointerdown', e => ovDrag(e, o, el));
      tTrack.append(el);
    });
    tTrack.style.height = Math.max(34, 8 + Math.max(1, lanes.length) * 26) + 'px';
    if (!p.overlays.length) tTrack.append(h('div.track-hint', 'Text & titles'));
    // audio
    aTrack.innerHTML = '';
    if (p.audio) {
      const m = engine.media.get(p.audio.mediaId);
      const len = Math.max(0.5, Math.min((m?.duration || dur) - (p.audio.in || 0), Math.max(dur - (p.audio.offset || 0), 0.5)));
      const sel = S.sel?.type === 'audio';
      const wave = h('canvas.wave');
      const el = h('div.aud' + (sel ? '.sel' : ''), { style: { left: X(p.audio.offset || 0) + 'px', width: X(len) + 'px' } }, wave, h('span', '♪ ' + (m?.name || 'Music')));
      el.addEventListener('pointerdown', e => audDrag(e, el));
      aTrack.append(el);
      if (m) drawWave(wave, m, p.audio.in || 0, len);
    } else aTrack.append(h('div.track-hint', 'Music — import a track and click it in the bin'));
    // labels column
    labels.innerHTML = '';
    labels.append(h('div', { style: { height: '22px' } }),
      h('div.tl-lab', { style: { height: vTrack.offsetHeight + 'px' } }, icon('film', 16)),
      h('div.tl-lab', { style: { height: tTrack.offsetHeight + 'px' } }, icon('text', 16)),
      h('div.tl-lab', { style: { height: aTrack.offsetHeight + 'px' } }, icon('music', 16)));
    movePlayhead();
  }
  const peaksCache = new Map();
  async function drawWave(cv, m, inPt, len) {
    try {
      let pk = peaksCache.get(m.id);
      if (!pk) { const buf = await decodeAudio(m.blob, m.id); pk = { peaks: waveformPeaks(buf, Math.ceil(buf.duration * 20)), dur: buf.duration }; peaksCache.set(m.id, pk); }
      const w = cv.clientWidth || X(len), hh = 30;
      cv.width = w; cv.height = hh;
      const x = cv.getContext('2d'); x.fillStyle = 'rgba(255,255,255,.55)';
      const per = pk.peaks.length / pk.dur;
      for (let px = 0; px < w; px += 2) {
        const v = pk.peaks[Math.floor((inPt + (px / w) * len) * per)] || 0;
        const bh = Math.max(1, v * hh);
        x.fillRect(px, (hh - bh) / 2, 1.4, bh);
      }
    } catch { /* undecodable audio: block without waveform */ }
  }
  function movePlayhead() { playhead.style.transform = `translateX(${X(S.t)}px)`; }
  function followPlayhead() {
    const x = X(S.t), l = scroll.scrollLeft, w = scroll.clientWidth;
    if (x > l + w - 60 || x < l) scroll.scrollLeft = x - 80;
  }
  // seek by ruler / playhead drag
  const seekDrag = e => {
    const r = inner.getBoundingClientRect();
    const mv = ev => seek((ev.clientX - r.left) / S.pps);
    mv(e);
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  ruler.addEventListener('pointerdown', seekDrag);
  playhead.addEventListener('pointerdown', seekDrag);
  [vTrack, tTrack, aTrack].forEach(tr => tr.addEventListener('pointerdown', e => {
    if (e.target === tr || e.target.classList.contains('track-hint')) { seekDrag(e); if (S.sel) select_(null); }
  }));
  // drop from bin
  vTrack.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  vTrack.addEventListener('drop', async e => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/x-media');
    const m = id && await getMedia(id);
    if (!m) return;
    const t = (e.clientX - inner.getBoundingClientRect().left) / S.pps;
    const idx = S.p.clips.findIndex(c => t < c._start + c.duration / 2);
    addFromBin(m, idx < 0 ? undefined : idx);
  });
  aTrack.addEventListener('dragover', e => e.preventDefault());
  aTrack.addEventListener('drop', async e => { e.preventDefault(); const m = await getMedia(e.dataTransfer.getData('text/x-media')); if (m?.kind === 'audio') setMusic(m); });

  function dragHelper(e, onMove, onEnd) {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX; let moved = false;
    const mv = ev => { const dx = ev.clientX - x0; if (Math.abs(dx) > 3) moved = true; if (moved) onMove(dx, ev); };
    const up = ev => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); onEnd(moved, ev.clientX - x0, ev); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }

  function clipDrag(e, c, i, el) {
    const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
    const m = engine.media.get(c.mediaId);
    const d0 = c.duration, in0 = c.in || 0, sp = c.speed || 1;
    const maxDur = m?.kind === 'video' ? (m.duration - in0) / sp : 60;
    let marker = null, target = i;
    dragHelper(e, dx => {
      const dt = dx / S.pps;
      if (mode === 'r') { el.style.width = X(clamp(d0 + dt, 0.4, maxDur)) + 'px'; el.querySelector('.clip-dur').textContent = fmtTime(clamp(d0 + dt, 0.4, maxDur)); }
      else if (mode === 'l') {
        const nd = m?.kind === 'video' ? clamp(d0 - dt, 0.4, d0 + in0 / sp) : clamp(d0 - dt, 0.4, 60);
        el.style.width = X(nd) + 'px'; el.style.left = X(c._start + d0 - nd) + 'px';
      } else {
        el.style.transform = `translateX(${dx}px)`; el.classList.add('dragging');
        const cx = X(c._start + c.duration / 2) + dx;
        target = S.p.clips.filter((o, k) => k !== i && X(o._start + o.duration / 2) < cx).length;
        marker?.remove();
        const ref = S.p.clips.filter((o, k) => k !== i)[target];
        const lx = ref ? X(ref._start) : X(S.dur);
        marker = h('div.ins-mark', { style: { left: lx + 'px' } }); vTrack.append(marker);
      }
    }, (moved, dx) => {
      marker?.remove();
      if (!moved) { select_({ type: 'clip', id: c.id }); if (!S.playing && (S.t < c._start || S.t > c._start + c.duration)) seek(c._start + 0.01); return; }
      const dt = dx / S.pps;
      edit(() => {
        if (mode === 'r') c.duration = +clamp(d0 + dt, 0.4, maxDur).toFixed(2);
        else if (mode === 'l') {
          if (m?.kind === 'video') { const nd = clamp(d0 - dt, 0.4, d0 + in0 / sp); c.in = +Math.max(0, in0 + (d0 - nd) * sp).toFixed(2); c.duration = +nd.toFixed(2); }
          else c.duration = +clamp(d0 - dt, 0.4, 60).toFixed(2);
        } else if (target !== i) { const [x] = S.p.clips.splice(i, 1); S.p.clips.splice(target, 0, x); }
        S.sel = { type: 'clip', id: c.id };
      }, { structural: false });
      drawInspector();
    });
  }
  function ovDrag(e, o, el) {
    const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
    const s0 = o.start, d0 = o.duration;
    const snapT = t => {
      const pts = [0, S.t, ...S.p.clips.flatMap(c => [c._start, c._start + c.duration])];
      for (const pt of pts) if (Math.abs(X(pt) - X(t)) < 7) return pt;
      return t;
    };
    let ns = s0, nd = d0;
    dragHelper(e, dx => {
      const dt = dx / S.pps;
      if (mode === 'move') { ns = Math.max(0, snapT(s0 + dt)); }
      else if (mode === 'r') { nd = Math.max(0.3, snapT(s0 + d0 + dt) - s0); }
      else { ns = clamp(snapT(s0 + dt), 0, s0 + d0 - 0.3); nd = s0 + d0 - ns; }
      el.style.left = X(ns) + 'px'; el.style.width = X(nd) + 'px';
    }, moved => {
      if (!moved) { select_({ type: 'text', id: o.id }); if (S.t < o.start || S.t > o.start + o.duration) seek(o.start + Math.min(0.6, o.duration / 2)); return; }
      edit(() => { o.start = +ns.toFixed(2); o.duration = +nd.toFixed(2); S.sel = { type: 'text', id: o.id }; }, { structural: false });
      drawInspector();
    });
  }
  function audDrag(e, el) {
    const a = S.p.audio, o0 = a.offset || 0;
    let no = o0;
    dragHelper(e, dx => { no = Math.max(0, o0 + dx / S.pps); el.style.left = X(no) + 'px'; },
      moved => {
        if (!moved) return select_({ type: 'audio' });
        edit(() => { a.offset = +no.toFixed(2); S.sel = { type: 'audio' }; }, { structural: false });
        drawInspector();
      });
  }

  // ---------- canvas: drag text directly on the preview ----------
  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    const lx = (e.clientX - r.left) / r.width * engine.W, ly = (e.clientY - r.top) / r.height * engine.H;
    const hitId = Object.keys(engine.hit).reverse().find(id => { const b = engine.hit[id]; return lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h; });
    if (!hitId) {
      const c = S.p.clips.find(c => S.t >= c._start && S.t < c._start + c.duration);
      if (c) select_({ type: 'clip', id: c.id });
      return;
    }
    const o = S.p.overlays.find(x => x.id === hitId);
    if (S.sel?.id !== o.id) select_({ type: 'text', id: o.id });
    e.preventDefault();
    const x0 = o.x, y0 = o.y, cx = e.clientX, cy = e.clientY;
    let first = true;
    const mv = ev => {
      const nx = clamp(x0 + (ev.clientX - cx) / r.width, 0.02, 0.98), ny = clamp(y0 + (ev.clientY - cy) / r.height, 0.02, 0.98);
      edit(() => { o.x = Math.abs(nx - 0.5) < 0.015 ? 0.5 : +nx.toFixed(3); o.y = +ny.toFixed(3); }, { key: 'drag' + o.id + (first ? '' : ''), structural: false });
      first = false;
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); drawInspector(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });

  // ---------- edit actions ----------
  function split() {
    const i = S.p.clips.findIndex(c => S.t > c._start + 0.2 && S.t < c._start + c.duration - 0.2);
    if (i < 0) return toast('Move the playhead inside a clip to split it');
    edit(() => {
      const c = S.p.clips[i], cut = S.t - c._start;
      const b = { ...JSON.parse(JSON.stringify(c)), id: uid(), duration: +(c.duration - cut).toFixed(2), in: +((c.in || 0) + cut * (c.speed || 1)).toFixed(2) };
      c.duration = +cut.toFixed(2); c.transition = { type: 'none', dur: 0 };
      S.p.clips.splice(i + 1, 0, b);
      S.sel = { type: 'clip', id: b.id };
    });
    drawInspector();
  }
  function duplicate() {
    const s = findSel();
    if (!s || S.sel.type === 'audio') return;
    edit(() => {
      const d = { ...JSON.parse(JSON.stringify(s)), id: uid() };
      if (S.sel.type === 'clip') S.p.clips.splice(S.p.clips.indexOf(s) + 1, 0, d);
      else { d.start = s.start + s.duration; S.p.overlays.push(d); }
      S.sel = { type: S.sel.type, id: d.id };
    });
    drawInspector();
  }
  function remove() {
    if (!S.sel) return;
    edit(() => {
      if (S.sel.type === 'clip') S.p.clips = S.p.clips.filter(c => c.id !== S.sel.id);
      else if (S.sel.type === 'text') S.p.overlays = S.p.overlays.filter(o => o.id !== S.sel.id);
      else S.p.audio = null;
      S.sel = null;
    });
    drawInspector();
  }
  function addText(preset = TEXT_PRESETS[0]) {
    edit(() => {
      const o = newText('Your text', +S.t.toFixed(2), { ...preset.props, bgColor: preset.props.bgColor === '#14b8a6' ? S.p.accent : preset.props.bgColor });
      S.p.overlays.push(o); S.sel = { type: 'text', id: o.id };
    }, { structural: false });
    drawInspector();
  }
  function addTitleCard() {
    edit(() => {
      const i = S.p.clips.findIndex(c => S.t < c._start + c.duration);
      const c = newClip(null, { kind: 'solid', color: '#0b1220', color2: S.p.accent, gradient: true, duration: 2.5, motion: 'none' });
      S.p.clips.splice(i < 0 ? S.p.clips.length : i + 1, 0, c);
      layoutTimeline(S.p);
      S.p.overlays.push(newText('Title', +(c._start + 0.2).toFixed(2), { duration: 2.2, y: 0.47, anim: 'pop' }));
      S.sel = { type: 'clip', id: c.id };
    });
    drawInspector();
  }

  // ---------- inspector ----------
  function drawInspector() {
    insp.innerHTML = '';
    const s = findSel();
    if (!S.sel || !s) return insp.append(...projectPanel());
    if (S.sel.type === 'clip') return insp.append(...clipPanel(s));
    if (S.sel.type === 'text') return insp.append(...textPanel(s));
    insp.append(...audioPanel(s));
  }
  const E = (key, fn, structural = false) => edit(fn, { key, structural });

  function projectPanel() {
    const p = S.p;
    return [
      h('div.insp-h', icon('film'), h('b', 'Project')),
      section('Format',
        seg(p.aspect, Object.keys(ASPECTS).map(a => [a, a]), v => E('', () => (p.aspect = v), true)),
        h('p.muted.sm', { style: { marginTop: '6px' } }, { '9:16': 'Reels · TikTok · Shorts · Stories', '4:5': 'Instagram feed portrait', '1:1': 'Square feed post', '16:9': 'YouTube · website · presentations' }[p.aspect])),
      section('Branding',
        color('Accent', p.accent, v => E('accent', () => (p.accent = v))),
        color('Background', p.bg, v => E('bg', () => (p.bg = v))),
        text('Before label', p.style.labelBefore, v => E('lb', () => (p.style.labelBefore = v))),
        text('After label', p.style.labelAfter, v => E('la', () => (p.style.labelAfter = v)))),
      section('Watermark',
        toggle('Show clinic watermark', p.watermark.on, v => E('', () => { p.watermark.on = v; p.watermark.logoMediaId ||= settings.logoMediaId; p.watermark.text ||= settings.handle; }, true)),
        text('Text', p.watermark.text || '', v => E('wmt', () => (p.watermark.text = v))),
        select('Position', p.watermark.pos, [['br', 'Bottom right'], ['bl', 'Bottom left'], ['tr', 'Top right'], ['tl', 'Top left']], v => E('', () => (p.watermark.pos = v))),
        range('Opacity', p.watermark.opacity, 0.2, 1, 0.05, v => E('wmo', () => (p.watermark.opacity = v))),
        h('p.muted.sm', settings.logoMediaId ? 'Uses the logo from Settings.' : 'Add your logo in Settings to use it instead of text.')),
      section('AI tools',
        h('button.btn.wide', { onclick: () => aiEnhanceAll() }, icon('wand'), 'Auto-enhance every clip'),
        h('button.btn.wide', { onclick: () => aiAnalyzeAll() }, icon('sparkles'), 'Detect smiles (auto-align & zoom)'),
        h('button.btn.wide', { onclick: () => aiBeatSync() }, icon('music'), 'Beat-sync cuts to music')),
      h('p.muted.sm.tips', 'Tips: Space play · S split · Del delete · Ctrl+Z undo · Ctrl+wheel zoom timeline · drag text on the preview'),
    ];
  }

  function clipPanel(c) {
    const m = engine.media.get(c.mediaId), m2 = engine.media.get(c.mediaId2);
    const isVid = m?.kind === 'video', solid = c.kind === 'solid';
    const filt = key => c[key] || (c[key] = DEF_FILTER());
    const faceInfo = mm => mm?.kind !== 'image' ? '' : mm.meta?.face ? '✓ smile found' : mm.meta?.face === null ? 'no face (intra-oral)' : 'not analysed';
    const out = [h('div.insp-h', icon(solid ? 'layers' : isVid ? 'video' : 'image'), h('b', solid ? 'Title card' : m?.name || 'Clip'),
      h('div.sp'), h('button.icon-btn', { title: 'Duplicate', onclick: duplicate }, icon('copy')), h('button.icon-btn', { title: 'Delete', onclick: remove }, icon('trash')))];
    if (solid) {
      out.push(section('Background',
        color('Colour', c.color, v => E('c1', () => (c.color = v))),
        toggle('Gradient', !!c.gradient, v => E('', () => (c.gradient = v))),
        c.gradient && color('Colour 2', c.color2 || S.p.accent, v => E('c2', () => (c.color2 = v)))));
    } else {
      out.push(section('Media',
        h('div.media-row',
          h('button.mini', { onclick: async () => { const x = await pickMedia({ title: 'Replace media' }); if (x) { E('', () => { c.mediaId = x.id; c.in = 0; if (x.kind === 'video') c.duration = Math.min(x.duration, c.duration); }, true); x.kind === 'image' && tryAnalyze(x).then(() => changed(true)); drawInspector(); } } },
            m?.thumb ? h('img', { src: m.thumb }) : icon('image'), h('span', c.layout === 'single' ? 'Replace' : 'Before')),
          c.layout !== 'single' && h('button.mini', { onclick: async () => { const x = await pickMedia({ kinds: ['image'], title: 'Choose the AFTER photo' }); if (x) { await tryAnalyze(x); E('', () => (c.mediaId2 = x.id), true); drawInspector(); } } },
            m2?.thumb ? h('img', { src: m2.thumb }) : icon('plus'), h('span', 'After')),
          c.layout !== 'single' && m2 && h('button.icon-btn', { title: 'Swap before / after', onclick: () => { E('', () => ([c.mediaId, c.mediaId2] = [c.mediaId2, c.mediaId]), true); drawInspector(); } }, icon('flip'))),
        !isVid && h('div.seg-wrap', h('span.row-l', 'Layout'),
          seg(c.layout, [['single', 'Single'], ['wipe', 'Swipe'], ['split', 'Split']], v => { E('', () => { c.layout = v; if (v !== 'single' && c.motion === 'smileZoom') c.motion = 'none'; }, true); drawInspector(); })),
        c.layout !== 'single' && toggle('AI auto-align smiles', c.align !== false, v => E('', () => (c.align = v))),
        c.layout !== 'single' && toggle('Before / After labels', c.labels !== false, v => E('', () => (c.labels = v))),
        m?.kind === 'image' && h('div.ai-line', icon('sparkles', 14), h('span', faceInfo(m) + (m2 ? ' · ' + faceInfo(m2) : '')),
          h('button.btn.sm', { onclick: async () => { const b = busy('Detecting smile…'); m.meta.face = undefined; await tryAnalyze(m); if (m2) { m2.meta.face = undefined; await tryAnalyze(m2); } b.done(); changed(true); drawInspector(); } }, 'Detect'))));
    }
    out.push(section('Timing',
      num('Duration', c.duration, 0.4, isVid ? +((m.duration - (c.in || 0)) / (c.speed || 1)).toFixed(2) : 60, 0.1, v => E('', () => (c.duration = v)), 's'),
      isVid && num('Trim start', c.in || 0, 0, Math.max(0, m.duration - 0.4), 0.1, v => E('', () => { c.in = v; c.duration = Math.min(c.duration, (m.duration - v) / (c.speed || 1)); }), 's'),
      isVid && select('Speed', String(c.speed || 1), ['0.25', '0.5', '0.75', '1', '1.5', '2', '3', '4'].map(v => [v, v + '×']), v => E('', () => { c.speed = +v; c.duration = Math.min(c.duration, (m.duration - (c.in || 0)) / c.speed); })),
      isVid && range('Volume', c.volume ?? 1, 0, 1.5, 0.05, v => E('vol', () => (c.volume = v)), v => Math.round(v * 100) + '%')));
    if (!solid) {
      out.push(section('Framing & motion',
        select('Fit', c.fit, [['cover', 'Fill frame'], ['contain', 'Fit (blurred bars)']], v => E('', () => (c.fit = v))),
        select('Motion', c.motion, MOTIONS.map(k => [k, MOTION_LABEL[k]]), v => E('', () => (c.motion = v))),
        range('Zoom', c.zoom || 1, 1, 3, 0.01, v => E('zoom', () => (c.zoom = v)), v => v.toFixed(2) + '×'),
        range('Pan X', c.offX || 0, -1, 1, 0.01, v => E('ox', () => (c.offX = v)), v => v.toFixed(2)),
        range('Pan Y', c.offY || 0, -1, 1, 0.01, v => E('oy', () => (c.offY = v)), v => v.toFixed(2))));
      const f = filt('filter');
      const colorSec = section('Colour',
        h('div.row-btns',
          h('button.btn.sm', { onclick: async () => {
            const src = m?.kind === 'image' ? await imageEl(m) : engine.videos.get(c.id);
            if (!src) return;
            const prm = autoEnhanceParams(src), prm2 = m2?.kind === 'image' ? autoEnhanceParams(await imageEl(m2)) : null;
            E('', () => { c.filter = prm; if (prm2) c.filter2 = prm2; }); drawInspector(); toast('AI colour correction applied ✨');
          } }, icon('wand'), 'AI auto-enhance'),
          h('button.btn.sm', { onclick: () => { E('', () => { c.filter = DEF_FILTER(); delete c.filter2; }); drawInspector(); } }, 'Reset')),
        range('Brightness', f.brightness, 0.5, 1.6, 0.01, v => E('fb', () => (filt('filter').brightness = v))),
        range('Contrast', f.contrast, 0.5, 1.8, 0.01, v => E('fc', () => (filt('filter').contrast = v))),
        range('Saturation', f.saturate, 0, 2, 0.01, v => E('fs', () => (filt('filter').saturate = v))),
        range('Warmth', f.warmth, -0.5, 0.5, 0.01, v => E('fw', () => (filt('filter').warmth = v))));
      out.push(colorSec);
    }
    const idx = S.p.clips.indexOf(c);
    if (idx < S.p.clips.length - 1) {
      const tr = c.transition || { type: 'none', dur: 0 };
      out.push(h('div.sec.sec-trans', h('div.sec-h', 'Transition to next clip'),
        h('div.chips', ...TRANSITIONS.map(k => h('button.chip' + (tr.type === k ? '.on' : ''), { onclick: () => { E('', () => (c.transition = { type: k, dur: k === 'none' ? 0 : tr.dur || 0.5 })); drawInspector(); } }, TR_LABEL[k]))),
        tr.type !== 'none' && range('Length', tr.dur, 0.15, 2, 0.05, v => E('trd', () => (c.transition.dur = v)), v => v.toFixed(2) + 's'),
        h('button.btn.sm', { onclick: () => { E('', () => S.p.clips.forEach((x, k) => k < S.p.clips.length - 1 && (x.transition = { ...c.transition }))); toast('Applied to all clips'); } }, 'Apply to all')));
    }
    return out;
  }

  function textPanel(o) {
    return [
      h('div.insp-h', icon('text'), h('b', 'Text'), h('div.sp'),
        h('button.icon-btn', { title: 'Duplicate', onclick: duplicate }, icon('copy')), h('button.icon-btn', { title: 'Delete', onclick: remove }, icon('trash'))),
      section('Content', text('', o.text, v => { E('txt' + o.id, () => (o.text = v)); }, { area: true }),
        h('div.chips', ...TEXT_PRESETS.map(pr => h('button.chip', { onclick: () => { E('', () => Object.assign(o, pr.props, pr.props.bgColor === '#14b8a6' ? { bgColor: S.p.accent } : {})); drawInspector(); } }, pr.name)))),
      section('Style',
        select('Font', o.font, [['Inter, system-ui, sans-serif', 'Sans (Inter)'], ['Georgia, "Times New Roman", serif', 'Serif'], ['"Trebuchet MS", sans-serif', 'Rounded'], ['"Courier New", monospace', 'Mono'], ['Impact, "Arial Black", sans-serif', 'Impact']], v => E('', () => (o.font = v))),
        range('Size', o.size, 20, 220, 1, v => E('ts', () => (o.size = v)), v => v + 'px'),
        select('Weight', String(o.weight), [['400', 'Regular'], ['600', 'Semibold'], ['800', 'Bold'], ['900', 'Black']], v => E('', () => (o.weight = +v))),
        color('Colour', o.color, v => E('tc', () => (o.color = v))),
        select('Background', o.bg, [['none', 'None (shadow)'], ['box', 'Box'], ['pill', 'Pill']], v => { E('', () => (o.bg = v)); drawInspector(); }),
        o.bg !== 'none' && color('Box colour', o.bgColor, v => E('tbg', () => (o.bgColor = v)))),
      section('Animation & position',
        select('Animation', o.anim, TEXT_ANIMS.map(a => [a, { fade: 'Fade', slideUp: 'Slide up', pop: 'Pop', typewriter: 'Typewriter', zoom: 'Zoom in', none: 'None' }[a]]), v => E('', () => (o.anim = v))),
        range('X', o.x, 0, 1, 0.005, v => E('tx', () => (o.x = v)), v => Math.round(v * 100) + '%'),
        range('Y', o.y, 0, 1, 0.005, v => E('ty', () => (o.y = v)), v => Math.round(v * 100) + '%'),
        num('Start', o.start, 0, 600, 0.1, v => E('', () => (o.start = v)), 's'),
        num('Duration', o.duration, 0.3, 600, 0.1, v => E('', () => (o.duration = v)), 's'),
        h('button.btn.sm', { onclick: () => E('', () => (o.start = +S.t.toFixed(2))) }, 'Start at playhead')),
    ];
  }

  function audioPanel(a) {
    const m = engine.media.get(a.mediaId);
    return [
      h('div.insp-h', icon('music'), h('b', m?.name || 'Music'), h('div.sp'), h('button.icon-btn', { title: 'Remove music', onclick: remove }, icon('trash'))),
      section('Mix',
        range('Volume', a.volume ?? 0.8, 0, 1.5, 0.05, v => E('av', () => (a.volume = v)), v => Math.round(v * 100) + '%'),
        range('Fade in', a.fadeIn ?? 0.3, 0, 5, 0.1, v => E('afi', () => (a.fadeIn = v)), v => v.toFixed(1) + 's'),
        range('Fade out', a.fadeOut ?? 1.5, 0, 6, 0.1, v => E('afo', () => (a.fadeOut = v)), v => v.toFixed(1) + 's'),
        num('Starts at', a.offset || 0, 0, 600, 0.1, v => E('', () => (a.offset = v)), 's'),
        num('Song start', a.in || 0, 0, Math.max(0, (m?.duration || 1) - 1), 0.1, v => E('', () => (a.in = v)), 's')),
      section('AI', h('p.muted.sm', 'Analyses the track tempo and snaps every cut onto the beat.'),
        h('button.btn.wide.primary', { onclick: aiBeatSync }, icon('sparkles'), 'AI beat sync'), S.bpm && h('p.muted.sm', `Detected tempo: ${S.bpm} BPM`)),
    ];
  }

  // ---------- AI actions ----------
  async function aiEnhanceAll() {
    const b = busy('AI colour correction…');
    const res = [];
    for (const c of S.p.clips) {
      const m = engine.media.get(c.mediaId);
      if (m?.kind === 'image') res.push([c, 'filter', autoEnhanceParams(await imageEl(m))]);
      else if (m?.kind === 'video' && engine.videos.get(c.id)?.videoWidth) res.push([c, 'filter', autoEnhanceParams(engine.videos.get(c.id))]);
      const m2 = engine.media.get(c.mediaId2);
      if (m2?.kind === 'image') res.push([c, 'filter2', autoEnhanceParams(await imageEl(m2))]);
    }
    b.done();
    edit(() => res.forEach(([c, k, v]) => (c[k] = v)));
    drawInspector(); toast(`Enhanced ${res.length} shot(s) ✨`, 'ok');
  }
  async function aiAnalyzeAll() {
    const b = busy('Finding smiles…');
    let found = 0, total = 0;
    for (const id of new Set(S.p.clips.flatMap(c => [c.mediaId, c.mediaId2]).filter(Boolean))) {
      const m = engine.media.get(id);
      if (m?.kind !== 'image') continue;
      total++; m.meta.face = undefined;
      if (await tryAnalyze(m)) found++;
    }
    b.done(); changed(true);
    toast(total ? `Smile found in ${found}/${total} photo(s)` : 'No photos to analyse', found ? 'ok' : '');
  }
  async function aiBeatSync() {
    if (!S.p.audio) return toast('Add music first', 'err');
    const b = busy('Listening for the beat…');
    try {
      const m = engine.media.get(S.p.audio.mediaId);
      const buf = await decodeAudio(m.blob, m.id);
      let { beats, period, bpm } = detectBeats(buf);
      if (period < 0.45) period *= 2; // cut every 2 beats on fast tracks
      S.bpm = bpm;
      const owners = S.p.overlays.map(o => { const i = S.p.clips.findLastIndex(c => c._start <= o.start + 1e-3); return [i, o.start - (S.p.clips[i]?._start || 0)]; });
      edit(() => {
        beatSync(S.p, beats.map(x => x - (S.p.audio.in || 0)).filter(x => x >= 0), period);
        layoutTimeline(S.p);
        S.p.overlays.forEach((o, k) => { const [i, off] = owners[k]; if (i >= 0) o.start = +(S.p.clips[i]._start + off).toFixed(2); });
      });
      drawInspector(); toast(`Cuts synced to ${bpm} BPM 🎵`, 'ok');
    } catch (e) { toast('Could not analyse this audio: ' + e.message, 'err'); }
    b.done();
  }

  // ---------- export ----------
  async function snapshot() {
    const b = busy('Rendering frame…');
    const blob = await exportFrame(S.p, S.t);
    b.done();
    downloadBlob(blob, `${S.p.name.replace(/[^\w-]+/g, '_')}-${S.t.toFixed(1)}s.png`);
  }
  async function exportModal() {
    if (!S.p.clips.length) return toast('Add some clips first', 'err');
    pause();
    const mime = pickMime();
    let quality = '1080p';
    await modal('Export video', close => {
      const body = h('div');
      const [W, H] = ASPECTS[S.p.aspect];
      const start = async () => {
        const bar = h('div.progress', h('div'));
        const sig = { cancelled: false };
        body.replaceChildren(h('p', 'Rendering in real time — keep this tab open and visible.'), bar, h('p.muted.sm', 'Duration ' + fmtTime(S.dur)),
          h('button.btn', { onclick: () => { sig.cancelled = true; close(); } }, 'Cancel'));
        try {
          const res = await exportProject(S.p, { quality, signal: sig, onProgress: v => (bar.firstChild.style.width = (v * 100).toFixed(1) + '%') });
          if (!res) return;
          const name = `${S.p.name.replace(/[^\w-]+/g, '_')}.${res.ext}`;
          const url = URL.createObjectURL(res.blob);
          body.replaceChildren(
            h('video.result', { src: url, controls: true, playsInline: true, loop: true, autoplay: true, muted: true }),
            h('p.muted.sm', `${(res.blob.size / 1048576).toFixed(1)} MB · ${res.ext.toUpperCase()}` + (res.ext === 'webm' ? ' — this browser can only encode WebM. Use Safari or a recent Chrome for MP4, or convert before posting to Instagram.' : '')),
            h('div.modal-foot',
              h('button.btn', { onclick: async () => { await addMedia(new File([res.blob], name, { type: res.mime }), { kind: 'video' }); toast('Saved to the media library', 'ok'); drawBin(); } }, 'Save to library'),
              navigator.canShare?.({ files: [new File([res.blob], name, { type: res.mime })] }) && h('button.btn', { onclick: () => navigator.share({ files: [new File([res.blob], name, { type: res.mime })] }).catch(() => {}) }, 'Share'),
              h('button.btn.primary', { onclick: () => downloadBlob(res.blob, name) }, icon('download'), 'Download')));
        } catch (e) { body.replaceChildren(h('p.err', 'Export failed: ' + e.message)); }
      };
      body.append(
        select('Resolution', quality, Object.keys(QUALITIES).map(q => [q, `${q} · ${Math.round(W * QUALITIES[q])}×${Math.round(H * QUALITIES[q])}`]), v => (quality = v)),
        h('p.muted.sm', `Format: ${mime.includes('mp4') ? 'MP4 (H.264) — ready for Instagram, TikTok, WhatsApp' : mime ? 'WebM (VP9) — your browser cannot encode MP4' : 'not supported in this browser'} · 30 fps`),
        h('div.modal-foot', h('button.btn.primary', { disabled: !mime, onclick: start }, icon('film'), 'Render video')));
      return body;
    });
  }
  async function captionModal() {
    const ideas = captionIdeas({ treatment: S.p.name.split('—')[0].trim(), clinic: settings.clinic, handle: settings.handle });
    modal('Caption assistant', () => ideas.map(c => h('div.caption', h('pre', c), h('button.btn.sm', { onclick: () => navigator.clipboard.writeText(c).then(() => toast('Copied', 'ok')) }, icon('copy'), 'Copy'))));
  }

  // ---------- keyboard ----------
  const onKey = e => {
    if (e.target.closest('input, textarea, select') || document.querySelector('.modal-back')) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (k === ' ') { e.preventDefault(); togglePlay(); }
    else if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && k === 'y') { e.preventDefault(); redo(); }
    else if (mod && k === 'd') { e.preventDefault(); duplicate(); }
    else if (k === 's' && !mod) split();
    else if (k === 'delete' || k === 'backspace') remove();
    else if (k === 'arrowright') seek(S.t + (e.shiftKey ? 1 : 1 / 30));
    else if (k === 'arrowleft') seek(S.t - (e.shiftKey ? 1 : 1 / 30));
    else if (k === 'home') seek(0);
    else if (k === 'end') seek(S.dur);
    else if (k === 'escape') select_(null);
  };
  addEventListener('keydown', onKey);
  const onResize = () => drawTimeline();
  addEventListener('resize', onResize);

  current = { destroy() { pause(); removeEventListener('keydown', onKey); removeEventListener('resize', onResize); engine.destroy(); main.classList.remove('studio-main'); save(); } };

  drawBin();
  drawInspector();
  await changed(true);
  // analyse any photos not analysed yet (enables smile zoom / alignment)
  (async () => {
    let any = false;
    for (const m of engine.media.values()) if (m.kind === 'image' && m.meta?.face === undefined) { await tryAnalyze(m); any = true; }
    if (any && current) changed(true);
  })();
}
