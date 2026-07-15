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
