import { euro } from './supabaseClient.js';
import { MAANDEN, MAANDEN_KORT } from './config.js';
import { getGroepen, getTsoDagen, upsertTsoDagen, getLeerlingen, setLeergeld } from './data.js';
import { decryptText, isUnlocked } from './crypto.js';
import { getHuidigSchooljaar } from './state.js';

function pseudoniem(v, a) {
  const kern = (a || '').trim().split(/\s+/).pop();
  return kern ? `${v} ${kern[0].toUpperCase()}.` : v;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function leergeldRijenHtml(leerlingen, groepNaam, groepJaarTotaal) {
  const gekoppeld = leerlingen
    .filter((l) => l.leergeld)
    .sort((x, y) => x.voornaam.localeCompare(y.voornaam, 'nl'));
  if (!gekoppeld.length) {
    return `<tr><td colspan="4" class="muted" style="padding:12px">Nog geen leerlingen gekoppeld. Zoek hierboven een leerling om te koppelen.</td></tr>`;
  }
  return gekoppeld
    .map((l) => {
      const bedrag = l.leergeld_bedrag != null ? Number(l.leergeld_bedrag) : groepJaarTotaal(l.groep_id);
      return `
      <tr data-id="${l.id}">
        <td>${escapeHtml(pseudoniem(l.voornaam, l.achternaam))}</td>
        <td>${escapeHtml(groepNaam.get(l.groep_id) || '')}</td>
        <td class="leergeld-bedrag">€ <input type="number" min="0" step="0.01"
              class="leergeld-bedrag-input" data-id="${l.id}" value="${bedrag.toFixed(2)}" /></td>
        <td><button class="mini-x" data-ontkoppel="${l.id}" title="Ontkoppelen">✕</button></td>
      </tr>`;
    })
    .join('');
}

const OPSLAG_SLEUTEL = 'overzicht_ingeklapte_maanden';

function leesIngeklapt() {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPSLAG_SLEUTEL) || '[]'));
  } catch {
    return new Set();
  }
}

function bewaarIngeklapt(set) {
  localStorage.setItem(OPSLAG_SLEUTEL, JSON.stringify([...set]));
}

export async function renderOverzicht(root) {
  const schooljaar = getHuidigSchooljaar();
  const dagprijs = Number(schooljaar?.tso_dagprijs) || 0;
  const groepen = schooljaar ? await getGroepen(schooljaar.id) : [];
  const dagen = await getTsoDagen(groepen.map((g) => g.id));

  // Snelle opzoektabel: "groepId:maand" -> aantal dagen
  const kaart = new Map();
  for (const d of dagen) kaart.set(`${d.groep_id}:${d.maand}`, d.dagen);

  if (groepen.length === 0) {
    root.innerHTML = `
      <header class="page-head">
        <h1>Overzicht</h1>
        <p class="muted">${schooljaar ? 'Schooljaar ' + schooljaar.naam : 'Nog geen schooljaar'}</p>
      </header>
      <div class="empty-state">
        <p>Er zijn nog geen groepen voor dit schooljaar. Ga naar
        <a href="#/import">Importeren</a> om een EDEX-bestand in te lezen.</p>
      </div>`;
    return;
  }

  // Jaartotaal (bedrag) per groep, gebruikt in de Leergeld-sectie.
  const groepNaam = new Map(groepen.map((g) => [g.id, g.naam]));
  function groepJaarTotaal(gid) {
    let t = 0;
    for (let m = 1; m <= MAANDEN.length; m++) {
      const v = kaart.get(`${gid}:${m}`);
      if (v != null && v !== '') t += Number(v) * dagprijs;
    }
    return t;
  }

  // Alle leerlingen van dit schooljaar ontsleutelen (voor zoeken/koppelen).
  const alleLeerlingen = [];
  if (isUnlocked()) {
    const rows = await getLeerlingen(groepen.map((g) => g.id));
    for (const r of rows) {
      let v = '⚠︎ onleesbaar';
      let a = '';
      try {
        ({ v, a } = JSON.parse(await decryptText(r.enc_naam, r.iv)));
      } catch {
        /* onleesbaar */
      }
      alleLeerlingen.push({
        id: r.id,
        voornaam: v,
        achternaam: a,
        groep_id: r.groep_id,
        leergeld: r.leergeld,
        leergeld_bedrag: r.leergeld_bedrag,
      });
    }
  }

  const ingeklapt = leesIngeklapt();

  // Kolomkoppen — klikbaar om in/uit te klappen
  const maandKoppen = MAANDEN.map((m, i) => {
    const maand = i + 1;
    const dicht = ingeklapt.has(maand) ? ' ingeklapt' : '';
    return `
      <th class="maand${dicht}" data-col="${maand}">
        <button class="maand-kop" data-col="${maand}"
                title="Klik om in of uit te klappen">
          <span class="maand-vol">${m}</span>
          <span class="maand-kort">${MAANDEN_KORT[i]}</span>
        </button>
      </th>`;
  }).join('');

  // Rijen
  const rijen = groepen
    .map((g) => {
      const cellen = MAANDEN.map((_, i) => {
        const maand = i + 1;
        const waarde = kaart.get(`${g.id}:${maand}`) ?? '';
        const dicht = ingeklapt.has(maand) ? ' ingeklapt' : '';
        return `
          <td class="cel${dicht}" data-col="${maand}">
            <div class="cel-inhoud">
              <input class="dagen-input" type="number" min="0" step="1"
                     inputmode="numeric"
                     value="${waarde}"
                     data-groep="${g.id}" data-maand="${maand}"
                     aria-label="${g.naam} — ${MAANDEN[i]}" />
              <span class="bedrag" data-groep="${g.id}" data-maand="${maand}">
                ${waarde === '' ? '—' : euro.format(Number(waarde) * dagprijs)}
              </span>
            </div>
          </td>`;
      }).join('');

      return `
        <tr>
          <th class="groep-cel" scope="row">
            <a class="groep-link" href="#/groep/${g.id}">${g.naam}</a>
          </th>
          ${cellen}
          <td class="totaal-cel" data-groep-totaal="${g.id}">€ 0,00</td>
        </tr>`;
    })
    .join('');

  root.innerHTML = `
    <header class="page-head">
      <h1>Overzicht</h1>
      <p class="muted">Schooljaar ${schooljaar.naam} · €${dagprijs
    .toFixed(2)
    .replace('.', ',')} per TSO-dag · vul per groep en maand het aantal TSO-dagen in</p>
    </header>

    <div class="tabel-wrap">
      <table class="overzicht-tabel">
        <thead>
          <tr>
            <th class="hoek">Groep</th>
            ${maandKoppen}
            <th class="totaal-kop">Totaal</th>
          </tr>
        </thead>
        <tbody>
          ${rijen}
        </tbody>
      </table>
    </div>
    <p id="save-status" class="save-status" aria-live="polite"></p>

    <section class="kaart leergeld-sectie">
      <h2>Leergeld</h2>
      <p class="muted">Leerlingen waarvan Stichting Leergeld de kosten vergoedt. Zij doen niet mee met de maandelijkse betalingen en staan op de groepspagina zacht oranje gemarkeerd.</p>

      <div class="leergeld-zoek">
        <input type="text" id="leergeld-zoek" placeholder="Zoek een leerling om te koppelen…" autocomplete="off" />
        <div class="zoek-resultaten" id="zoek-resultaten" hidden></div>
      </div>

      <table class="import-tabel leergeld-tabel">
        <thead><tr><th>Naam</th><th>Groep</th><th>Bedrag</th><th></th></tr></thead>
        <tbody id="leergeld-body">${leergeldRijenHtml(alleLeerlingen, groepNaam, groepJaarTotaal)}</tbody>
      </table>
    </section>
  `;

  // --- Interactie ---------------------------------------------------------

  const status = root.querySelector('#save-status');
  let statusTimer = null;
  function meldOpgeslagen() {
    status.textContent = 'Opgeslagen ✓';
    status.classList.add('zichtbaar');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.classList.remove('zichtbaar'), 1500);
  }

  function herbereken() {
    let eindtotaal = 0;
    for (const g of groepen) {
      let groepTotaal = 0;
      for (let i = 1; i <= MAANDEN.length; i++) {
        const v = kaart.get(`${g.id}:${i}`);
        if (v != null && v !== '') groepTotaal += Number(v) * dagprijs;
      }
      const cel = root.querySelector(`[data-groep-totaal="${g.id}"]`);
      if (cel) cel.textContent = euro.format(groepTotaal);
      eindtotaal += groepTotaal;
    }
  }
  herbereken();

  // Debounced opslaan per cel.
  const timers = new Map();

  root.querySelectorAll('.dagen-input').forEach((input) => {
    input.addEventListener('input', () => {
      const groep = input.dataset.groep;
      const maand = Number(input.dataset.maand);
      const ruw = input.value.trim();
      const bedragEl = root.querySelector(
        `.bedrag[data-groep="${groep}"][data-maand="${maand}"]`
      );

      if (ruw === '') {
        kaart.delete(`${groep}:${maand}`);
        bedragEl.textContent = '—';
      } else {
        const dagenNum = Math.max(0, Math.floor(Number(ruw) || 0));
        kaart.set(`${groep}:${maand}`, dagenNum);
        bedragEl.textContent = euro.format(dagenNum * dagprijs);
      }
      herbereken();

      const sleutel = `${groep}:${maand}`;
      clearTimeout(timers.get(sleutel));
      timers.set(
        sleutel,
        setTimeout(async () => {
          const dagenNum = ruw === '' ? 0 : Math.max(0, Math.floor(Number(ruw) || 0));
          try {
            await upsertTsoDagen(groep, maand, dagenNum);
            meldOpgeslagen();
          } catch (e) {
            console.error(e);
            status.textContent = 'Opslaan mislukt — probeer opnieuw';
            status.classList.add('zichtbaar', 'fout');
          }
        }, 500)
      );
    });
  });

  // In/uitklappen van maandkolommen (staat onthouden in localStorage).
  root.querySelectorAll('.maand-kop').forEach((knop) => {
    knop.addEventListener('click', () => {
      const maand = Number(knop.dataset.col);
      const nuDicht = ingeklapt.has(maand);
      if (nuDicht) ingeklapt.delete(maand);
      else ingeklapt.add(maand);
      bewaarIngeklapt(ingeklapt);

      root
        .querySelectorAll(`[data-col="${maand}"]`)
        .forEach((el) => el.classList.toggle('ingeklapt', !nuDicht));
    });
  });

  // --- Leergeld: zoeken en koppelen --------------------------------------
  const zoek = root.querySelector('#leergeld-zoek');
  const resultaten = root.querySelector('#zoek-resultaten');

  zoek.addEventListener('input', () => {
    const q = zoek.value.trim().toLowerCase();
    if (!q) {
      resultaten.hidden = true;
      resultaten.innerHTML = '';
      return;
    }
    const treffers = alleLeerlingen
      .filter((l) => !l.leergeld)
      .filter((l) => `${l.voornaam} ${l.achternaam}`.toLowerCase().includes(q))
      .slice(0, 8);

    resultaten.innerHTML = treffers.length
      ? treffers
          .map(
            (l) => `<button class="zoek-item" data-koppel="${l.id}">
              <span>${escapeHtml(pseudoniem(l.voornaam, l.achternaam))}</span>
              <span class="muted">${escapeHtml(groepNaam.get(l.groep_id) || '')}</span>
            </button>`
          )
          .join('')
      : '<div class="zoek-leeg">Geen leerlingen gevonden.</div>';
    resultaten.hidden = false;
  });

  resultaten.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-koppel]');
    if (!btn) return;
    const l = alleLeerlingen.find((x) => x.id === btn.dataset.koppel);
    const startbedrag = l ? groepJaarTotaal(l.groep_id) : 0;
    await setLeergeld(btn.dataset.koppel, { leergeld: true, leergeld_bedrag: startbedrag });
    await renderOverzicht(root);
  });

  const leergeldBody = root.querySelector('#leergeld-body');
  leergeldBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-ontkoppel]');
    if (!btn) return;
    await setLeergeld(btn.dataset.ontkoppel, { leergeld: false });
    await renderOverzicht(root);
  });

  // Bedrag handmatig aanpassen (opslaan bij wijzigen/verlaten van het veld).
  leergeldBody.addEventListener('change', async (e) => {
    const input = e.target.closest('.leergeld-bedrag-input');
    if (!input) return;
    const bedrag = Math.max(0, Number(input.value) || 0);
    input.value = bedrag.toFixed(2);
    try {
      await setLeergeld(input.dataset.id, { leergeld_bedrag: bedrag });
    } catch (err) {
      console.error(err);
    }
  });
}
