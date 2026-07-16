import { decryptText, encryptText } from './crypto.js';

// --- Regelingen (maand → opmerking), client-side versleuteld ---------------
// Nieuw formaat in de database: { "3": { ct, iv } }. Oud (legacy) formaat was
// een leesbare string; die wordt bij het laden herkend en daarna versleuteld.

export function regelingenBevatLegacy(reg) {
  return Object.values(reg || {}).some((v) => !(v && typeof v === 'object' && v.ct));
}

// Ontsleutelt naar { maand: tekst }. Legacy-strings gaan er ongewijzigd doorheen.
export async function decryptRegelingen(reg) {
  const out = {};
  for (const [maand, val] of Object.entries(reg || {})) {
    if (val && typeof val === 'object' && val.ct) {
      try {
        out[maand] = await decryptText(val.ct, val.iv);
      } catch {
        out[maand] = '⚠︎ onleesbaar';
      }
    } else {
      out[maand] = String(val ?? '');
    }
  }
  return out;
}

// Versleutelt { maand: tekst } naar { maand: { ct, iv } }.
export async function encryptRegelingen(plain) {
  const out = {};
  for (const [maand, tekst] of Object.entries(plain || {})) {
    const enc = await encryptText(String(tekst ?? ''));
    out[maand] = { ct: enc.ct, iv: enc.iv };
  }
  return out;
}

// Kalendermaand → schoolmaand (1..10: Aug/sept .. Juni/juli).
export function huidigeSchoolMaand() {
  const cal = new Date().getMonth() + 1;
  const map = { 8: 1, 9: 1, 10: 2, 11: 3, 12: 4, 1: 5, 2: 6, 3: 7, 4: 8, 5: 9, 6: 10, 7: 10 };
  return map[cal] || 1;
}

// Pseudoniem "Voornaam A." — initiaal van de achternaam-kern (laatste woord).
export function pseudoniem(v, a) {
  const kern = (a || '').trim().split(/\s+/).pop();
  return kern ? `${v} ${kern[0].toUpperCase()}.` : v;
}

// Normaliseert voor zoeken: accenten weg, kleine letters, spaties samengevoegd.
export function normaliseer(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Parset een Nederlands bedrag: "8.919,70", "8919,7", "8919.7" of "8919" → getal.
export function parseBedrag(s) {
  let t = String(s || '').replace(/[€\s]/g, '');
  if (t === '') return 0;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return isNaN(n) ? 0 : Math.max(0, n);
}
