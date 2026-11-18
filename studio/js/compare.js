// Before/after comparison: slider, side-by-side, onion-skin; AI alignment; export image.
import { h, icon, toast, busy, makeCanvas, downloadBlob, clamp } from './util.js';
import { getMedia, imageEl, getSettings } from './store.js';
import { tryAnalyze, focusOf } from './ai.js';
import { seg, toggle, pickMedia, emptyState } from './ui.js';
import { roundRect } from './engine.js';
import { magicReel } from './studio.js';

export async function renderCompare(main, aId, bId) {
  const settings = await getSettings();
  let A = await getMedia(aId), B = await getMedia(bId);
  const st = { mode: 'slider', pos: 0.5, align: true, labels: true, opacity: 0.5 };
  main.innerHTML = '';
  const cv = h('canvas.cmp-canvas');
  const wrap = h('div.cmp-wrap', cv);
  let ia, ib;

  const pick = async which => {
    const m = await pickMedia({ kinds: ['image'], title: `Choose the ${which} photo`, caseId: (A || B)?.caseId });
    if (!m) return;
    which === 'before' ? (A = m) : (B = m);
    location.hash = `#/compare/${A?.id || ''}/${B?.id || ''}`;
  };
  main.append(h('div.top',
    h('div', h('h1', 'Compare'), h('p.muted', 'AI lines up both smiles (scale, rotation, position) so the change is all that moves.')),
    h('div.actions',
      h('button.btn', { onclick: () => pick('before') }, A ? 'Change before' : 'Choose before'),
      h('button.btn', { onclick: () => pick('after') }, B ? 'Change after' : 'Choose after'),
      A && B && h('button.btn', { onclick: () => exportImg() }, icon('download'), 'Export image'),
      A && B && h('button.btn.primary', { onclick: () => magicReel({ before: A, after: B, caseId: A.caseId }) }, icon('sparkles'), 'Make a reel'))));
  if (!A || !B) {
    main.append(emptyState('compare', 'Pick two photos', 'Choose a before and an after photo of the same view.',
      h('button.btn.primary', { onclick: () => pick(A ? 'after' : 'before') }, A ? 'Choose after' : 'Choose before')));
    return;
  }
  const b = busy('AI aligning smiles…');
  [ia, ib] = await Promise.all([imageEl(A), imageEl(B)]);
  await tryAnalyze(A); await tryAnalyze(B);
  b.done();
  const canAlign = focusOf(A) && focusOf(B);

  const opRow = h('label.row', h('span.row-l', 'After opacity'), h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: st.opacity, oninput: e => { st.opacity = +e.target.value; draw(); } }));
  main.append(
    h('div.cmp-tools',
      seg(st.mode, [['slider', 'Slider'], ['side', 'Side by side'], ['onion', 'Onion skin']], v => { st.mode = v; opRow.style.display = v === 'onion' ? '' : 'none'; draw(); }),
      toggle(canAlign ? 'AI align' : 'AI align (no face found)', st.align && !!canAlign, v => { st.align = v; draw(); }),
      toggle('Labels', st.labels, v => { st.labels = v; draw(); }),
      opRow),
    wrap);
  opRow.style.display = 'none';

  function maps(W, H, rect = { x: 0, y: 0, w: W, h: H }) {
    const s = Math.max(rect.w / ia.naturalWidth, rect.h / ia.naturalHeight);
    const mA = { ix: ia.naturalWidth / 2, iy: ia.naturalHeight / 2, px: rect.x + rect.w / 2, py: rect.y + rect.h / 2, s, r: 0 };
    const sb = Math.max(rect.w / ib.naturalWidth, rect.h / ib.naturalHeight);
    let mB = { ix: ib.naturalWidth / 2, iy: ib.naturalHeight / 2, px: rect.x + rect.w / 2, py: rect.y + rect.h / 2, s: sb, r: 0 };
    const fa = focusOf(A), fb = focusOf(B);
    if (st.align && fa && fb) {
      const P = { x: mA.px + s * (fa.x - mA.ix), y: mA.py + s * (fa.y - mA.iy) };
      return [{ ix: fa.x, iy: fa.y, px: P.x, py: P.y, s: s * 1.04, r: -fa.angle }, { ix: fb.x, iy: fb.y, px: P.x, py: P.y, s: s * 1.04 * fa.ref / fb.ref, r: -fb.angle }];
    }
    return [mA, mB];
  }
  const put = (x, img, m, clip) => {
    x.save(); x.beginPath(); x.rect(clip.x, clip.y, clip.w, clip.h); x.clip();
    x.translate(m.px, m.py); x.rotate(m.r); x.scale(m.s, m.s); x.drawImage(img, -m.ix, -m.iy); x.restore();
  };
  const label = (x, t, px, py, align, size) => {
    x.save(); x.font = `800 ${size}px Inter, system-ui, sans-serif`; x.textBaseline = 'middle';
    const tw = x.measureText(t).width, bw = tw + size * 1.4, bh = size * 1.8, bx = align === 'right' ? px - bw : px;
    x.fillStyle = 'rgba(15,23,42,.65)'; roundRect(x, bx, py - bh / 2, bw, bh, bh / 2); x.fill();
    x.fillStyle = '#fff'; x.fillText(t, bx + size * 0.7, py + 1); x.restore();
  };

  function paint(c, W, H) {
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
    const full = { x: 0, y: 0, w: W, h: H }, size = Math.round(Math.min(W, H) * 0.045);
    if (st.mode === 'side') {
      const g = Math.round(W * 0.006), ra = { x: 0, y: 0, w: W / 2 - g, h: H }, rb = { x: W / 2 + g, y: 0, w: W / 2 - g, h: H };
      const fa = focusOf(A), fb = focusOf(B);
      let [mA2] = maps(W, H, ra), [, mB] = maps(W, H, rb);
      if (st.align && fa && fb) {
        // both smiles centred in their half at the same scale, eye line levelled
        const s0 = Math.max(ra.w / ia.naturalWidth, ra.h / ia.naturalHeight) * 1.1;
        mA2 = { ix: fa.x, iy: fa.y, px: ra.x + ra.w / 2, py: H / 2, s: s0, r: -fa.angle };
        mB = { ix: fb.x, iy: fb.y, px: rb.x + rb.w / 2, py: H / 2, s: s0 * fa.ref / fb.ref, r: -fb.angle };
      }
      x.fillStyle = settings.accent; x.fillRect(0, 0, W, H);
      put(x, ia, mA2, ra); put(x, ib, mB, rb);
      if (st.labels) { label(x, settings.labelBefore, ra.x + size, size * 1.6, 'left', size); label(x, settings.labelAfter, rb.x + size, size * 1.6, 'left', size); }
      return;
    }
    const [mA, mB] = maps(W, H);
    if (st.mode === 'onion') {
      put(x, ia, mA, full); x.globalAlpha = st.opacity; put(x, ib, mB, full); x.globalAlpha = 1;
      if (st.labels) label(x, `${settings.labelAfter} ${Math.round(st.opacity * 100)}%`, size, size * 1.6, 'left', size);
      return;
    }
    const sx = W * st.pos;
    put(x, ib, mB, full); put(x, ia, mA, { x: 0, y: 0, w: sx, h: H });
    x.fillStyle = '#fff'; x.fillRect(sx - 2, 0, 4, H);
    x.beginPath(); x.arc(sx, H / 2, size * 1.1, 0, Math.PI * 2); x.fill();
    x.fillStyle = settings.accent; x.font = `900 ${size}px Inter, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('⇆', sx, H / 2 + 1);
    x.textAlign = 'left';
    if (st.labels) { label(x, settings.labelBefore, size, size * 1.6, 'left', size); label(x, settings.labelAfter, W - size, size * 1.6, 'right', size); }
  }

  function draw() {
    const box = wrap.getBoundingClientRect();
    const ar = ia.naturalWidth / ia.naturalHeight * (st.mode === 'side' ? 2 : 1);
    let w = box.width, hh = w / ar;
    const maxH = Math.max(280, innerHeight - box.top - 30);
    if (hh > maxH) { hh = maxH; w = hh * ar; }
    const dpr = devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
    cv.style.width = w + 'px'; cv.style.height = hh + 'px';
    paint(cv, cv.width, cv.height);
  }
  const drag = e => {
    if (st.mode !== 'slider') return;
    const r = cv.getBoundingClientRect();
    const mv = ev => { st.pos = clamp((ev.clientX - r.left) / r.width, 0, 1); draw(); };
    mv(e);
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  cv.addEventListener('pointerdown', drag);
  async function exportImg() {
    const W = st.mode === 'side' ? 2160 : 1080, H = 1080 * ia.naturalHeight / ia.naturalWidth;
    const c = makeCanvas(W, H);
    paint(c, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.93));
    downloadBlob(blob, `before-after-${st.mode}.jpg`);
    toast('Image exported', 'ok');
  }
  const onR = () => (cv.isConnected ? draw() : removeEventListener('resize', onR));
  addEventListener('resize', onR);
  draw();
}
