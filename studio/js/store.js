// IndexedDB persistence for cases, media (photo / video / audio blobs) and video projects.
import { uid, makeCanvas, canvasToBlob } from './util.js';

const DB_NAME = 'dentastudio', VER = 1;
let dbp;
function open() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of ['media', 'cases', 'projects', 'kv']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
function tx(store, mode, fn) {
  return open().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  }));
}
export const db = {
  put: (s, v) => tx(s, 'readwrite', st => st.put(v)),
  get: (s, k) => tx(s, 'readonly', st => st.get(k)),
  del: (s, k) => tx(s, 'readwrite', st => st.delete(k)),
  all: s => tx(s, 'readonly', st => st.getAll()),
  clear: s => tx(s, 'readwrite', st => st.clear()),
};

// ---------- settings (clinic branding) ----------
export const DEFAULT_SETTINGS = {
  id: 'settings', clinic: 'My Dental Clinic', handle: '@mydentalclinic', website: '', phone: '',
  accent: '#14b8a6', labelBefore: 'BEFORE', labelAfter: 'AFTER', logoMediaId: null, watermark: true,
};
let settingsCache;
export async function getSettings() {
  return (settingsCache ||= { ...DEFAULT_SETTINGS, ...((await db.get('kv', 'settings')) || {}) });
}
export async function saveSettings(s) { settingsCache = s; await db.put('kv', s); }

// ---------- media ----------
const urlCache = new Map(), elCache = new Map();
export function mediaURL(m) {
  if (!urlCache.has(m.id)) urlCache.set(m.id, URL.createObjectURL(m.blob));
  return urlCache.get(m.id);
}
let mediaList = null;
export async function allMedia() {
  if (!mediaList) mediaList = (await db.all('media')).sort((a, b) => b.createdAt - a.createdAt);
  return mediaList;
}
export async function getMedia(id) {
  if (!id) return null;
  return (await allMedia()).find(m => m.id === id) || null;
}
export async function updateMedia(m) { await db.put('media', m); }
export async function deleteMedia(id) {
  await db.del('media', id);
  mediaList = mediaList?.filter(m => m.id !== id);
  if (urlCache.has(id)) URL.revokeObjectURL(urlCache.get(id));
  urlCache.delete(id); elCache.delete(id);
}

function kindOf(type) { return type.startsWith('video') ? 'video' : type.startsWith('audio') ? 'audio' : 'image'; }

async function probe(blob, kind) {
  const url = URL.createObjectURL(blob);
  try {
    if (kind === 'image') {
      const img = await loadImg(url);
      return { w: img.naturalWidth, h: img.naturalHeight, thumb: await thumbOf(img, img.naturalWidth, img.naturalHeight) };
    }
    if (kind === 'video') {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('Unsupported video')); });
      const dur = isFinite(v.duration) ? v.duration : 10;
      v.currentTime = Math.min(0.5, dur / 3);
      await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); });
      return { w: v.videoWidth, h: v.videoHeight, duration: dur, thumb: await thumbOf(v, v.videoWidth, v.videoHeight) };
    }
    const a = document.createElement('audio');
    a.preload = 'metadata'; a.src = url;
    await new Promise(r => { a.onloadedmetadata = r; a.onerror = r; });
    return { duration: isFinite(a.duration) ? a.duration : 0, thumb: null };
  } finally { URL.revokeObjectURL(url); }
}
export function loadImg(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}
async function thumbOf(src, w, h) {
  const s = 240 / Math.max(w, h), c = makeCanvas(w * s, h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}

export async function addMedia(blob, extra = {}) {
  const kind = extra.kind || kindOf(blob.type || 'image/jpeg');
  const info = await probe(blob, kind);
  const m = {
    id: uid(), kind, name: extra.name || blob.name || `${kind}-${new Date().toLocaleString()}`, blob,
    caseId: null, tag: '', view: '', createdAt: Date.now(), meta: {}, ...info, ...extra,
  };
  await db.put('media', m);
  (await allMedia()).unshift(m);
  return m;
}

// Decoded drawable for images (cached).
export async function imageEl(m) {
  if (elCache.has(m.id)) return elCache.get(m.id);
  const p = loadImg(mediaURL(m));
  elCache.set(m.id, p);
  return p;
}

// ---------- cases ----------
export async function allCases() { return (await db.all('cases')).sort((a, b) => b.updatedAt - a.updatedAt); }
export async function saveCase(c) { c.updatedAt = Date.now(); await db.put('cases', c); return c; }
export function newCase(data) { return { id: uid(), patient: '', treatment: '', notes: '', createdAt: Date.now(), updatedAt: Date.now(), ...data }; }
export async function deleteCase(id) {
  for (const m of (await allMedia()).filter(m => m.caseId === id)) await deleteMedia(m.id);
  await db.del('cases', id);
}

// ---------- projects ----------
export async function allProjects() { return (await db.all('projects')).sort((a, b) => b.updatedAt - a.updatedAt); }
export async function saveProject(p) {
  p.updatedAt = Date.now();
  await db.put('projects', JSON.parse(JSON.stringify(p)));
}
export const deleteProject = id => db.del('projects', id);

export async function blobFromCanvas(c, name, extra) {
  const b = await canvasToBlob(c, 'image/jpeg', 0.93);
  return addMedia(new File([b], name, { type: 'image/jpeg' }), extra);
}
