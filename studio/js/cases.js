// Patient cases: photo library per case, tagging, photo editor with AI tools.
import { h, icon, modal, toast, busy, pickFiles, makeCanvas, downloadBlob, clamp } from './util.js';
import { allCases, saveCase, newCase, deleteCase, allMedia, addMedia, deleteMedia, updateMedia, imageEl, blobFromCanvas, mediaURL } from './store.js';
import { tryAnalyze, autoEnhanceParams, applyAdjustPixels, whitenTeeth } from './ai.js';
import { text, range, select, mediaThumb, emptyState, seg } from './ui.js';
import { magicReel } from './studio.js';

export const VIEWS = [
  ['smile', 'Smile'], ['retracted', 'Retracted frontal'], ['left', 'Left lateral'], ['right', 'Right lateral'],
  ['upper', 'Upper occlusal'], ['lower', 'Lower occlusal'], ['portrait', 'Portrait'], ['profile', 'Profile'], ['other', 'Other'],
];
const TAGS = [['', 'No tag'], ['before', 'Before'], ['progress', 'Progress'], ['after', 'After']];

export async function renderCases(main) {
  const cases = await allCases();
  const media = await allMedia();
  main.innerHTML = '';
  main.append(h('div.top',
    h('div', h('h1', 'Patient cases'), h('p.muted', 'Standardised clinical photos, organised per patient — ready for comparison and reels.')),
    h('div.actions', h('button.btn.primary', { onclick: () => editCase() }, icon('plus'), 'New case'))));
  if (!cases.length) {
    main.append(emptyState('folder', 'No cases yet', 'Create a case, then capture photos with the dental framing guides or import existing ones.',
      h('button.btn.primary', { onclick: () => editCase() }, icon('plus'), 'Create first case')));
    return;
  }
  main.append(h('div.grid.cards', ...cases.map(c => {
    const ph = media.filter(m => m.caseId === c.id);
    const cover = ph.find(m => m.tag === 'after') || ph[0];
    return h('div.card.case', { onclick: () => (location.hash = '#/case/' + c.id) },
      h('div.case-cover', cover?.thumb ? h('img', { src: cover.thumb }) : icon('tooth', 40)),
      h('div.case-b', h('b', c.patient || 'Untitled case'), h('span.muted', c.treatment || '—'),
        h('span.muted.sm', `${ph.length} photo(s) · ${new Date(c.updatedAt).toLocaleDateString()}`)));
  })));
}

export async function editCase(c) {
  const isNew = !c;
  c = c ? { ...c } : newCase();
  const r = await modal(isNew ? 'New case' : 'Edit case', close => [
    text('Patient', c.patient, v => (c.patient = v), { placeholder: 'Name or anonymised ID' }),
    text('Treatment', c.treatment, v => (c.treatment = v), { placeholder: 'e.g. Veneers 13–23, Aligners' }),
    text('Notes', c.notes, v => (c.notes = v), { area: true }),
    h('p.muted.sm', 'Get the patient\'s written consent before using their photos in marketing.'),
    h('div.modal-foot', h('button.btn.primary', { onclick: () => close(c) }, isNew ? 'Create case' : 'Save')),
  ]);
  if (!r) return;
  await saveCase(r);
  location.hash = '#/case/' + r.id;
  if (!isNew) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export async function renderCase(main, id) {
  const c = (await allCases()).find(x => x.id === id);
  if (!c) { location.hash = '#/cases'; return; }
  const media = (await allMedia()).filter(m => m.caseId === id);
  main.innerHTML = '';
  const refresh = () => renderCase(main, id);
  const importFiles = async () => {
    const files = await pickFiles('image/*,video/*');
    if (!files.length) return;
    const b = busy('Importing…');
    for (const f of files) { const m = await addMedia(f, { caseId: id }); if (m.kind === 'image') { b.set('AI: analysing ' + f.name); await tryAnalyze(m); } }
    b.done(); await saveCase(c); refresh();
  };
  const before = media.find(m => m.tag === 'before' && m.kind === 'image'), after = media.find(m => m.tag === 'after' && m.kind === 'image');
  main.append(
    h('div.top',
      h('div', h('a.back', { href: '#/cases' }, icon('back', 16), 'Cases'), h('h1', c.patient || 'Untitled case'), h('p.muted', [c.treatment, c.notes].filter(Boolean).join(' · ') || 'No details')),
      h('div.actions',
        h('button.btn', { onclick: () => editCase(c) }, 'Edit'),
        h('button.btn', { onclick: importFiles }, icon('upload'), 'Import'),
        h('a.btn', { href: '#/capture/' + id }, icon('camera'), 'Capture'),
        h('a.btn', { href: `#/compare/${before?.id || ''}/${after?.id || ''}` }, icon('compare'), 'Compare'),
        h('button.btn.primary', { onclick: () => magicReel({ before, after, treatment: c.treatment, caseId: id }) }, icon('sparkles'), 'Magic Reel'))));
  if (!media.length) {
    main.append(emptyState('camera', 'No photos in this case', 'Capture with the framing guides for consistent before/after shots, or import from your camera.',
      h('a.btn.primary', { href: '#/capture/' + id }, icon('camera'), 'Capture'), h('button.btn', { onclick: importFiles }, icon('upload'), 'Import')));
  } else {
    const groups = [['before', 'Before'], ['progress', 'Progress'], ['after', 'After'], ['', 'Untagged']];
    for (const [tag, title] of groups) {
      const list = media.filter(m => (m.tag || '') === tag);
      if (!list.length) continue;
      main.append(h('h3.group-h', title, h('span.muted', ` ${list.length}`)),
        h('div.photo-grid', ...list.map(m => {
          const t = mediaThumb(m, { title: m.name });
          t.append(h('span.view-lbl', VIEWS.find(v => v[0] === m.view)?.[1] || ''));
          t.onclick = () => photoDetail(m, refresh);
          return t;
        })));
    }
  }
  main.append(h('div.danger-zone', h('button.btn.danger.sm', { onclick: async () => { if (confirm('Delete this case and all its photos?')) { await deleteCase(id); location.hash = '#/cases'; } } }, icon('trash'), 'Delete case')));
}

async function photoDetail(m, refresh) {
  await modal(m.name, close => {
    const preview = m.kind === 'video' ? h('video.detail', { src: mediaURL(m), controls: true, playsInline: true }) : h('img.detail', { src: mediaURL(m) });
    const f = m.meta?.face;
    return [
      preview,
      h('div.detail-form',
        h('div.seg-wrap', h('span.row-l', 'Tag'), seg(m.tag || '', TAGS, async v => { m.tag = v; await updateMedia(m); })),
        select('View', m.view || '', [['', '—'], ...VIEWS], async v => { m.view = v; await updateMedia(m); }),
        m.kind === 'image' && h('p.muted.sm', f ? `AI: smile detected · head tilt ${f.tilt.toFixed(1)}°` : f === null ? 'AI: no face found (intra-oral view)' : ''),
        h('div.modal-foot',
          h('button.btn.danger', { onclick: async () => { if (confirm('Delete this photo?')) { await deleteMedia(m.id); close(); refresh(); } } }, icon('trash')),
          h('button.btn', { onclick: () => downloadBlob(m.blob, m.name) }, icon('download')),
          m.kind === 'image' && h('button.btn.primary', { onclick: async () => { close(); await photoEditor(m); refresh(); } }, icon('wand'), 'Edit & AI tools'))),
    ];
  }, { wide: true });
  refresh();
}

/** Photo editor: rotate / straighten / crop to ratio / adjustments / AI enhance / whitening preview. */
export async function photoEditor(m) {
  const img = await imageEl(m);
  const st = { rot: 0, straight: 0, flipH: false, flipV: false, ratio: 'free', adj: { brightness: 1, contrast: 1, saturate: 1, warmth: 0 }, whiten: 0, whiteCanvas: null };
  const cv = makeCanvas(2, 2);
  const MAXP = 900;
  const render = (target, maxSide) => {
    const src = st.whiteCanvas || img;
    const W0 = img.naturalWidth, H0 = img.naturalHeight;
    const quarter = (st.rot / 90) % 2 !== 0;
    let W = quarter ? H0 : W0, H = quarter ? W0 : H0;
    const ratios = { '1:1': 1, '4:5': 0.8, '3:2': 1.5, '16:9': 16 / 9, '9:16': 9 / 16 };
    let cw = W, ch = H;
    if (ratios[st.ratio]) { const r = ratios[st.ratio]; if (W / H > r) cw = H * r; else ch = W / r; }
    // straightening needs a little zoom to keep corners filled
    const a = st.straight * Math.PI / 180, zoom = Math.abs(a) > 0 ? Math.abs(Math.cos(a)) + Math.max(cw, ch) / Math.min(cw, ch) * Math.abs(Math.sin(a)) : 1;
    const s = maxSide ? Math.min(1, maxSide / Math.max(cw, ch)) : 1;
    target.width = Math.round(cw * s); target.height = Math.round(ch * s);
    const x = target.getContext('2d', { willReadFrequently: true });
    x.save();
    x.translate(target.width / 2, target.height / 2);
    x.rotate(st.rot * Math.PI / 180 + a);
    x.scale((st.flipH ? -1 : 1) * s * zoom, (st.flipV ? -1 : 1) * s * zoom);
    x.drawImage(src, -W0 / 2, -H0 / 2);
    x.restore();
    const id = x.getImageData(0, 0, target.width, target.height);
    x.putImageData(applyAdjustPixels(id, st.adj), 0, 0);
    return target;
  };
  const redraw = () => render(cv, MAXP);
  redraw();
  const res = await modal('Photo editor', close => {
    const sliders = h('div');
    const drawSliders = () => {
      sliders.replaceChildren(
        range('Brightness', st.adj.brightness, 0.5, 1.6, 0.01, v => { st.adj.brightness = v; redraw(); }),
        range('Contrast', st.adj.contrast, 0.5, 1.8, 0.01, v => { st.adj.contrast = v; redraw(); }),
        range('Saturation', st.adj.saturate, 0, 2, 0.01, v => { st.adj.saturate = v; redraw(); }),
        range('Warmth', st.adj.warmth, -0.5, 0.5, 0.01, v => { st.adj.warmth = v; redraw(); }));
    };
    drawSliders();
    const straightIn = range('Straighten', 0, -15, 15, 0.1, v => { st.straight = v; redraw(); }, v => v.toFixed(1) + '°');
    return [
      h('div.editor-photo', h('div.ep-canvas', cv),
        h('div.ep-tools',
          h('div.sec-h', 'Geometry'),
          h('div.row-btns',
            h('button.btn.sm', { onclick: () => { st.rot = (st.rot + 270) % 360; redraw(); } }, icon('rotate'), '-90°'),
            h('button.btn.sm', { onclick: () => { st.rot = (st.rot + 90) % 360; redraw(); } }, '+90°'),
            h('button.btn.sm', { title: 'Mirror (for occlusal mirror shots)', onclick: () => { st.flipH = !st.flipH; redraw(); } }, icon('flip'), 'H'),
            h('button.btn.sm', { onclick: () => { st.flipV = !st.flipV; redraw(); } }, 'V')),
          straightIn,
          m.meta?.face && h('button.btn.sm.wide', { onclick: () => { st.straight = clamp(-m.meta.face.tilt, -15, 15); straightIn.querySelector('input').value = st.straight; straightIn.querySelector('.rv').textContent = st.straight.toFixed(1) + '°'; redraw(); } }, icon('sparkles'), 'AI level the eye line'),
          select('Crop', st.ratio, [['free', 'Original'], ['1:1', '1:1'], ['4:5', '4:5'], ['3:2', '3:2'], ['16:9', '16:9'], ['9:16', '9:16']], v => { st.ratio = v; redraw(); }),
          h('div.sec-h', 'Colour'),
          h('button.btn.sm.wide', { onclick: () => { st.adj = autoEnhanceParams(img); drawSliders(); redraw(); toast('AI auto-enhance applied'); } }, icon('wand'), 'AI auto-enhance'),
          sliders,
          h('div.sec-h', 'Whitening preview'),
          h('p.muted.sm', 'Simulation for patient consultations. Exports are tagged "simulation" — never present it as a real result.'),
          range('Shade lift', 0, 0, 1, 0.05, async v => {
            st.whiten = v;
            if (!m.meta?.face && m.meta?.face !== null) await tryAnalyze(m);
            st.whiteCanvas = v > 0 ? await whitenTeeth(m, v) : null;
            redraw();
          }, v => Math.round(v * 100) + '%'))),
      h('div.modal-foot',
        h('button.btn', { onclick: () => close('copy') }, 'Save as new photo'),
        h('button.btn.primary', { onclick: () => close('replace') }, 'Apply')),
    ];
  }, { wide: true });
  if (!res) return;
  const b = busy('Saving…');
  const full = render(makeCanvas(2, 2), 0);
  const isSim = st.whiten > 0;
  if (res === 'copy' || isSim) {
    await blobFromCanvas(full, m.name.replace(/\.\w+$/, '') + (isSim ? '-whitening-simulation.jpg' : '-edit.jpg'), { caseId: m.caseId, view: m.view, tag: isSim ? '' : m.tag, simulated: isSim });
    if (res === 'replace' && isSim) toast('Simulations are saved as a separate photo');
  } else {
    const blob = await new Promise(r => full.toBlob(r, 'image/jpeg', 0.93));
    const nm = await addMedia(new File([blob], m.name, { type: 'image/jpeg' }), { caseId: m.caseId, view: m.view, tag: m.tag, createdAt: m.createdAt });
    await deleteMedia(m.id);
    await tryAnalyze(nm);
  }
  b.done();
  toast('Photo saved', 'ok');
}
