// WhatsApp Cloud API (Meta) : vérification des webhooks, lecture des messages, envoi des réponses.

const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function validSignature(appSecret, raw, header) {
  if (!appSecret || !header || !header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const given = header.slice(7);
  if (given.length !== sig.length) return false;
  let r = 0;
  for (let i = 0; i < sig.length; i++) r |= sig.charCodeAt(i) ^ given.charCodeAt(i);
  return r === 0;
}

const NON_TEXT = {
  audio: 'un message vocal',
  voice: 'un message vocal',
  image: 'une photo',
  video: 'une vidéo',
  document: 'un document',
  sticker: 'un autocollant',
  location: 'une position',
  contacts: 'un contact',
};

/** Extrait les messages entrants d'un webhook : [{ phoneId, from, name, id, body, at }] */
export function incoming(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const phoneId = v.metadata?.phone_number_id;
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || '']));
      for (const m of v.messages || []) {
        let body = '';
        if (m.type === 'text') body = m.text?.body || '';
        else if (m.type === 'button') body = m.button?.text || '';
        else if (m.type === 'interactive') body = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
        else if (m.type === 'reaction') continue;
        else body = '(Le patient a envoyé ' + (NON_TEXT[m.type] || 'un contenu') + ' que tu ne peux pas ' + (m.type === 'audio' || m.type === 'voice' ? 'écouter' : 'ouvrir') + (m.image?.caption || m.video?.caption ? ', avec la légende : « ' + (m.image?.caption || m.video?.caption) + ' »' : '') + '. Demande-lui gentiment d’écrire sa demande par message.)';
        if (!phoneId || !m.from || !m.id || !body.trim()) continue;
        out.push({ phoneId, from: m.from, name: names[m.from] || '', id: m.id, body: body.slice(0, 2000), at: Number(m.timestamp) * 1000 || Date.now() });
      }
    }
  }
  return out;
}

/** Envoie un texte au patient. Les réponses longues sont coupées (limite WhatsApp : 4096 caractères). */
export async function sendText(env, phoneId, to, text) {
  const v = env.WA_GRAPH_VERSION || 'v23.0';
  const r = await fetch('https://graph.facebook.com/' + v + '/' + phoneId + '/messages', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.WA_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: text.slice(0, 4000) } }),
  });
  if (!r.ok) throw new Error('WhatsApp ' + r.status + ' ' + (await r.text()).slice(0, 300));
}

/** Marque le message comme lu (coches bleues) : le patient voit que c'est pris en compte. */
export async function markRead(env, phoneId, msgId) {
  const v = env.WA_GRAPH_VERSION || 'v23.0';
  try {
    await fetch('https://graph.facebook.com/' + v + '/' + phoneId + '/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.WA_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: msgId }),
    });
  } catch {}
}
