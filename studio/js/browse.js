// Template browser: live full-screen preview of every template with YOUR photos + music.
import { h, icon, toast, makeCanvas } from './util.js';
import { getSettings, saveProject, getMedia, imageEl } from './store.js';
import { tryAnalyze, autoEnhanceParams } from './ai.js';
import { Engine } from './engine.js';
import { Player } from './player.js';
import { TEMPLATES, buildTemplate } from './templates.js';
import { snapCarousel, ibtn } from './sheet.js';
import { pick, loadPick } from './flow.js';

/** Applies AI colour correction to every photo clip of a project. */
export async function enhanceProject(p) {
  for (const c of p.clips) {
    for (const [key, id] of [['filter', c.mediaId], ['filter2', c.mediaId2]]) {
      const m = id ? await getMedia(id) : null;
      if (m?.kind !== 'image') continue;
      const ae = autoEnhanceParams(await imageEl(m));
      c[key] = { ...ae, ...(c[key] && c[key].saturate < 0.9 ? { saturate: c[key].saturate } : {}) };
    }
  }
}

export async function renderBrowse(main) {
  await loadPick();
  if (!pick.before || !pick.after) { location.hash = '#/'; return; }
  const settings = await getSettings();
  main.innerHTML = '';
  const canvas = h('canvas.stage-canvas');
  const stage = h('div.stage', canvas);
  const soundHint = h('button.sound-hint', { onclick: () => { player.engine.audio().resume(); soundHint.style.display = 'none'; if (!player.playing) player.play(); } }, icon('volume', 16), 'Tap for sound');
  const name = h('div.tpl-name'), tag = h('span.tpl-tag'), desc = h('div.tpl-desc');
  const loading = h('div.stage-loading', h('div.spinner'), h('span', 'AI is matching both smiles…'));
  const thumbs = TEMPLATES.map(() => h('span.tthumb'));
  let index = Math.max(0, TEMPLATES.findIndex(t => t.id === sessionStorage.getItem('ds-last-tpl')));
  const car = snapCarousel(TEMPLATES.map((t, i) => ({ node: thumbs[i] })), {
    onSelect: i => show(i), onTapCenter: () => use(), itemSize: 64, gap: 14, start: index,
  });
  const useBtn = h('button.shutter.use', { 'aria-label': 'Use template', onclick: () => use() }, icon('check', 30));
  const swapBtn = ibtn('swap', 'Swap before / after', () => { [pick.before, pick.after] = [pick.after, pick.before]; projects.clear(); show(index, true); toast('Swapped before ↔ after'); });
  const top = h('div.top-bar',
    ibtn('back', 'Back', () => history.length > 1 ? history.back() : (location.hash = '#/')),
    h('div.pair', h('img', { src: pick.before.thumb }), icon('next', 14), h('img', { src: pick.after.thumb })),
    swapBtn);
  main.append(h('div.screen.browse-screen', stage, top, soundHint, loading,
    h('div.browse-bottom', h('div.tpl-info', h('div.tpl-row', name, tag), desc), h('div.shutter-row', car.el, useBtn),
      h('button.pill.white.next-pill', { onclick: () => use() }, 'Use template', icon('next', 18)))));

  const player = new Player(canvas, { scale: 0.5, loop: true });
  player.fit(stage);
  stage.addEventListener('click', () => { player.engine.audio().resume(); soundHint.style.display = 'none'; player.toggle(); });
  // swipe between templates
  let sx = null;
  stage.addEventListener('pointerdown', e => (sx = e.clientX));
  stage.addEventListener('pointerup', e => { if (sx != null && Math.abs(e.clientX - sx) > 60) car.select(index + (e.clientX < sx ? 1 : -1)); sx = null; });

  await tryAnalyze(pick.before); await tryAnalyze(pick.after);
  for (const m of pick.extras) if (m.kind === 'image') await tryAnalyze(m);
  const projects = new Map();
  const make = async i => {
    if (!projects.has(i)) {
      const p = buildTemplate(TEMPLATES[i].id, { before: pick.before, after: pick.after, extras: pick.extras, settings, treatment: '' });
      await enhanceProject(p);
      projects.set(i, p);
    }
    return projects.get(i);
  };
  loading.lastChild.textContent = 'Building your reel…';

  async function show(i, force) {
    if (i === index && !force && player.p) return;
    index = i;
    const t = TEMPLATES[i];
    name.textContent = t.name; tag.textContent = t.tag; desc.textContent = t.desc;
    const p = await make(i);
    if (index !== i) return;
    player.p = p;
    player.t = 0;
    await player.load(p);
    player.play();
    setTimeout(() => { if (player.audioLocked) soundHint.style.display = ''; }, 400);
  }
  async function use() {
    const p = await make(index);
    p.createdAt = p.updatedAt = Date.now();
    await saveProject(p);
    sessionStorage.setItem('ds-last-tpl', TEMPLATES[index].id);
    location.hash = '#/edit/' + p.id;
  }
  soundHint.style.display = 'none';
  await show(index, true);
  loading.remove();

  // thumbnails: one frame of each template at its reveal
  (async () => {
    const c = makeCanvas(2, 2);
    const eng = new Engine(c, { scale: 0.12, audio: false });
    for (let i = 0; i < TEMPLATES.length; i++) {
      if (!main.isConnected) break;
      const p = await make(i);
      await eng.prepare(p);
      eng.render(p.drop != null ? p.drop + 1 : eng.duration * 0.4);
      thumbs[i].style.backgroundImage = `url(${c.toDataURL('image/jpeg', 0.8)})`;
    }
    eng.destroy();
  })();

  return () => player.destroy();
}
