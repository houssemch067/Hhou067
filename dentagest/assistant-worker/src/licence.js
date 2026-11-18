// Vérifie un code d'activation DentaGest DZ (même format que l'application et le serveur de paiement) :
// base64url(JSON {d: appareil, e: fin AAAA-MM-JJ, p: formule, i: émission}) + "." + base64url(signature ECDSA P-256)

export const LIC_PUB = { kty: 'EC', crv: 'P-256', x: 'Pl0qnwdo2PmZfBRamaqjwgAqTcRP4Kjkg2vnYYVtx0w', y: 'hWfg0GanEeVLa7y87Uy7Kakxggamx6YtGioXk8eIXSE' };
export const DEV = /^DG-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
export const isPro = (p) => p === 'pm' || p === 'py';

const b64uDec = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const b = atob(s), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
};

let keyP;
/** Renvoie la charge utile si la signature est valide, sinon null. pubJwk permet de tester avec une autre clé. */
export async function verifyLicence(code, pubJwk = LIC_PUB) {
  try {
    const [p, sg] = String(code || '').trim().split('.');
    if (!p || !sg) return null;
    const key = pubJwk === LIC_PUB
      ? await (keyP ||= crypto.subtle.importKey('jwk', LIC_PUB, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']))
      : await crypto.subtle.importKey('jwk', pubJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64uDec(sg), new TextEncoder().encode(p));
    if (!ok) return null;
    const o = JSON.parse(new TextDecoder().decode(b64uDec(p)));
    return o && DEV.test(o.d || '') && /^\d{4}-\d{2}-\d{2}$/.test(o.e || '') ? o : null;
  } catch {
    return null;
  }
}
