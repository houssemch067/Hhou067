// Playback wrapper around Engine: rAF loop, play/pause/seek/loop and canvas fitting.
import { Engine } from './engine.js';
import { clamp } from './util.js';

export class Player {
  constructor(canvas, { scale = 0.5, loop = true, onTime, audio = true } = {}) {
    this.canvas = canvas;
    if (canvas.width === 300 && canvas.height === 150) { canvas.width = 540; canvas.height = 960; } // 9:16 until loaded
    this.engine = new Engine(canvas, { scale, audio, onFrameReady: () => !this.playing && this.draw() });
    this.loop = loop; this.onTime = onTime;
    this.t = 0; this.dur = 0; this.playing = false;
    this.q = Promise.resolve(); this.tok = 0;
  }
  /** Loads (or reloads after an edit) a project. Calls are serialised; stale ones are skipped. */
  load(p) {
    const tok = ++this.tok;
    this.q = this.q.then(async () => {
      if (tok !== this.tok) return;
      await this.engine.prepare(p);
      this.dur = this.engine.duration;
      this.refit?.(); // canvas size (aspect) may have changed
      this.t = clamp(this.t, 0, this.dur);
      if (this.playing) { this.engine.stopAll(); this.t0 = performance.now() - this.t * 1000; this.engine.sync(this.t, true); }
      else { this.engine.sync(this.t, false); this.draw(); }
    }).catch(e => console.error(e));
    return this.q;
  }
  draw() { this.engine.render(this.t); this.onTime?.(this.t, this.dur); }
  async play() {
    await this.q;
    if (!this.dur) return;
    this.engine.audio().resume().catch(() => {});
    if (this.t >= this.dur - 0.05) this.t = 0;
    this.playing = true;
    this.t0 = performance.now() - this.t * 1000;
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (!this.playing) return;
      this.t = (performance.now() - this.t0) / 1000;
      if (this.t >= this.dur) {
        if (this.loop) { this.t = 0; this.t0 = performance.now(); this.engine.stopAll(); }
        else { this.t = this.dur; this.pause(); this.draw(); this.onEnd?.(); return; }
      }
      this.engine.sync(this.t, true);
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    tick();
    this.onState?.(true);
  }
  pause() {
    this.playing = false; cancelAnimationFrame(this.raf);
    this.engine.stopAll(); this.engine.sync(this.t, false);
    this.onState?.(false);
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(t) {
    this.t = clamp(t, 0, this.dur || 0);
    if (this.playing) { this.t0 = performance.now() - this.t * 1000; this.engine.stopAll(); }
    this.engine.sync(this.t, this.playing);
    if (!this.playing) this.draw();
  }
  get audioLocked() { return this.engine.ac && this.engine.ac.state !== 'running'; }
  destroy() { this.playing = false; cancelAnimationFrame(this.raf); this.ro?.disconnect(); this.engine.destroy(); }

  /** Keeps the canvas as large as possible inside `box` while keeping its aspect ratio. */
  fit(box, radius = true) {
    const doFit = () => {
      const r = box.getBoundingClientRect();
      const ar = this.canvas.width / this.canvas.height || 9 / 16;
      let w = r.width, h = w / ar;
      if (h > r.height) { h = r.height; w = h * ar; }
      this.canvas.style.width = Math.floor(w) + 'px';
      this.canvas.style.height = Math.floor(h) + 'px';
      if (radius) this.canvas.style.borderRadius = Math.round(Math.min(w, h) * 0.04) + 'px';
    };
    this.ro?.disconnect();
    this.ro = new ResizeObserver(doFit);
    this.ro.observe(box);
    this.refit = doFit;
    doFit();
  }
}
