// EDEX-import — VOLLEDIG in de browser.
//
// Privacy: het XML-bestand wordt hier lokaal ingelezen en geparsed. Alleen
// voornaam, achternaam en groep worden eruit gehaald. Leerkrachten en alle
// overige velden worden genegeerd en verlaten de browser niet. Bij opslaan
// wordt de naam client-side versleuteld; Supabase ziet alleen ciphertext.

import { getGroepen, getLeerlingen, insertLeerlingen } from './data.js';
import { encryptText, decryptText, isUnlocked } from './crypto.js';

// Leest en parset een EDEX-XML-string. Geeft { groepen, leerlingen, fouten }.
export function parseEdex(xmlTekst) {
  const doc = new DOMParser().parseFromString(xmlTekst, 'application/xml');

  const parseFout = doc.querySelector('parsererror');
  if (parseFout) {
    return { fout: 'Dit lijkt geen geldig XML-bestand te zijn.' };
  }
  if (doc.documentElement.nodeName !== 'EDEX') {
    return { fout: 'Dit is geen EDEX-bestand (verwacht een <EDEX>-element).' };
  }

  // Groep-key -> naam. Let op: scope naar EDEX > groepen, anders matcht ook
  // het <groepen>-blok binnen een leerkracht (die lege groep-refs bevat).
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
    groepen: [...groepNaam.values()],
    leerlingen,
  };
}

export async function renderImport(root) {
  root.innerHTML = `
    <header class="page-head">
      <h1>Importeren (EDEX)</h1>
      <p class="muted">Lees een EDEX-bestand (.xml) in om leerlingen en groepen op te halen.</p>
    </header>

    <section class="kaart">
      <div class="privacy-note">
        🔒 Dit bestand wordt <strong>volledig in je browser</strong> verwerkt. Alleen
        <strong>voornaam, achternaam en groep</strong> worden eruit gelezen. Leerkrachten en
        alle overige gegevens worden genegeerd en verlaten je computer niet — er gaat niets
        naar de server.
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

    const { fout, leerlingen, groepen } = parseEdex(tekst);
    if (fout) {
      status.className = 'msg error';
      status.textContent = fout;
      return;
    }

    if (!leerlingen.length) {
      status.className = 'msg info';
      status.textContent = 'Geen leerlingen gevonden in dit bestand.';
      return;
    }

    toonResultaat(resultaat, leerlingen, groepen);
    status.className = 'msg success';
    status.textContent = `${leerlingen.length} leerling(en) gevonden in ${groepen.length} groep(en).`;
  });
}

function toonResultaat(root, leerlingen, groepen) {
  // Groepeer per groep, gesorteerd
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
          <tr>
            <td>${escapeHtml(l.voornaam)}</td>
            <td>${escapeHtml(l.achternaam)}</td>
          </tr>`
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
      <p class="muted" style="margin-top:0">Controleer de gegevens hieronder en sla ze daarna versleuteld op in het portaal. Al bestaande leerlingen (zelfde voornaam, achternaam én groep) worden overgeslagen.</p>
      <button class="btn btn-primary" id="opslaan-btn">Versleuteld opslaan in portaal</button>
      <p id="opslaan-status" class="msg"></p>
    </div>
    ${blokken}
  `;

  const btn = root.querySelector('#opslaan-btn');
  const status = root.querySelector('#opslaan-status');
  btn.addEventListener('click', () => slaLeerlingenOp(leerlingen, btn, status));
}

async function slaLeerlingenOp(leerlingen, btn, status) {
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
    const groepen = await getGroepen();
    const naamNaarId = new Map(groepen.map((g) => [g.naam.toLowerCase(), g.id]));

    // Bestaande leerlingen ontsleutelen voor ontdubbeling
    const bestaand = await getLeerlingen();
    const bestaandSet = new Set();
    for (const b of bestaand) {
      try {
        const { v, a } = JSON.parse(await decryptText(b.enc_naam, b.iv));
        bestaandSet.add(sleutel(b.groep_id, v, a));
      } catch {
        /* onleesbaar record — overslaan bij vergelijking */
      }
    }

    const toevoegen = [];
    let geenGroep = 0;
    let dubbel = 0;
    for (const l of leerlingen) {
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

    const delen = [`${toevoegen.length} toegevoegd`];
    if (dubbel) delen.push(`${dubbel} al aanwezig (overgeslagen)`);
    if (geenGroep) delen.push(`${geenGroep} zonder bekende groep (overgeslagen)`);
    status.className = 'msg success';
    status.textContent = delen.join(' · ');
    btn.textContent = 'Opnieuw opslaan';
    btn.disabled = false;
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
