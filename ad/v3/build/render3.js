// usage: node render.js preview t1 t2 ...   |   node render.js video
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const S = __dirname;
const FPS = 30, DUR = 43.4;
const html = fs.readFileSync(path.join(S, 'ad3.html'), 'utf8').replace('__META__', fs.readFileSync(path.join(S, 'dg2/meta.json'), 'utf8')).replace('__TIMING__', fs.readFileSync(path.join(S, 'v3/timing.json'), 'utf8'));
fs.writeFileSync(path.join(S, 'ad3.built.html'), html);

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto('file://' + path.join(S, 'ad3.built.html'));
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))));
  const mode = process.argv[2];
  if (mode === 'preview') {
    fs.mkdirSync(path.join(S, 'prev3'), { recursive: true });
    for (const t of process.argv.slice(3)) {
      await p.evaluate(t => R(+t), t);
      await p.screenshot({ path: path.join(S, 'prev3', `t${t}.jpg`), type: 'jpeg', quality: 80 });
    }
  } else {
    const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', path.join(S, 'video3_noaudio.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] });
    const n = Math.round(DUR * FPS);
    for (let i = 0; i < n; i++) {
      await p.evaluate(t => R(t), i / FPS);
      const buf = await p.screenshot({ type: 'jpeg', quality: 93 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 60 === 0) process.stdout.write(`frame ${i}/${n}\n`);
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
  }
  await b.close();
})();
