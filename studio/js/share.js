// Share screen: cover, AI caption ideas, render to MP4, share / download.
import { h, icon, toast, downloadBlob } from './util.js';
import { db, getSettings, addMedia } from './store.js';
import { Player } from './player.js';
import { captionIdeas } from './ai.js';
import { exportProject, exportFrame, pickMime } from './exporter.js';
import { ibtn } from './sheet.js';

export async function renderShare(main, id) {
  const p = await db.get('projects', id);
  if (!p) { location.hash = '#/drafts'; return; }
  const settings = await getSettings();
  main.innerHTML = '';
  const canvas = h('canvas.cover-canvas');
  const coverBox = h('div.cover-box', canvas);
  const ideas = captionIdeas({ treatment: p.inputs?.treatment || 'smile makeover', clinic: settings.clinic, handle: settings.handle });
  const caption = h('textarea.caption-in', { rows: 6, placeholder: 'Write a caption…' });
  caption.value = p.caption || ideas[0];
  caption.oninput = () => { p.caption = caption.value; db.put('projects', p); };
  let quality = '1080p';
  const mime = pickMime();
  const status = h('div.share-status');
  const saveBtn = h('button.pill.white.wide.big', { onclick: render }, icon('download', 20), 'Save video');
  main.append(h('div.screen.share-screen',
    h('div.top-bar.solid', ibtn('back', 'Back', () => (location.hash = '#/edit/' + p.id)), h('b.top-title', 'Share'), h('span', { style: { width: '44px' } })),
    h('div.share-body',
      h('div.share-row', coverBox, h('div.share-cap', caption,
        h('div.chips.scroll', ...ideas.map((c, i) => h('button.chip', { onclick: () => { caption.value = c; p.caption = c; db.put('projects', p); } }, `Idea ${i + 1}`))))),
      h('div.share-opt', h('span', 'Quality'), h('div.seg-pill', ...['1080p', '720p'].map(q => h('button' + (q === quality ? '.on' : ''), { onclick: e => { quality = q; [...e.currentTarget.parentNode.children].forEach(b => b.classList.toggle('on', b === e.currentTarget)); } }, q)))),
      h('p.share-note', mime.includes('mp4') ? 'MP4 · H.264 · 30 fps — ready for Instagram, TikTok, WhatsApp & YouTube Shorts.' : mime ? 'Your browser saves WebM. For Instagram use Chrome, Edge or Safari to get MP4.' : 'This browser cannot record video — please use Chrome, Edge or Safari.'),
      status, saveBtn,
      h('button.pill.ghost.wide', { onclick: async () => { const b = await exportFrame(p, coverT); downloadBlob(b, slug(p.name) + '-cover.png'); } }, icon('image', 18), 'Save cover image'))));

  const player = new Player(canvas, { scale: 0.35, loop: true, audio: false });
  await player.load(p);
  player.fit(coverBox);
  const coverT = p.drop != null ? Math.min(player.dur - 0.1, p.drop + 1.2) : player.dur * 0.4;
  player.seek(coverT);
  player.play();

  async function render() {
    if (!mime) return toast('Video recording is not supported in this browser', 'err');
    player.pause();
    const sig = { cancelled: false };
    const ring = h('div.ring', h('span', '0%'));
    const ov = h('div.render-ov', ring, h('b', 'Creating your reel…'), h('p', 'Keep this screen open — it renders in real time.'),
      h('button.pill.ghost', { onclick: () => { sig.cancelled = true; ov.remove(); } }, 'Cancel'));
    main.querySelector('.share-screen').append(ov);
    try {
      const res = await exportProject(p, { quality, signal: sig, onProgress: v => { ring.style.setProperty('--p', v * 100); ring.firstChild.textContent = Math.round(v * 100) + '%'; } });
      ov.remove();
      if (!res) return;
      const file = new File([res.blob], `${slug(p.name)}.${res.ext}`, { type: res.mime });
      addMedia(file, { kind: 'video', name: file.name }).catch(() => {});
      const canShare = navigator.canShare?.({ files: [file] });
      status.replaceChildren(
        h('video.result', { src: URL.createObjectURL(res.blob), controls: true, playsInline: true, autoplay: true, loop: true, muted: true }),
        h('div.result-actions',
          canShare && h('button.pill.white', { onclick: async () => { try { await navigator.clipboard?.writeText(caption.value); } catch { /* ignore */ } navigator.share({ files: [file], text: caption.value }).catch(() => {}); } }, icon('share', 18), 'Share'),
          h('button.pill' + (canShare ? '.ghost' : '.white'), { onclick: () => downloadBlob(res.blob, file.name) }, icon('download', 18), 'Download'),
          h('button.pill.ghost', { onclick: () => navigator.clipboard.writeText(caption.value).then(() => toast('Caption copied ✓')) }, icon('copy', 18), 'Copy caption')));
      saveBtn.textContent = 'Render again';
      toast('Your reel is ready 🎉');
      status.scrollIntoView({ behavior: 'smooth' });
    } catch (e) { ov.remove(); toast('Export failed: ' + e.message, 'err'); }
  }
  return () => player.destroy();
}
const slug = s => (s || 'reel').replace(/[^\w-]+/g, '_').slice(0, 60);
