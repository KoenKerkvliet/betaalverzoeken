// EDEX-import — VOLLEDIG in de browser.
//
// Privacy: het XML-bestand wordt hier lokaal ingelezen en geparsed. Alleen
// schooljaar, voornaam, achternaam en groep worden eruit gehaald. Leerkrachten
// en alle overige velden worden genegeerd en verlaten de browser niet. Bij
// opslaan wordt de naam client-side versleuteld; Supabase ziet alleen ciphertext.

import {
  findOrCreateSchooljaar,
  findOrCreateGroep,
  getLeerlingen,
  insertLeerlingen,
} from './data.js';
import { encryptText, decryptText, isUnlocked } from './crypto.js';

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
      <h1>Importeren (EDEX)</h1>
      <p class="muted">Lees een EDEX-bestand (.xml) in. Groepen en leerlingen worden aan het schooljaar uit het bestand gekoppeld.</p>
    </header>

    <section class="kaart">
      <div class="privacy-note">
        🔒 Dit bestand wordt <strong>volledig in je browser</strong> verwerkt. Alleen
        <strong>schooljaar, voornaam, achternaam en groep</strong> worden eruit gelezen.
        Leerkrachten en alle overige gegevens worden genegeerd en verlaten je computer niet.
      </div>

      <div class="inline-form">
        <label>
          EDEX-bestand
          <input type="file" id="edex-file" accept=".xml,text/xml,application/xml" />
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
