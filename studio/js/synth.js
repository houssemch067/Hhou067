// Built-in royalty-free soundtrack + sound effects, synthesised in the browser.
// Music is arranged around the project's "drop" (the reveal): a build-up before, full beat after.
// SFX (whooshes, impacts, ticks, sparkles…) are placed automatically on cuts, reveals and stickers.

const SR = 44100;
const cache = new Map();

export const MUSIC = [
  { id: 'glowup', name: 'Glow Up', desc: 'Bright pop-trap · build & drop', emoji: '✨' },
  { id: 'phonk', name: 'Drift Phonk', desc: 'Cowbell · heavy 808 · viral energy', emoji: '🔥' },
  { id: 'house', name: 'Reveal House', desc: 'Four-on-the-floor · feel good', emoji: '🪩' },
  { id: 'cinematic', name: 'Epic Reveal', desc: 'Ticking tension · taiko · boom', emoji: '🎬' },
  { id: 'lofi', name: 'Soft Lo-fi', desc: 'Warm keys · vinyl · calm', emoji: '☕' },
  { id: 'none', name: 'No music', desc: 'Sound effects only', emoji: '🔇' },
];

/** Loading-bar progress curve (0..1) — fast, slow, then a final rush. Shared with the renderer. */
export function loadingProgress(u) {
  u = Math.min(1, Math.max(0, u));
  const v = u < 0.3 ? (u / 0.3) * 0.42 : u < 0.78 ? 0.42 + ((u - 0.3) / 0.48) * 0.47 : 0.89 + ((u - 0.78) / 0.22) * 0.11;
  return Math.min(1, Math.floor(v * 100 + 1e-6) / 100);
}

/** Every sound effect implied by the edit, as [{t, type}]. Requires layoutTimeline() first. */
export function soundEvents(p) {
  const ev = [];
  const add = (t, type) => t >= 0 && ev.push({ t: +t.toFixed(3), type });
  p.clips.forEach((c, i) => {
    const n = p.clips[i + 1];
    const d = c.duration;
    if (n) {
      const tr = c.transition?.type || 'none', mid = n._start + (c._tr || 0) / 2;
      if (['slide', 'push', 'whip', 'wipe', 'zoom', 'circle'].includes(tr)) add(n._start - 0.05, 'whoosh');
      else if (tr === 'glitch') add(n._start, 'glitch');
      else if (tr === 'punch') { add(n._start - 0.1, 'whoosh'); add(mid, 'hit'); }
      else if (tr === 'flash') add(mid, 'snap');
      else if (tr === 'shake') add(mid, 'hit');
    }
    if (c.fx?.sparkle) add(c._start + Math.min(0.6, d * 0.25), 'sparkle');
    switch (c.layout) {
      case 'polaroid': add(c._start + d * (0.04 + 0.16 * 0.62), 'shutter'); add(c._start + d * (0.42 + 0.16 * 0.62), 'shutter'); break;
      case 'lens': add(c._start + d * 0.06, 'whoosh'); add(c._start + d * 0.72, 'whoosh'); break;
      case 'blinds': add(c._start + d * 0.12, 'whoosh'); break;
      case 'wipe': case 'diagonal': add(c._start + d * 0.18, 'whoosh'); break;
    }
  });
  for (const o of p.overlays) {
    switch (o.kind) {
      case 'loading': {
        let last = 0;
        for (let x = 0; x <= o.duration * 0.92; x += 0.01) {
          const v = Math.floor(loadingProgress(x / (o.duration * 0.92)) * 10);
          if (v > last) { last = v; add(o.start + x, v >= 10 ? 'ding' : 'tick'); }
        }
        break;
      }
      case 'countdown': {
        const n = (o.text || '3,2,1').split(',').length;
        for (let k = 0; k < n; k++) add(o.start + (o.duration / n) * k, 'beep');
        break;
      }
      case 'emoji': case 'rating': case 'cta': add(o.start, 'pop'); break;
      case 'confetti': add(o.start, 'confetti'); break;
    }
  }
  if (p.drop != null && p.drop > 0) {
    add(Math.max(0, p.drop - 60 / (p.bpm || 120) * 2), 'riser');
    add(p.drop, 'impact');
  }
  return ev.sort((a, b) => a.t - b.t);
}

/** Renders {music, sfx} AudioBuffers for a project (cached). Returns null when silent. */
export function renderSoundtrack(p, dur) {
  const st = p.soundtrack || {};
  const style = p.audio ? 'none' : st.style || 'none';
  const ev = st.sfx === false ? [] : soundEvents(p);
  if (style === 'none' && !ev.length) return Promise.resolve(null);
  const key = JSON.stringify([style, p.bpm || 120, +dur.toFixed(2), p.drop ?? null, ev]);
  if (cache.has(key)) return cache.get(key);
  const job = (async () => ({
    key,
    music: style !== 'none' ? await render(dur + 2, k => composeMusic(k, style, p.bpm || 120, dur, p.drop)) : null,
    sfx: ev.length ? await render(dur + 2.5, k => ev.forEach(e => SFX[e.type]?.(k, e.t, p.bpm || 120))) : null,
  }))();
  cache.set(key, job);
  if (cache.size > 16) cache.delete(cache.keys().next().value);
  job.catch(() => cache.delete(key));
  return job;
}

async function render(len, fn) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil(len * SR), SR);
  const k = kit(ctx, len);
  fn(k);
  return ctx.startRendering();
}

// ---------------------------------------------------------------- instruments
function kit(ctx, len) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
  const fade = ctx.createGain();
  const master = ctx.createGain(); master.gain.value = 0.72;
  comp.connect(fade); fade.connect(master); master.connect(ctx.destination);
  const rev = ctx.createConvolver(); rev.buffer = impulse(ctx, 2.4);
  const revOut = ctx.createGain(); revOut.gain.value = 0.32; rev.connect(revOut); revOut.connect(comp);
  const noise = ctx.createBuffer(1, SR * 2, SR);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  return { ctx, out: comp, rev, fade, noise, len };
}
function impulse(ctx, sec) {
  const b = ctx.createBuffer(2, Math.floor(SR * sec), SR);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  }
  return b;
}
const T0 = 0.0001;
function env(k, t, peak, attack, decay, dest = k.out) {
  const g = k.ctx.createGain();
  g.gain.setValueAtTime(T0, t);
  g.gain.exponentialRampToValueAtTime(Math.max(T0 * 2, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(T0, t + attack + decay);
  g.connect(dest);
  return g;
}
function send(k, node, amt) { const g = k.ctx.createGain(); g.gain.value = amt; node.connect(g); g.connect(k.rev); }
function osc(k, type, f, t, dur) { const o = k.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + dur); return o; }
function nz(k, t, dur) { const s = k.ctx.createBufferSource(); s.buffer = k.noise; s.loop = true; s.start(t, Math.random() * 1.5); s.stop(t + dur); return s; }
function filt(k, type, f, q = 0.7) { const b = k.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
function shaper(k, amt) {
  const s = k.ctx.createWaveShaper(), n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = Math.tanh(x * (1 + amt * 8)); }
  s.curve = c; return s;
}
const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; };

const I = {
  kick(k, t, v = 1) {
    const o = osc(k, 'sine', 155, t, 0.5);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(env(k, t, v, 0.002, 0.42));
    chain(nz(k, t, 0.02), filt(k, 'highpass', 3000), env(k, t, v * 0.25, 0.001, 0.012));
  },
  snare(k, t, v = 0.6) {
    const g = env(k, t, v, 0.001, 0.17);
    chain(nz(k, t, 0.25), filt(k, 'bandpass', 1900, 0.9), g); send(k, g, 0.25);
    osc(k, 'triangle', 190, t, 0.15).connect(env(k, t, v * 0.5, 0.001, 0.09));
  },
  clap(k, t, v = 0.7) {
    const g = k.ctx.createGain();
    g.gain.setValueAtTime(T0, t);
    for (let i = 0; i < 3; i++) { g.gain.setValueAtTime(v, t + i * 0.011); g.gain.exponentialRampToValueAtTime(v * 0.15, t + i * 0.011 + 0.009); }
    g.gain.setValueAtTime(v * 0.8, t + 0.034); g.gain.exponentialRampToValueAtTime(T0, t + 0.26);
    g.connect(k.out); send(k, g, 0.35);
    chain(nz(k, t, 0.3), filt(k, 'bandpass', 1250, 1.1), g);
  },
  hat(k, t, v = 0.2, open = false) { chain(nz(k, t, 0.3), filt(k, 'highpass', 7200), env(k, t, v, 0.001, open ? 0.22 : 0.045)); },
  bass(k, t, f, dur, v = 0.7, drive = 0) {
    const o = osc(k, 'sine', f * 1.45, t, dur + 0.5);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const g = k.ctx.createGain();
    g.gain.setValueAtTime(T0, t); g.gain.exponentialRampToValueAtTime(v, t + 0.006);
    g.gain.setTargetAtTime(T0, t + dur * 0.75, 0.07);
    const lp = filt(k, 'lowpass', drive ? 1400 : 700);
    if (drive) chain(o, shaper(k, drive), lp, g, k.out); else chain(o, lp, g, k.out);
  },
  pluck(k, t, f, v = 0.14, bright = 1) {
    const lp = filt(k, 'lowpass', 3600 * bright, 2);
    lp.frequency.setValueAtTime(3600 * bright, t); lp.frequency.exponentialRampToValueAtTime(450, t + 0.35);
    const g = env(k, t, v, 0.003, 0.42); send(k, g, 0.3);
    osc(k, 'sawtooth', f, t, 0.5).connect(lp); osc(k, 'sawtooth', f * 1.005, t, 0.5).connect(lp); lp.connect(g);
  },
  pad(k, t, fs, dur, v = 0.05, cut = 1200) {
    const g = k.ctx.createGain();
    g.gain.setValueAtTime(T0, t); g.gain.linearRampToValueAtTime(v, t + 0.45);
    g.gain.setValueAtTime(v, t + dur); g.gain.linearRampToValueAtTime(T0, t + dur + 0.7);
    const lp = filt(k, 'lowpass', cut); lp.connect(g); g.connect(k.out); send(k, g, 0.5);
    for (const f of fs) for (const d of [-8, 8]) { const o = osc(k, 'sawtooth', f, t, dur + 0.8); o.detune.value = d; o.connect(lp); }
  },
  keys(k, t, fs, v = 0.07) {
    for (const f of fs) {
      const g = env(k, t, v, 0.01, 1.6); send(k, g, 0.3);
      const lp = filt(k, 'lowpass', 2200); chain(lp, g);
      osc(k, 'sine', f, t, 1.8).connect(lp); osc(k, 'triangle', f * 2, t, 1.8).connect(env(k, t, v * 0.15, 0.005, 0.4, lp));
    }
  },
  cowbell(k, t, m = 1, v = 0.22) {
    const g = env(k, t, v, 0.002, 0.28);
    const bp = filt(k, 'bandpass', 900 * m, 1.4);
    chain(bp, shaper(k, 0.4), g);
    osc(k, 'square', 545 * m, t, 0.35).connect(bp); osc(k, 'square', 815 * m, t, 0.35).connect(bp);
  },
  tom(k, t, f = 95, v = 0.9) {
    const o = osc(k, 'sine', f * 1.7, t, 0.9);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    const g = env(k, t, v, 0.003, 0.65); o.connect(g); send(k, g, 0.45);
    chain(nz(k, t, 0.1), filt(k, 'lowpass', 600), env(k, t, v * 0.4, 0.001, 0.08));
  },
  boom(k, t, v = 1.1) {
    const o = osc(k, 'sine', 75, t, 2.2);
    o.frequency.exponentialRampToValueAtTime(27, t + 0.9);
    const g = env(k, t, v, 0.003, 1.9); o.connect(g); send(k, g, 0.6);
    chain(nz(k, t, 0.7), filt(k, 'lowpass', 900), env(k, t, 0.55, 0.002, 0.6));
  },
  tick(k, t, v = 0.18, f = 1900) { osc(k, 'square', f, t, 0.05).connect(env(k, t, v, 0.001, 0.03)); },
  crackle(k, t0, t1) { for (let t = t0; t < t1; t += 0.03 + Math.random() * 0.18) chain(nz(k, t, 0.01), filt(k, 'highpass', 2500), env(k, t, 0.03 + Math.random() * 0.05, 0.0005, 0.004)); },
};

// ---------------------------------------------------------------- arrangement
const PROG = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]]; // Am F C G
const ROOT = [55, 43.65, 65.41, 49];

function composeMusic(k, style, bpm, dur, drop) {
  const beat = 60 / bpm, step = beat / 4;
  const dq = drop == null || drop <= 0 ? 0 : Math.max(0, Math.round(drop / beat) * beat);
  // fade the bed out at the end
  k.fade.gain.setValueAtTime(1, Math.max(0, dur - 1.4));
  k.fade.gain.linearRampToValueAtTime(T0, dur + 0.4);
  if (style === 'lofi') I.crackle(k, 0, dur + 0.5);
  for (let i = 0; ; i++) {
    const t = i * step;
    if (t > dur + 0.1) break;
    const bar = Math.floor(i / 16), s = i % 16, ch = PROG[bar % 4], root = ROOT[bar % 4];
    const main = t >= dq - 1e-6;
    const preRoll = !main && dq - t <= beat * 2 + 1e-6; // snare roll into the drop
    switch (style) {
      case 'glowup': {
        if (s === 0) I.pad(k, t, ch, beat * 4, main ? 0.045 : 0.035, main ? 1600 : 700);
        if (s % 2 === 0) I.pluck(k, t, ch[(s / 2) % 3] * 2, main ? 0.12 : 0.08, main ? 1 : 0.45);
        if (main) {
          const kicks = bar % 2 ? [0, 3, 10] : [0, 7, 10];
          if (kicks.includes(s)) {
            I.kick(k, t, 1);
            const nx = kicks.find(x => x > s) ?? 16;
            I.bass(k, t, root * 2, (nx - s) * step, 0.6);
          }
          if (s === 8) { I.clap(k, t, 0.7); I.snare(k, t, 0.35); }
          if (s % 2 === 0 || (bar % 2 === 1 && s >= 12)) I.hat(k, t, s % 4 === 2 ? 0.2 : 0.13);
        } else if (s % 4 === 2) I.hat(k, t, 0.1);
        if (preRoll) I.snare(k, t, 0.15 + 0.4 * (1 - (dq - t) / (beat * 2)));
        break;
      }
      case 'phonk': {
        const bell = [0, 3, 6, 8, 11, 14], mel = [1, 1, 1.19, 1, 0.89, 1.335];
        const bi = bell.indexOf(s);
        if (bi >= 0) I.cowbell(k, t, mel[bi] * (bar % 2 ? 0.89 : 1), main ? 0.2 : 0.13);
        if (main) {
          if (s === 0 || s === 10 || (bar % 2 && s === 7)) { I.kick(k, t, 1); I.bass(k, t, root * 2, beat * 1.4, 0.65, 0.7); }
          if (s === 8) I.clap(k, t, 0.8);
          if (s % 2 === 0) I.hat(k, t, 0.14, s === 14);
        } else if (s % 4 === 0) I.hat(k, t, 0.09);
        if (preRoll) I.clap(k, t, 0.2 + 0.4 * (1 - (dq - t) / (beat * 2)));
        break;
      }
      case 'house': {
        if (s === 0 && !main) I.pad(k, t, ch, beat * 4, 0.04, 900);
        if (s === 3 || s === 10) ch.forEach(f => I.pluck(k, t, f * 2, main ? 0.07 : 0.05, main ? 0.8 : 0.4));
        if (main) {
          if (s % 4 === 0) I.kick(k, t, 1);
          if (s === 4 || s === 12) I.clap(k, t, 0.65);
          if ([2, 6, 10, 14].includes(s)) { I.hat(k, t, 0.13, true); I.bass(k, t, root * 2, step * 1.6, 0.5); }
          if (s % 2 === 1) I.hat(k, t, 0.07);
        } else if (s % 2 === 1) I.hat(k, t, 0.06);
        if (preRoll) I.snare(k, t, 0.15 + 0.4 * (1 - (dq - t) / (beat * 2)));
        break;
      }
      case 'cinematic': {
        if (s === 0) I.pad(k, t, main ? ch.map(f => f / 2) : [root * 2, root * 3], beat * 4, main ? 0.06 : 0.05, main ? 1800 : 450);
        if (!main && s % 4 === 0) I.tick(k, t, 0.14, (s / 4) % 2 ? 1500 : 2000);
        if (main) {
          if ([0, 3, 8, 11, 12].includes(s)) I.tom(k, t, s === 0 ? 70 : 95, s === 0 ? 1 : 0.6);
          if (s === 0 && bar % 2 === 0) I.boom(k, t, 0.6);
          if ([0, 6, 12].includes(s)) I.pluck(k, t, ch[(s / 6) % 3] * 4, 0.05, 0.6);
        }
        break;
      }
      case 'lofi': {
        if (s === 0) I.keys(k, t, ch, 0.06);
        if (s === 10) I.keys(k, t, ch.map(f => f * 2), 0.03);
        if (main) {
          if (s === 0 || s === 10) { I.kick(k, t, 0.75); I.bass(k, t, root * 2, beat * 1.5, 0.4); }
          if (s === 8) I.snare(k, t, 0.35);
          if (s % 2 === 0) I.hat(k, t + (s % 4 === 2 ? step * 0.33 : 0), 0.07);
        }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- sound effects
const SFX = {
  whoosh(k, t, _b, len = 0.5) {
    const bp = filt(k, 'bandpass', 400, 1.6);
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(3800, t + len * 0.6); bp.frequency.exponentialRampToValueAtTime(900, t + len);
    const g = k.ctx.createGain();
    g.gain.setValueAtTime(T0, t); g.gain.exponentialRampToValueAtTime(0.55, t + len * 0.55); g.gain.exponentialRampToValueAtTime(T0, t + len);
    const pan = k.ctx.createStereoPanner ? k.ctx.createStereoPanner() : null;
    if (pan) { pan.pan.setValueAtTime(-0.8, t); pan.pan.linearRampToValueAtTime(0.8, t + len); chain(nz(k, t, len + 0.05), bp, g, pan, k.out); }
    else chain(nz(k, t, len + 0.05), bp, g, k.out);
    send(k, g, 0.2);
  },
  riser(k, t, b) {
    const len = (60 / b) * 2;
    const bp = filt(k, 'bandpass', 300, 5);
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(6500, t + len);
    const g = k.ctx.createGain(); g.gain.setValueAtTime(T0, t); g.gain.linearRampToValueAtTime(0.4, t + len); g.gain.linearRampToValueAtTime(T0, t + len + 0.03);
    chain(nz(k, t, len + 0.05), bp, g, k.out); send(k, g, 0.3);
    const o = osc(k, 'sawtooth', 160, t, len + 0.05); o.frequency.exponentialRampToValueAtTime(1300, t + len);
    const g2 = k.ctx.createGain(); g2.gain.setValueAtTime(T0, t); g2.gain.linearRampToValueAtTime(0.06, t + len); g2.gain.linearRampToValueAtTime(T0, t + len + 0.03);
    chain(o, filt(k, 'lowpass', 2500), g2, k.out);
  },
  impact(k, t) {
    I.boom(k, t, 1.2); I.kick(k, t, 1);
    const g = env(k, t, 0.28, 0.002, 1.3); chain(nz(k, t, 1.4), filt(k, 'highpass', 4000), g); send(k, g, 0.6);
  },
  hit(k, t) { I.kick(k, t, 0.9); chain(nz(k, t, 0.2), filt(k, 'lowpass', 2200), env(k, t, 0.45, 0.001, 0.14)); },
  snap(k, t) { chain(nz(k, t, 0.1), filt(k, 'highpass', 2500), env(k, t, 0.45, 0.001, 0.06)); osc(k, 'sine', 2300, t, 0.08).connect(env(k, t, 0.08, 0.001, 0.05)); },
  glitch(k, t) {
    for (let j = 0; j < 7; j++) {
      const tt = t + j * 0.028;
      osc(k, 'square', 150 + Math.random() * 1700, tt, 0.03).connect(env(k, tt, 0.12, 0.001, 0.02));
      if (j % 2) chain(nz(k, tt, 0.03), filt(k, 'bandpass', 500 + Math.random() * 3000, 3), env(k, tt, 0.3, 0.001, 0.02));
    }
  },
  shutter(k, t) {
    chain(nz(k, t, 0.05), filt(k, 'highpass', 1500), env(k, t, 0.5, 0.001, 0.02));
    chain(nz(k, t + 0.07, 0.1), filt(k, 'highpass', 1200), env(k, t + 0.07, 0.4, 0.001, 0.06));
  },
  pop(k, t) { const o = osc(k, 'sine', 380, t, 0.12); o.frequency.exponentialRampToValueAtTime(1100, t + 0.06); o.connect(env(k, t, 0.35, 0.002, 0.09)); },
  tick(k, t) { I.tick(k, t, 0.16, 2100); },
  beep(k, t) { osc(k, 'sine', 880, t, 0.25).connect(env(k, t, 0.28, 0.003, 0.18)); I.tom(k, t, 80, 0.5); },
  ding(k, t) {
    [[1318.5, 0.3, 1.4], [2637, 0.12, 0.8], [3951, 0.06, 0.4]].forEach(([f, v, d]) => { const g = env(k, t, v, 0.002, d); osc(k, 'sine', f, t, d + 0.1).connect(g); send(k, g, 0.5); });
  },
  sparkle(k, t) {
    [2093, 2637, 3136, 4186, 5274].forEach((f, j) => { const tt = t + j * 0.045, g = env(k, tt, 0.1, 0.002, 0.35); osc(k, 'sine', f, tt, 0.4).connect(g); send(k, g, 0.6); });
  },
  confetti(k, t) {
    SFX.pop(k, t); SFX.sparkle(k, t + 0.05);
    for (let j = 0; j < 6; j++) SFX.pop(k, t + 0.08 + Math.random() * 0.4);
  },
};
