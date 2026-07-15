// Client-side encryptie van leerlingnamen.
//
// - Sleutel wordt met PBKDF2 uit je passphrase afgeleid; de passphrase en de
//   sleutel gaan NOOIT naar de server.
// - Alleen een willekeurig salt en een versleutelde controlewaarde staan in
//   Supabase, zodat we bij ontgrendelen kunnen checken of de passphrase klopt.
// - Namen worden met AES-GCM versleuteld (unieke IV per record).
// - De afgeleide sleutel wordt per sessie in sessionStorage bewaard, zodat je
//   maar één keer per browsersessie hoeft te ontgrendelen.

const PBKDF2_ITERS = 210000;
const CANARY = 'tso-encryptie-ok';
const SESSIE_SLEUTEL = 'tso_enc_key';

let huidigeSleutel = null;

// --- base64 helpers --------------------------------------------------------

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// --- sleutel afleiden ------------------------------------------------------

async function deriveKey(passphrase, saltBytes) {
  const basis = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    basis,
    { name: 'AES-GCM', length: 256 },
    true, // extractable — nodig om per sessie te cachen
    ['encrypt', 'decrypt']
  );
}

// --- versleutelen / ontsleutelen ------------------------------------------

export async function encryptText(plaintext, key = huidigeSleutel) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return { ct: bufToB64(ct), iv: bufToB64(iv) };
}

export async function decryptText(ctB64, ivB64, key = huidigeSleutel) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(ivB64) },
    key,
    b64ToBuf(ctB64)
  );
  return new TextDecoder().decode(pt);
}

// --- sessiebeheer ----------------------------------------------------------

export function isUnlocked() {
  return huidigeSleutel !== null;
}

async function cacheKey(key) {
  huidigeSleutel = key;
  try {
    const raw = await crypto.subtle.exportKey('raw', key);
    sessionStorage.setItem(SESSIE_SLEUTEL, bufToB64(raw));
  } catch {
    /* sessionStorage niet beschikbaar — dan gewoon in geheugen */
  }
}

// Probeert de sleutel uit sessionStorage terug te halen (na refresh).
export async function restoreKey() {
  if (huidigeSleutel) return true;
  const b64 = sessionStorage.getItem(SESSIE_SLEUTEL);
  if (!b64) return false;
  try {
    huidigeSleutel = await crypto.subtle.importKey(
      'raw',
      b64ToBuf(b64),
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );
    return true;
  } catch {
    return false;
  }
}

export function lock() {
  huidigeSleutel = null;
  try {
    sessionStorage.removeItem(SESSIE_SLEUTEL);
  } catch {
    /* niets */
  }
}

// --- setup / unlock --------------------------------------------------------

// Eerste keer: kies een passphrase. Geeft de op te slaan velden terug.
export async function setupEncryptie(passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  const check = await encryptText(CANARY, key);
  await cacheKey(key);
  return { enc_salt: bufToB64(salt), enc_check: check.ct, enc_check_iv: check.iv };
}

// Ontgrendelen: klopt de passphrase tegen de opgeslagen controlewaarde?
export async function unlockEncryptie(passphrase, instellingen) {
  const key = await deriveKey(passphrase, b64ToBuf(instellingen.enc_salt));
  try {
    const waarde = await decryptText(instellingen.enc_check, instellingen.enc_check_iv, key);
    if (waarde !== CANARY) return false;
  } catch {
    return false; // verkeerde passphrase → AES-GCM verificatie faalt
  }
  await cacheKey(key);
  return true;
}
