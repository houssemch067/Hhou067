// Drafts: all reels on this device.
import { h, icon } from './util.js';
import { allProjects, getMedia } from './store.js';
import { layoutTimeline } from './engine.js';
import { fmtTime } from './util.js';
import { resetPick } from './flow.js';

export async function renderDrafts(main) {
  const list = await allProjects();
  main.innerHTML = '';
  const grid = h('div.drafts-grid',
    h('a.draft.new', { href: '#/', onclick: () => resetPick() }, icon('plus', 34), h('b', 'New reel')));
  for (const p of list) {
    const m = await getMedia(p.inputs?.after || p.clips.find(c => c.mediaId)?.mediaId);
    grid.append(h('a.draft', { href: '#/edit/' + p.id, style: { backgroundImage: m?.thumb ? `url(${m.thumb})` : '' } },
      h('span.draft-dur', icon('play', 12), fmtTime(layoutTimeline(p), false)),
      h('span.draft-name', p.name)));
  }
  main.append(h('div.screen.drafts-screen',
    h('div.top-bar.solid', h('span', { style: { width: '44px' } }), h('b.top-title', 'Drafts'), h('span', { style: { width: '44px' } })),
    h('div.drafts-body', list.length ? null : h('p.drafts-empty', 'No reels yet — take a before & after photo to make your first one.'), grid),
    h('div.modes.solid', ...[['photo', 'PHOTO'], ['', 'REEL'], ['drafts', 'DRAFTS']].map(([k, l]) => h('button' + (k === 'drafts' ? '.on' : ''), { onclick: () => (location.hash = '#/' + k) }, l)))));
}
