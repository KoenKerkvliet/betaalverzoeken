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
    const achternaam = l.querySelector('achternaam')?.textContent?.trim() || '';
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

function naamSleutel(groep, naam) {
  return `${(groep || '').toLowerCase().trim()}|${(naam || '').toLowerCase().trim()}`;
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

// Popup om de maand te kiezen. Resolvt met maandnummer (1..10) of null.
function kiesMaand() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate-overlay';
    overlay.innerHTML = `
      <div class="auth-card">
        <div class="auth-brand">
          <div class="auth-logo">📅</div>
          <h1>Voor welke maand?</h1>
          <p class="muted">Kies de maand waarvoor deze betalingen gelden.</p>
        </div>
        <form id="maand-form" class="auth-form">
          <label>Maand
            <select id="maand-select">
              ${MAANDEN.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}
            </select>
          </label>
          <div style="display:flex;gap:8px">
            <button type="submit" class="btn btn-primary">Verwerken</button>
            <button type="button" class="btn btn-ghost" id="maand-annuleer">Annuleren</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#maand-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const m = Number(overlay.querySelector('#maand-select').value);
      overlay.remove();
      resolve(m);
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

  const maand = await kiesMaand();
  if (maand == null) {
    status.className = 'msg info';
    status.textContent = 'Import geannuleerd.';
    return;
  }

  status.textContent = 'Verwerken…';

  const schooljaar = getHuidigSchooljaar();
  const groepen = await getGroepen(schooljaar.id);
  const groepNaam = new Map(groepen.map((g) => [g.id, g.naam]));

  // Onze (versleutelde) leerlingen ontsleutelen om op naam+groep te matchen.
  const leerlingRows = await getLeerlingen(groepen.map((g) => g.id));
  const naamNaarId = new Map();
  for (const r of leerlingRows) {
    try {
      const { v, a } = JSON.parse(await decryptText(r.enc_naam, r.iv));
      naamNaarId.set(naamSleutel(groepNaam.get(r.groep_id), `${v} ${a}`), r.id);
    } catch {
      /* onleesbaar — overslaan */
    }
  }

  const betalingen = [];
  const nietGevonden = [];
  for (const row of rows) {
    const id = naamNaarId.get(naamSleutel(row.groep, row.leerling));
    if (!id) {
      nietGevonden.push(row);
      continue;
    }
    betalingen.push({ leerling_id: id, maand, bedrag: row.bedrag });
  }

  try {
    await upsertBetalingen(betalingen);
  } catch (err) {
    console.error(err);
    status.className = 'msg error';
    status.textContent = 'Opslaan van betalingen mislukt.';
    return;
  }

  status.className = 'msg success';
  status.textContent = `Maand ${MAANDEN[maand - 1]}: ${betalingen.length} betaling(en) verwerkt${
    nietGevonden.length ? `, ${nietGevonden.length} niet gekoppeld` : ''
  }.`;

  root.innerHTML = `
    <div class="kaart">
      <h2>Betalingen · ${escapeHtml(MAANDEN[maand - 1])}</h2>
      <p class="muted">De bedragen staan nu bij de juiste leerlingen op de groepspagina's.</p>
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
