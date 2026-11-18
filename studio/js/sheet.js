// Mobile UI kit: bottom sheets, confirm dialog, snap carousel, icon buttons.
import { h, icon } from './util.js';

/** Opens a bottom sheet inside the phone frame. build(close, el) returns content. Resolves on close. */
export function sheet(title, build, { tall = false, onClose, cls = '' } = {}) {
  let done;
  const p = new Promise(r => (done = r));
  const root = document.getElementById('app');
  const close = v => {
    panel.classList.add('out'); back.classList.add('out');
    setTimeout(() => { back.remove(); }, 220);
    onClose?.(v); done(v);
  };
  const body = h('div.sheet-body');
  const panel = h('div.sheet' + (tall ? '.tall' : '') + (cls ? '.' + cls : ''),
    h('div.grab'),
    title && h('div.sheet-head', h('b', title), h('button.ibtn.sm', { onclick: () => close(null), 'aria-label': 'Close' }, icon('x', 18))),
    body);
  const back = h('div.sheet-back', { onclick: e => e.target === back && close(null) }, panel);
  // swipe down on the handle / header to dismiss
  let y0 = null;
  panel.addEventListener('pointerdown', e => { if (e.target.closest('.grab, .sheet-head') && !e.target.closest('button')) { y0 = e.clientY; panel.setPointerCapture(e.pointerId); } });
  panel.addEventListener('pointermove', e => { if (y0 != null) panel.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
  panel.addEventListener('pointerup', e => { if (y0 == null) return; const d = e.clientY - y0; y0 = null; panel.style.transform = ''; if (d > 90) close(null); });
  const content = build(close, body);
  body.append(...[].concat(content).filter(Boolean));
  root.append(back);
  return Object.assign(p, { close, el: panel, body });
}

export function confirmSheet(title, text, ok = 'Confirm', danger = false) {
  return sheet(title, close => [
    h('p.sheet-text', text),
    h('div.sheet-actions',
      h('button.pill.ghost', { onclick: () => close(false) }, 'Cancel'),
      h('button.pill' + (danger ? '.danger' : '.white'), { onclick: () => close(true) }, ok)),
  ]);
}

/**
 * Instagram-style snap carousel: the item under the centre ring is selected.
 * items: [{node, ...}] ; onSelect(index) ; returns {el, select(i), index}
 */
export function snapCarousel(items, { onSelect, onTapCenter, itemSize = 64, gap = 14, start = 0 } = {}) {
  const track = h('div.snap-track', { style: { gap: gap + 'px', paddingInline: `calc(50% - ${itemSize / 2}px)` } });
  const el = h('div.snap', track);
  let index = start, timer, programmatic = false;
  items.forEach((it, i) => {
    const b = h('button.snap-item', { style: { width: itemSize + 'px', height: itemSize + 'px' }, onclick: () => (i === index ? onTapCenter?.(i) : select(i)) }, it.node);
    track.append(b);
  });
  const pos = i => i * (itemSize + gap);
  function mark() { [...track.children].forEach((c, i) => c.classList.toggle('on', i === index)); }
  function select(i, smooth = true) {
    index = Math.max(0, Math.min(items.length - 1, i));
    programmatic = true;
    el.scrollTo({ left: pos(index), behavior: smooth ? 'smooth' : 'auto' });
    mark(); onSelect?.(index);
    clearTimeout(timer); timer = setTimeout(() => (programmatic = false), 450);
  }
  el.addEventListener('scroll', () => {
    if (programmatic) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const i = Math.round(el.scrollLeft / (itemSize + gap));
      if (i !== index) { index = Math.max(0, Math.min(items.length - 1, i)); mark(); onSelect?.(index); }
      el.scrollTo({ left: pos(index), behavior: 'smooth' });
    }, 90);
  }, { passive: true });
  requestAnimationFrame(() => { el.scrollLeft = pos(index); mark(); });
  return { el, select, get index() { return index; } };
}

export const ibtn = (ic, label, onclick, extra = {}) =>
  h('button.ibtn', { onclick, 'aria-label': label, title: label, ...extra }, typeof ic === 'string' ? icon(ic, 24) : ic);

export function railBtn(ic, label, onclick) {
  return h('button.rail-btn', { onclick, 'aria-label': label },
    h('span.rail-ic', typeof ic === 'string' ? (ic.length <= 2 || /\p{Extended_Pictographic}/u.test(ic) ? h('span.rail-txt', ic) : icon(ic, 24)) : ic),
    h('span.rail-lbl', label));
}
