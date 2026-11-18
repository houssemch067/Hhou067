// Clinic branding sheet.
import { h, toast, pickFiles } from './util.js';
import { getSettings, saveSettings, addMedia, getMedia } from './store.js';
import { sheet } from './sheet.js';

const ACCENTS = ['#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b', '#22c55e', '#0ea5e9', '#d4af37', '#111827'];
const LANGS = [['EN', 'BEFORE', 'AFTER'], ['FR', 'AVANT', 'APRÈS'], ['ES', 'ANTES', 'DESPUÉS'], ['AR', 'قبل', 'بعد'], ['DE', 'VORHER', 'NACHHER'], ['IT', 'PRIMA', 'DOPO']];

export async function settingsSheet() {
  const s = { ...(await getSettings()) };
  const logo = s.logoMediaId && await getMedia(s.logoMediaId);
  await sheet('Your clinic', close => {
    const field = (label, key, ph) => h('label.field', h('span', label), h('input', { value: s[key] || '', placeholder: ph, oninput: e => (s[key] = e.target.value) }));
    const dots = h('div.dots', ...ACCENTS.map(c => h('button.dot' + (c === s.accent ? '.on' : ''), { style: { background: c }, onclick: e => { s.accent = c; [...dots.children].forEach(d => d.classList.toggle('on', d === e.currentTarget)); } })));
    const logoBox = h('div.logo-row',
      logo?.thumb ? h('img.logo-prev', { src: logo.thumb }) : h('span.muted', 'No logo'),
      h('button.pill.ghost.sm', { onclick: async () => { const [f] = await pickFiles('image/*', false); if (!f) return; const m = await addMedia(f, { name: 'Clinic logo', caseId: '__brand' }); s.logoMediaId = m.id; logoBox.firstChild.replaceWith(h('img.logo-prev', { src: m.thumb })); } }, 'Upload logo'));
    const langs = h('div.chips', ...LANGS.map(([code, b, a]) => h('button.chip' + (s.labelBefore === b ? '.on' : ''), { onclick: e => { s.labelBefore = b; s.labelAfter = a; [...langs.children].forEach(d => d.classList.toggle('on', d === e.currentTarget)); } }, `${code} · ${b}/${a}`)));
    return [
      h('p.sheet-text', 'Shown on outros, watermarks and call-to-action stickers in every reel.'),
      field('Clinic name', 'clinic', 'Smile Studio'),
      field('Instagram / TikTok handle', 'handle', '@yourclinic'),
      field('Phone', 'phone', '+1 555 123 456'),
      field('Website', 'website', 'yourclinic.com'),
      h('div.field', h('span', 'Brand colour'), dots),
      h('div.field', h('span', 'Logo (watermark)'), logoBox),
      h('div.field', h('span', 'Before / After labels'), langs),
      h('label.switch-row', h('span', 'Watermark new reels'), h('input', { type: 'checkbox', checked: s.watermark, onchange: e => (s.watermark = e.target.checked) })),
      h('p.sheet-text.sm', 'Photos never leave this device. Always get the patient\'s written consent before posting.'),
      h('div.sheet-actions', h('button.pill.white.wide', { onclick: async () => { await saveSettings(s); toast('Saved ✓'); close(true); } }, 'Save')),
    ];
  }, { tall: true });
}
