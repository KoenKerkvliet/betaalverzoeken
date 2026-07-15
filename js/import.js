// EDEX-import — VOLLEDIG in de browser.
//
// Privacy: het XML-bestand wordt hier lokaal ingelezen en geparsed. Alleen
// schooljaar, voornaam, achternaam en groep worden eruit gehaald. Leerkrachten
// en alle overige velden worden genegeerd en verlaten de browser niet. Bij
// opslaan wordt de naam client-side versleuteld; Supabase ziet alleen ciphertext.

import {
  findOrCreateSchooljaar,
  findOrCreateGroep,
  getGroepen,
  getLeerlingen,
  insertLeerlingen,
  upsertBetalingen,
  getTsoDagen,
} from './data.js';
import { encryptText, decryptText, isUnlocked } from './crypto.js';
import { getHuidigSchooljaar } from './state.js';
import { euro } from './supabaseClient.js';
import { MAANDEN } from './config.js';

// Leest en parset een EDEX-XML-string.
export function parseEdex(xmlTekst) {
  const doc = new DOMParser().parseFromString(xmlTekst, 'application/xml');

  if (doc.querySelector('parsererror')) {
    return { fout: 'Dit lijkt geen geldig XML-bestand te zijn.' };
  }
  if (doc.documentElement.nodeName !== 'EDEX') {
    return { fout: 'Dit is geen EDEX-bestand (verwacht een <EDEX>-element).' };
  }

  const schooljaar = doc.querySelector('EDEX > school > schooljaar')?.textContent?.trim() || '';

  // Groep-key -> naam. Scope naar EDEX > groepen, anders matcht ook het
  // <groepen>-blok binnen een leerkracht (die lege groep-refs bevat).
  const groepNaam = new Map();
  doc.querySelectorAll('EDEX > groepen > groep').forEach((g) => {
    const key = g.getAttribute('key');
    const naam = g.querySelector('naam')?.textContent?.trim() || '';
    if (key) groepNaam.set(key, naam);
  });

  // Leerlingen (leerkrachten expliciet overgeslagen)
  const leerlingen = [];
  doc.querySelectorAll('EDEX > leerlingen > leerling').forEach((l) => {
    const achternaamKern = l.querySelector('achternaam')?.textContent?.trim() || '';

    // Tussenvoegsel staat in EDEX vaak in een apart veld (bijv. <voorvoegsel>).
    // Pak elk kind-element met 'voorvoegsel' of 'tussenvoegsel' in de tagnaam.
    let tussenvoegsel = '';
    for (const kind of l.children) {
      const tag = kind.tagName.toLowerCase();
      if ((tag.includes('voorvoegsel') || tag.includes('tussenvoegsel')) && kind.textContent.trim()) {
        tussenvoegsel = kind.textContent.trim();
        break;
      }
    }
    const achternaam = tussenvoegsel ? `${tussenvoegsel} ${achternaamKern}` : achternaamKern;

    const roepnaam = l.querySelector('roepnaam')?.textContent?.trim() || '';
    const voornamen = l.querySelector('voornamen')?.textContent?.trim() || '';
    const voornaam = roepnaam || voornamen; // roepnaam heeft voorkeur
    const groepRef = l.querySelector('groep')?.getAttribute('key') || '';
    const groep = groepNaam.get(groepRef) || '(onbekende groep)';

    if (voornaam || achternaam) {
      leerlingen.push({ voornaam, achternaam, groep });
    }
  });

  return {
    schooljaar,
    groepen: [...groepNaam.values()], // in bestandsvolgorde
    leerlingen,
  };
}

export async function renderImport(root, onKlaar) {
  root.innerHTML = `
    <header class="page-head">
      <h1>Importeren</h1>
      <p class="muted">Kies een bestand — de app herkent zelf of het een EDEX-bestand (.xml) of een betaal-export (.xlsx) is.</p>
    </header>

    <section class="kaart">
      <div class="privacy-note">
        🔒 Het bestand wordt <strong>volledig in je browser</strong> verwerkt.
        Bij EDEX worden alleen schooljaar, voornaam, achternaam en groep gelezen; bij een
        betaal-export worden namen alleen lokaal gematcht en verlaat er geen naam je computer —
        er worden enkel bedragen per leerling opgeslagen.
      </div>

      <div class="inline-form">
        <label>
          Bestand (EDEX .xml of export .xlsx)
          <input type="file" id="edex-file" />
        </label>
      </div>

      <p id="import-status" class="msg"></p>
    </section>

    <section id="import-resultaat"></section>
  `;

  const fileInput = root.querySelector('#edex-file');
  const status = root.querySelector('#import-status');
  const resultaat = root.querySelector('#import-resultaat');

  fileInput.addEventListener('change', async () => {
    resultaat.innerHTML = '';
    status.className = 'msg';
    status.textContent = '';

    const file = fileInput.files?.[0];
    if (!file) return;

    // Automatische herkenning: .xlsx/.xls = betaal-export, anders EDEX (.xml)
    const naam = file.name.toLowerCase();
    if (naam.endsWith('.xlsx') || naam.endsWith('.xls')) {
      await verwerkExport(file, resultaat, status);
      fileInput.value = '';
      return;
    }

    let tekst;
    try {
      tekst = await file.text();
    } catch {
      status.className = 'msg error';
      status.textContent = 'Kon het bestand niet lezen.';
      return;
    }

    const parse = parseEdex(tekst);
    if (parse.fout) {
      status.className = 'msg error';
      status.textContent = parse.fout;
      return;
    }
    if (!parse.schooljaar) {
      status.className = 'msg error';
      status.textContent = 'Geen schooljaar gevonden in dit bestand.';
      return;
    }
    if (!parse.groepen.length && !parse.leerlingen.length) {
      status.className = 'msg info';
      status.textContent = 'Geen groepen of leerlingen gevonden in dit bestand.';
      return;
    }

    toonResultaat(resultaat, parse, onKlaar);
    status.className = 'msg success';
    status.textContent = `Schooljaar ${parse.schooljaar} · ${parse.leerlingen.length} leerling(en) in ${parse.groepen.length} groep(en).`;
  });
}

function toonResultaat(root, parse, onKlaar) {
  const { leerlingen } = parse;

  const perGroep = new Map();
  for (const l of leerlingen) {
    if (!perGroep.has(l.groep)) perGroep.set(l.groep, []);
    perGroep.get(l.groep).push(l);
  }
  const sorteerGroepen = [...perGroep.keys()].sort((a, b) =>
    a.localeCompare(b, 'nl', { numeric: true })
  );

  const blokken = sorteerGroepen
    .map((groep) => {
      const rijen = perGroep
        .get(groep)
        .sort((a, b) => a.voornaam.localeCompare(b.voornaam, 'nl'))
        .map(
          (l) => `
          <tr><td>${escapeHtml(l.voornaam)}</td><td>${escapeHtml(l.achternaam)}</td></tr>`
        )
        .join('');
      return `
        <div class="kaart">
          <h2>${escapeHtml(groep)} <span class="muted">· ${perGroep.get(groep).length}</span></h2>
          <table class="import-tabel">
            <thead><tr><th>Voornaam</th><th>Achternaam</th></tr></thead>
            <tbody>${rijen}</tbody>
          </table>
        </div>`;
    })
    .join('');

  root.innerHTML = `
    <div class="kaart">
      <p class="muted" style="margin-top:0">Controleer de gegevens en sla ze daarna versleuteld op onder schooljaar <strong>${escapeHtml(
        parse.schooljaar
      )}</strong>. Bestaande groepen/leerlingen worden niet dubbel toegevoegd.</p>
      <button class="btn btn-primary" id="opslaan-btn">Versleuteld opslaan in portaal</button>
      <p id="opslaan-status" class="msg"></p>
    </div>
    ${blokken}
  `;

  const btn = root.querySelector('#opslaan-btn');
  const status = root.querySelector('#opslaan-status');
  btn.addEventListener('click', () => slaImportOp(parse, btn, status, onKlaar));
}

async function slaImportOp(parse, btn, status, onKlaar) {
  if (!isUnlocked()) {
    status.className = 'msg error';
    status.textContent = 'De encryptie is niet ontgrendeld. Herlaad de pagina en voer je passphrase in.';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Bezig met opslaan…';
  status.className = 'msg';
  status.textContent = '';

  try {
    // 1. Schooljaar vinden of aanmaken
    const schooljaar = await findOrCreateSchooljaar(parse.schooljaar);

    // 2. Groepen vinden of aanmaken (in bestandsvolgorde) binnen dit schooljaar
    const naamNaarId = new Map();
    for (let i = 0; i < parse.groepen.length; i++) {
      const g = await findOrCreateGroep(parse.groepen[i], i, schooljaar.id);
      naamNaarId.set(g.naam.toLowerCase(), g.id);
    }

    // 3. Bestaande leerlingen ontsleutelen voor ontdubbeling
    const bestaand = await getLeerlingen();
    const bestaandSet = new Set();
    for (const b of bestaand) {
      try {
        const { v, a } = JSON.parse(await decryptText(b.enc_naam, b.iv));
        bestaandSet.add(sleutel(b.groep_id, v, a));
      } catch {
        /* onleesbaar record — overslaan */
      }
    }

    // 4. Nieuwe leerlingen versleuteld opslaan
    const toevoegen = [];
    let geenGroep = 0;
    let dubbel = 0;
    for (const l of parse.leerlingen) {
      const gid = naamNaarId.get(l.groep.toLowerCase());
      if (!gid) {
        geenGroep++;
        continue;
      }
      const k = sleutel(gid, l.voornaam, l.achternaam);
      if (bestaandSet.has(k)) {
        dubbel++;
        continue;
      }
      bestaandSet.add(k);
      const enc = await encryptText(JSON.stringify({ v: l.voornaam, a: l.achternaam }));
      toevoegen.push({ groep_id: gid, enc_naam: enc.ct, iv: enc.iv });
    }

    await insertLeerlingen(toevoegen);

    const delen = [`Schooljaar ${schooljaar.naam}`, `${toevoegen.length} leerling(en) toegevoegd`];
    if (dubbel) delen.push(`${dubbel} al aanwezig`);
    if (geenGroep) delen.push(`${geenGroep} zonder groep overgeslagen`);
    status.className = 'msg success';
    status.textContent = delen.join(' · ');
    btn.textContent = 'Klaar';

    if (typeof onKlaar === 'function') await onKlaar(schooljaar.id);
  } catch (err) {
    console.error(err);
    status.className = 'msg error';
    status.textContent = 'Opslaan mislukt. Probeer het opnieuw.';
    btn.textContent = 'Versleuteld opslaan in portaal';
    btn.disabled = false;
  }
}

function sleutel(groepId, voornaam, achternaam) {
  return `${groepId}|${(voornaam || '').toLowerCase()}|${(achternaam || '').toLowerCase()}`;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ===========================================================================
// Betaal-export (.xlsx) — kolommen: Groep · Leerling · Betaling
// ===========================================================================

// Normaliseert een naam voor matching: accenten weg, kleine letters,
// dubbele spaties samengevoegd. Zo matchen "Romée" en "Romee",
// "van  der Wal" en "van der Wal", enz.
function normaliseer(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function naamSleutel(groep, naam) {
  return `${normaliseer(groep)}|${normaliseer(naam)}`;
}

// Losse sleutel: groep + eerste woord (voornaam) + laatste woord (achternaam-kern).
// Negeert tussenvoegsels aan beide kanten.
function losseSleutel(groep, naam) {
  const woorden = normaliseer(naam).split(' ').filter(Boolean);
  const eerste = woorden[0] || '';
  const laatste = woorden[woorden.length - 1] || '';
  return `${normaliseer(groep)}|${eerste}|${laatste}`;
}

// Parset een .xlsx client-side met SheetJS (lazy geladen van de CDN).
async function parseExport(file) {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return json
    .map((r) => ({
      groep: String(r.Groep ?? r.groep ?? '').trim(),
      leerling: String(r.Leerling ?? r.leerling ?? '').trim(),
      bedrag: Number(r.Betaling ?? r.betaling ?? 0) || 0,
    }))
    .filter((r) => r.leerling);
}

// Popup om één of meerdere maanden te kiezen. Resolvt met een gesorteerde
// array van maandnummers, of null bij annuleren.
function kiesMaanden() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate-overlay';
    overlay.innerHTML = `
      <div class="auth-card">
        <div class="auth-brand">
          <div class="auth-logo">📅</div>
          <h1>Voor welke maand(en)?</h1>
          <p class="muted">Kies één maand, of meerdere om een gecombineerde betaling automatisch over die maanden te splitsen (op basis van het verschuldigde bedrag per maand).</p>
        </div>
        <form id="maand-form" class="auth-form">
          <div class="maand-keuze">
            ${MAANDEN.map(
              (m, i) =>
                `<label class="maand-optie"><input type="checkbox" value="${i + 1}" /> ${m}</label>`
            ).join('')}
          </div>
          <p id="maand-msg" class="msg"></p>
          <div style="display:flex;gap:8px">
            <button type="submit" class="btn btn-primary">Verwerken</button>
            <button type="button" class="btn btn-ghost" id="maand-annuleer">Annuleren</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#maand-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const gekozen = [...overlay.querySelectorAll('.maand-keuze input:checked')]
        .map((c) => Number(c.value))
        .sort((a, b) => a - b);
      if (!gekozen.length) {
        const msg = overlay.querySelector('#maand-msg');
        msg.textContent = 'Kies minstens één maand.';
        msg.className = 'msg error';
        return;
      }
      overlay.remove();
      resolve(gekozen);
    });
    overlay.querySelector('#maand-annuleer').addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });
  });
}

async function verwerkExport(file, root, status) {
  if (!isUnlocked()) {
    status.className = 'msg error';
    status.textContent = 'De encryptie is niet ontgrendeld. Herlaad de pagina en voer je passphrase in.';
    return;
  }

  status.className = 'msg';
  status.textContent = 'Bestand lezen…';

  let rows;
  try {
    rows = await parseExport(file);
  } catch (err) {
    console.error(err);
    status.className = 'msg error';
    status.textContent = 'Kon het Excel-bestand niet lezen.';
    return;
  }
  if (!rows.length) {
    status.className = 'msg info';
    status.textContent = 'Geen betalingen gevonden in dit bestand (verwacht kolommen Groep, Leerling, Betaling).';
    return;
  }

  const maanden = await kiesMaanden();
  if (maanden == null) {
    status.className = 'msg info';
    status.textContent = 'Import geannuleerd.';
    return;
  }

  status.textContent = 'Verwerken…';

  const schooljaar = getHuidigSchooljaar();
  const dagprijs = Number(schooljaar.tso_dagprijs) || 0;
  const groepen = await getGroepen(schooljaar.id);
  const groepNaam = new Map(groepen.map((g) => [g.id, g.naam]));

  // Verschuldigd bedrag per groep/maand (voor het splitsen over maanden).
  const dagenMap = new Map();
  for (const d of await getTsoDagen(groepen.map((g) => g.id))) {
    dagenMap.set(`${d.groep_id}:${d.maand}`, d.dagen);
  }

  // Onze (versleutelde) leerlingen ontsleutelen om op naam+groep te matchen.
  // Twee sleutels: exact (volledige naam) en los (voornaam + achternaam-kern),
  // zodat tussenvoegsels aan beide kanten niet uitmaken.
  const leerlingRows = await getLeerlingen(groepen.map((g) => g.id));
  const leerlingGroep = new Map(leerlingRows.map((r) => [r.id, r.groep_id]));
  const exactMap = new Map();
  const losMap = new Map();
  const losDubbel = new Set();
  for (const r of leerlingRows) {
    try {
      const { v, a } = JSON.parse(await decryptText(r.enc_naam, r.iv));
      const groep = groepNaam.get(r.groep_id);
      exactMap.set(naamSleutel(groep, `${v} ${a}`), r.id);
      const ls = losseSleutel(groep, `${v} ${a}`);
      if (losMap.has(ls)) losDubbel.add(ls);
      else losMap.set(ls, r.id);
    } catch {
      /* onleesbaar — overslaan */
    }
  }

  // Meerdere regels voor dezelfde leerling+maand worden opgeteld (bijv.
  // betaling in termijnen). Anders weigert de database de upsert.
  const perLeerling = new Map(); // leerling_id -> opgeteld bedrag
  const nietGevonden = [];
  for (const row of rows) {
    let id = exactMap.get(naamSleutel(row.groep, row.leerling));
    if (!id) {
      const ls = losseSleutel(row.groep, row.leerling);
      if (losMap.has(ls) && !losDubbel.has(ls)) id = losMap.get(ls);
    }
    if (!id) {
      nietGevonden.push(row);
      continue;
    }
    perLeerling.set(id, (perLeerling.get(id) || 0) + row.bedrag);
  }

  // Verdeel elke betaling over de gekozen maanden. Eerdere maanden worden tot
  // hun verschuldigde bedrag gevuld; de laatste maand krijgt de rest.
  const betalingen = [];
  for (const [leerling_id, som] of perLeerling) {
    const groepId = leerlingGroep.get(leerling_id);
    let rest = Math.round(som * 100) / 100;
    maanden.forEach((m, i) => {
      let bedrag;
      if (i === maanden.length - 1) {
        bedrag = rest;
      } else {
        const verschuldigd = (dagenMap.get(`${groepId}:${m}`) || 0) * dagprijs;
        bedrag = Math.min(rest, verschuldigd);
      }
      bedrag = Math.round(bedrag * 100) / 100;
      rest = Math.round((rest - bedrag) * 100) / 100;
      betalingen.push({ leerling_id, maand: m, bedrag });
    });
  }

  try {
    await upsertBetalingen(betalingen);
  } catch (err) {
    console.error(err);
    status.className = 'msg error';
    status.textContent = 'Opslaan van betalingen mislukt.';
    return;
  }

  const maandNamen = maanden.map((m) => MAANDEN[m - 1]).join(', ');
  status.className = 'msg success';
  status.textContent = `${maandNamen}: ${perLeerling.size} leerling(en) verwerkt${
    nietGevonden.length ? `, ${nietGevonden.length} niet gekoppeld` : ''
  }.`;

  root.innerHTML = `
    <div class="kaart">
      <h2>Betalingen · ${escapeHtml(maandNamen)}</h2>
      <p class="muted">${
        maanden.length > 1
          ? 'De betalingen zijn over de gekozen maanden verdeeld en staan bij de juiste leerlingen op de groepspagina\'s.'
          : 'De bedragen staan nu bij de juiste leerlingen op de groepspagina\'s.'
      }</p>
      ${
        nietGevonden.length
          ? `<details style="margin-top:8px">
              <summary>${nietGevonden.length} regel(s) niet gekoppeld</summary>
              <p class="muted" style="font-size:12px">Deze namen/groepen kwamen niet overeen met een leerling in schooljaar ${escapeHtml(
                schooljaar.naam
              )}. Controleer de naam of importeer eerst de EDEX.</p>
              <table class="import-tabel">
                <thead><tr><th>Groep</th><th>Leerling</th><th>Bedrag</th></tr></thead>
                <tbody>${nietGevonden
                  .map(
                    (r) =>
                      `<tr><td>${escapeHtml(r.groep)}</td><td>${escapeHtml(
                        r.leerling
                      )}</td><td>${euro.format(r.bedrag)}</td></tr>`
                  )
                  .join('')}</tbody>
              </table>
            </details>`
          : ''
      }
    </div>`;
}
