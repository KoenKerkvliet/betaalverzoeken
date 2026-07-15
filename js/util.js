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
