// Reusable form controls + media picker.
import { h, icon, modal, fmtTime, esc } from './util.js';
import { allMedia, allCases } from './store.js';

export const row = (label, ...ctl) => h('label.row', h('span.row-l', label), h('div.row-c', ...ctl));

export function range(label, value, min, max, step, onInput, fmt = v => v) {
  const out = h('span.rv', fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value });
  inp.addEventListener('input', () => { out.textContent = fmt(+inp.value); onInput(+inp.value); });
  return row(label, inp, out);
}
export function num(label, value, min, max, step, onChange, suffix = '') {
  const inp = h('input.num', { type: 'number', min, max, step, value: +(+value).toFixed(2) });
  inp.addEventListener('change', () => onChange(Math.min(max, Math.max(min, +inp.value || 0))));
  return row(label, inp, suffix && h('span.muted', suffix));
}
export function select(label, value, options, onChange) {
  const s = h('select', ...options.map(o => {
    const [v, t] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v, selected: v === value }, t);
  }));
  s.addEventListener('change', () => onChange(s.value));
  return label ? row(label, s) : s;
}
export function color(label, value, onInput) {
  const inp = h('input', { type: 'color', value: toHex(value) });
  inp.addEventListener('input', () => onInput(inp.value));
  return row(label, inp);
}
export function toggle(label, checked, onChange) {
  const inp = h('input', { type: 'checkbox', checked });
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('label.toggle', inp, h('span.sw'), h('span', label));
}
export function text(label, value, onInput, { area = false, placeholder = '' } = {}) {
  const inp = h(area ? 'textarea' : 'input', { value, placeholder, rows: area ? 3 : undefined });
  if (area) inp.value = value;
  inp.addEventListener('input', () => onInput(inp.value));
  return label ? row(label, inp) : inp;
}
export function seg(value, options, onChange) {
  const wrap = h('div.seg');
  options.forEach(([v, t]) => {
    const b = h('button' + (v === value ? '.on' : ''), { type: 'button', onclick: () => { [...wrap.children].forEach(x => x.classList.remove('on')); b.classList.add('on'); onChange(v); } }, t);
    wrap.append(b);
  });
  return wrap;
}
export const section = (title, ...kids) => h('div.sec', h('div.sec-h', title), ...kids);

function toHex(c) {
  if (!c) return '#000000';
  if (c.startsWith('#') && c.length === 7) return c;
  const m = c.match(/\d+(\.\d+)?/g);
  if (!m) return '#000000';
  return '#' + m.slice(0, 3).map(n => (+n | 0).toString(16).padStart(2, '0')).join('');
}

export function mediaThumb(m, extra = {}) {
  return h('div.mthumb', extra,
    m.thumb ? h('img', { src: m.thumb, alt: '', loading: 'lazy', draggable: false }) : h('div.mthumb-audio', icon('music', 26)),
    m.kind !== 'image' && h('span.badge.dur', fmtTime(m.duration, false)),
    m.tag && h('span.badge.tag.' + m.tag, m.tag),
    m.kind === 'audio' && h('span.mname', m.name));
}

/** Modal grid to pick one (or several) media items. */
export async function pickMedia({ kinds = ['image', 'video'], title = 'Choose media', multi = false, caseId = null } = {}) {
  const all = (await allMedia()).filter(m => kinds.includes(m.kind));
  const cases = await allCases();
  let filter = caseId || '';
  const chosen = new Set();
  return modal(title, close => {
    const grid = h('div.pick-grid');
    const draw = () => {
      grid.innerHTML = '';
      const list = all.filter(m => !filter || m.caseId === filter);
      if (!list.length) grid.append(h('p.muted', 'Nothing here yet — import or capture photos first.'));
      list.forEach(m => {
        const t = mediaThumb(m, { class: 'mthumb' + (chosen.has(m.id) ? ' sel' : ''), title: m.name });
        t.onclick = () => {
          if (!multi) return close(m);
          chosen.has(m.id) ? chosen.delete(m.id) : chosen.add(m.id);
          t.classList.toggle('sel');
        };
        grid.append(t);
      });
    };
    draw();
    return [
      cases.length ? h('div.pick-bar', select('Case', filter, [['', 'All media'], ...cases.map(c => [c.id, c.patient || 'Untitled case'])], v => { filter = v; draw(); })) : null,
      grid,
      multi && h('div.modal-foot', h('button.btn.primary', { onclick: () => close(all.filter(m => chosen.has(m.id))) }, 'Use selected')),
    ];
  }, { wide: true });
}

export function emptyState(ic, title, sub, ...actions) {
  return h('div.empty', icon(ic, 44), h('h3', title), h('p.muted', sub), h('div.actions', ...actions));
}
export { esc };
