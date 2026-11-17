"""Synthesize an original light, upbeat music bed + SFX for the ad (no external samples)."""
import numpy as np, wave, sys
SR = 48000
DUR = 32.0
BPM = 104
beat = 60 / BPM
N = int(SR * DUR)
rng = np.random.default_rng(7)

def tone(f, d, kind='sine'):
    t = np.arange(int(SR * d)) / SR
    if kind == 'sine': return np.sin(2 * np.pi * f * t)
    if kind == 'tri': return 2 / np.pi * np.arcsin(np.sin(2 * np.pi * f * t))
    if kind == 'saw': return 2 * (t * f - np.floor(0.5 + t * f))

def env(n, a=0.005, d=0.2, s=0.0, r=0.05):
    e = np.ones(n)
    na, nd, nr = int(a*SR), int(d*SR), int(r*SR)
    na = min(na, n); e[:na] = np.linspace(0, 1, na)
    end_d = min(n, na+nd)
    e[na:end_d] = np.linspace(1, s, end_d-na) if end_d > na else e[na:end_d]
    e[end_d:] = s
    if nr and n > nr: e[-nr:] *= np.linspace(1, 0, nr)
    return e

def lowpass(x, cutoff):
    a = np.exp(-2*np.pi*cutoff/SR); y = np.zeros_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1-a)*x[i] + a*acc; y[i] = acc
    return y

def lp_fast(x, cutoff):
    # one-pole via cumulative filter using scipy-free vectorization (blockwise)
    from numpy.lib.stride_tricks import sliding_window_view
    k = int(SR / cutoff / 2) | 1
    ker = np.hanning(k); ker /= ker.sum()
    return np.convolve(x, ker, mode='same')

def add(buf, sig, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf): return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[:j-i] * gain

def midi(m): return 440 * 2 ** ((m - 69) / 12)

mus = np.zeros((N,))
# progression: C - G - Am - F  (each 2 beats? -> 1 bar = 4 beats per chord)
prog = [[60, 64, 67], [55, 59, 62, 67], [57, 60, 64], [53, 57, 60, 65]]
bass = [36, 43, 45, 41]
bar = 4 * beat
nbars = int(DUR / bar) + 1
for b in range(nbars):
    t0 = b * bar
    ch = prog[b % 4]
    # pad: detuned saws, low-passed
    pad = np.zeros(int(bar*SR))
    for m in ch:
        for det in (-0.08, 0.08):
            pad += tone(midi(m) * 2 ** (det/12), bar, 'saw')
    pad = lp_fast(pad, 1400) * env(len(pad), a=0.25, d=bar, s=1, r=0.3)
    add(mus, pad, t0, 0.045)
    # bass: root on 1 and the "and" of 2, 3
    for off, l in ((0, 0.9), (1.5, 0.4), (2, 0.9), (3.5, 0.4)):
        s = tone(midi(bass[b % 4]), l*beat, 'tri') + 0.3*tone(midi(bass[b % 4]+12), l*beat)
        add(mus, s * env(len(s), a=0.005, d=l*beat, s=0.6, r=0.04), t0 + off*beat, 0.22)
    # pluck arpeggio (8ths)
    arp = ch + [ch[0] + 12, ch[1] + 12]
    pat = [0, 2, 1, 3, 2, 4, 1, 3]
    for k in range(8):
        m = arp[pat[k] % len(arp)] + 12
        d = 0.32
        s = tone(midi(m), d, 'tri') * 0.7 + tone(midi(m)*2, d) * 0.3
        add(mus, s * env(len(s), a=0.002, d=d, s=0, r=0.02), t0 + k*beat/2, 0.07)

# drums
def kick():
    d = 0.35; t = np.arange(int(SR*d))/SR
    f = 120*np.exp(-t*18) + 45
    ph = 2*np.pi*np.cumsum(f)/SR
    return np.sin(ph) * np.exp(-t*9)
def hat():
    d = 0.05; n = rng.standard_normal(int(SR*d))
    n = n - lp_fast(n, 6000)
    return n * np.exp(-np.arange(len(n))/SR*80)
def clap():
    d = 0.18; n = rng.standard_normal(int(SR*d))
    n = lp_fast(n, 3500) - lp_fast(n, 900)
    e = np.exp(-np.arange(len(n))/SR*22)
    for o in (0.0, 0.012, 0.024):
        e[int(o*SR):int(o*SR)+60] += 0.6
    return n * e

drums = np.zeros(N)
nbeats = int(DUR / beat) + 1
for i in range(nbeats):
    t = i * beat
    add(drums, kick(), t, 0.55 if i % 2 == 0 else 0.4)
    add(drums, hat(), t + beat/2, 0.12)
    add(drums, hat(), t + beat/4*3, 0.05)
    if i % 2 == 1: add(drums, clap(), t, 0.22)

# arrangement: soft bed under the voice (0-9.6s) then full groove from 10s
t = np.arange(N)/SR
music_gain = np.interp(t, [0, 9.4, 10.0, 30.0, 32.0], [0.35, 0.35, 1.0, 1.0, 0.0])
drum_gain = np.interp(t, [0, 9.9, 10.0, 30.2, 31.6], [0.0, 0.0, 1.0, 1.0, 0.0])
mix = mus * music_gain + drums * drum_gain

# SFX
sfx = np.zeros(N)
def whoosh(d=0.55, up=True):
    n = rng.standard_normal(int(SR*d))
    x = np.linspace(0, 1, len(n))
    lo = lp_fast(n, 700); hi = n - lp_fast(n, 2500)
    m = (1-x)*lo + x*hi if up else x*lo + (1-x)*hi
    e = np.sin(np.pi * x) ** 1.5
    return m * e
def pop():
    d = 0.09; tt = np.arange(int(SR*d))/SR
    f = 900*np.exp(-tt*30) + 500
    return np.sin(2*np.pi*np.cumsum(f)/SR) * np.exp(-tt*45)
def tap():
    d = 0.05; tt = np.arange(int(SR*d))/SR
    return np.sin(2*np.pi*1800*tt) * np.exp(-tt*120)
def ding():
    d = 1.2; tt = np.arange(int(SR*d))/SR
    s = sum(np.sin(2*np.pi*midi(m)*tt) * a for m, a in ((84, 0.6), (91, 0.3), (96, 0.15)))
    return s * np.exp(-tt*3.2)
def impact():
    d = 0.8; tt = np.arange(int(SR*d))/SR
    f = 80*np.exp(-tt*6) + 35
    return np.sin(2*np.pi*np.cumsum(f)/SR) * np.exp(-tt*5)

cues = [l.strip().split() for l in open(sys.argv[1])] if len(sys.argv) > 1 else []
fx = {'whoosh': (whoosh, 0.5), 'pop': (pop, 0.35), 'tap': (tap, 0.35), 'ding': (ding, 0.25), 'impact': (impact, 0.7)}
for name, at in cues:
    f, g = fx[name]
    s = f()
    off = float(at) - (0.3 if name == 'whoosh' else 0)
    add(sfx, s, max(0, off), g)
mix = mix + sfx

mix = np.tanh(mix * 1.2) * 0.8
st = np.stack([mix, mix], 1)
st = (st / max(1e-9, np.abs(st).max()) * 0.85 * 32767).astype(np.int16)
with wave.open('music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(st.tobytes())
print('ok', DUR)
