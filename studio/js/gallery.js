// Gallery sheet: pick BEFORE, AFTER (+ extra shots) from saved media or the device.
import { h, icon, toast, busy, pickFiles } from './util.js';
import { allMedia, addMedia, deleteMedia } from './store.js';
import { tryAnalyze } from './ai.js';
import { sheet, confirmSheet } from './sheet.js';

const ROLE = ['Before', 'After'];

/** Returns {before, after, extras} or null. With single:true returns one media item. */
export function gallerySheet({ single = false, kinds = ['image', 'video'], title } = {}) {
  const chosen = [];
  let manage = false;
  return sheet(title || (single ? 'Choose a photo' : 'Select Before → After'), (close, body) => {
    const grid = h('div.gal-grid');
    const hint = h('div.gal-hint');
    const next = h('button.pill.white', { disabled: true, onclick: () => close({ before: chosen[0], after: chosen[1], extras: chosen.slice(2) }) }, 'Next', icon('next', 18));
    const manageBtn = h('button.pill.ghost.sm', { onclick: () => { manage = !manage; manageBtn.textContent = manage ? 'Done' : 'Edit'; draw(); } }, 'Edit');
    async function draw() {
      const list = (await allMedia()).filter(m => kinds.includes(m.kind) && m.caseId !== '__brand');
      grid.replaceChildren(
        h('button.gal-cell.gal-import', { onclick: importFiles }, icon('upload', 26), h('span', 'Import')),
        ...list.map(m => {
          const i = chosen.indexOf(m);
          const cell = h('button.gal-cell' + (i >= 0 ? '.sel' : ''), {
            onclick: async () => {
              if (manage) {
                if (await confirmSheet('Delete photo?', 'It will be removed from this device.', 'Delete', true)) { await deleteMedia(m.id); const k = chosen.indexOf(m); if (k >= 0) chosen.splice(k, 1); draw(); }
                return;
              }
              if (single) return close(m);
              const k = chosen.indexOf(m);
              k >= 0 ? chosen.splice(k, 1) : chosen.length < 8 && chosen.push(m);
              draw();
            },
          },
          h('img', { src: m.thumb, alt: '', loading: 'lazy', draggable: false }),
          m.kind === 'video' && h('span.gal-dur', icon('video', 12)),
          i >= 0 && h('span.gal-badge', i < 2 ? ROLE[i] : `+${i - 1}`),
          manage && h('span.gal-del', icon('trash', 14)));
          return cell;
        }));
      if (!list.length) grid.append(h('p.gal-empty', 'Import your before & after photos to get started.'));
      hint.replaceChildren(single ? '' : chosen.length === 0 ? h('span', 'Tap your ', h('b', 'BEFORE'), ' photo') : chosen.length === 1 ? h('span', 'Now tap the ', h('b', 'AFTER'), ' photo') : h('span', 'Add more shots (optional) or tap Next'));
      next.disabled = chosen.length < 2;
    }
    async function importFiles() {
      const files = await pickFiles(kinds.includes('video') ? 'image/*,video/*' : 'image/*');
      if (!files.length) return;
      const b = busy('Importing…');
      try {
        for (const f of files) {
          const m = await addMedia(f);
          if (m.kind === 'image') { b.set('AI is reading the smile…'); await tryAnalyze(m); }
          if (single) { b.done(); return close(m); }
          if (chosen.length < 8) chosen.push(m);
        }
      } catch (e) { toast('Import failed: ' + e.message, 'err'); }
      b.done(); draw();
    }
    draw();
    return [h('div.gal-bar', hint, manageBtn), grid, !single && h('div.gal-foot', next)];
  }, { tall: true });
}
