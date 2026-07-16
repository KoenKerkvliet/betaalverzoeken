import { supabase, vereisSessie } from './supabaseClient.js';
import {
  getGroepen,
  getInstellingen,
  getSchooljaren,
  getLeerlingen,
  addOvergemaakt,
  getOvergemaaktOpmerkingen,
} from './data.js';
import { MAANDEN } from './config.js';
import { parseBedrag, escapeAttr, pseudoniem, normaliseer } from './util.js';
import { restoreKey, isUnlocked, lock, decryptText } from './crypto.js';
import {
  setHuidigSchooljaar,
  getHuidigSchooljaar,
  getOpgeslagenSchooljaarId,
} from './state.js';
import { toonGate } from './gate.js';
import {
  openDeelnemersRapport,
  openstaandeBetalingenRapport,
  binnengekomenBetalingenRapport,
  totaaloverzichtRapport,
} from './rapport.js';
import { renderOverzicht } from './overzicht.js';
import { renderInstellingen } from './instellingen.js';
import { renderGroep } from './groep.js';
import { renderImport } from './import.js';

const content = document.getElementById('content');
const navGroepen = document.getElementById('nav-groepen');
const logoutBtn = document.getElementById('logout-btn');
const schooljaarSelect = document.getElementById('schooljaar-select');
const betalingBtn = document.getElementById('betaling-btn');
const zoekInput = document.getElementById('zoek-leerling');
const zoekResultaat = document.getElementById('zoek-resultaat');

let zoekIndex = null; // gecachte, ontsleutelde leerlingenlijst (per schooljaar)

function parseRoute() {
  const raw = window.location.hash.replace(/^#\//, '');
  const [base, id] = raw.split('/');
  if (base === 'instellingen') return { name: 'instellingen', key: 'instellingen' };
  if (base === 'import') return { name: 'import', key: 'import' };
  if (base === 'groep' && id) return { name: 'groep', id, key: `groep/${id}` };
  return { name: 'overzicht', key: 'overzicht' };
}

function markeerActief(routeKey) {
  document.querySelectorAll('[data-route]').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === routeKey);
  });
}

// Vult de sidebar met de groepen van het geselecteerde schooljaar.
async function renderNav() {
  const sj = getHuidigSchooljaar();
  const groepen = sj ? await getGroepen(sj.id) : [];
  navGroepen.innerHTML = groepen
    .map(
      (g) =>
        `<a href="#/groep/${g.id}" data-route="groep/${g.id}" class="nav-item nav-groep">${g.naam}</a>`
    )
    .join('');
}

async function render() {
  const route = parseRoute();
  markeerActief(route.key);
  content.innerHTML = '<div class="loader">Laden…</div>';
  try {
    if (route.name === 'instellingen') {
      await renderInstellingen(content);
      await renderNav(); // groepen kunnen zijn gewijzigd
    } else if (route.name === 'import') {
      await renderImport(content, herstartNaImport);
    } else if (route.name === 'groep') {
      await renderGroep(content, route.id);
    } else {
      await renderOverzicht(content);
    }
    markeerActief(route.key);
  } catch (err) {
    console.error(err);
    content.innerHTML =
      '<div class="error-box">Er ging iets mis bij het laden. ' +
      'Controleer of de database is ingericht en de anon key in <code>js/config.js</code> klopt.</div>';
  }
}

// Laadt de schooljaren en vult de switcher. Kiest het opgeslagen jaar of het nieuwste.
async function laadSchooljaren(voorkeurId) {
  zoekIndex = null; // andere leerlingen bij ander schooljaar
  const jaren = await getSchooljaren();
  schooljaarSelect.innerHTML = jaren
    .map((s) => `<option value="${s.id}">${s.naam}</option>`)
    .join('');

  if (!jaren.length) {
    setHuidigSchooljaar(null);
    return;
  }

  const gewenst = voorkeurId || getOpgeslagenSchooljaarId();
  const gekozen = jaren.find((s) => s.id === gewenst) || jaren[0];
  schooljaarSelect.value = gekozen.id;
  setHuidigSchooljaar(gekozen);
}

// Na een import: (her)laad schooljaren, spring naar het geïmporteerde jaar.
async function herstartNaImport(schooljaarId) {
  await laadSchooljaren(schooljaarId);
  await renderNav();
  window.location.hash = '#/overzicht';
  render();
}

schooljaarSelect.addEventListener('change', async () => {
  await laadSchooljaren(schooljaarSelect.value);
  await renderNav();
  window.location.hash = '#/overzicht';
  render();
});

logoutBtn.addEventListener('click', async () => {
  lock();
  await supabase.auth.signOut();
  window.location.replace('index.html');
});

// Betaling toevoegen (overgemaakt) via de header-knop.
async function openBetalingModal() {
  const sj = getHuidigSchooljaar();
  if (!sj) return;

  let suggesties = [];
  try {
    suggesties = await getOvergemaaktOpmerkingen();
  } catch (e) {
    console.error(e);
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-kop">
        <h2>Betaling toevoegen</h2>
        <button type="button" class="modal-x" aria-label="Sluiten">✕</button>
      </div>
      <p class="muted" style="margin-top:0">Voeg een bijgeschreven bedrag toe onder "Overgemaakt" (schooljaar ${sj.naam}). Meerdere betalingen in dezelfde maand worden opgeteld.</p>
      <form id="betaling-form" class="modal-form">
        <label>Bedrag (€)
          <input type="text" id="bet-bedrag" inputmode="decimal" placeholder="bijv. 3000,00" required />
        </label>
        <label>Maand
          <select id="bet-maand">${MAANDEN.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select>
        </label>
        <label>Opmerking (optioneel)
          <input type="text" id="bet-opm" list="bet-opm-lijst" maxlength="200"
                 placeholder="kies een eerdere of typ een nieuwe" />
          <datalist id="bet-opm-lijst">
            ${suggesties.map((s) => `<option value="${escapeAttr(s)}"></option>`).join('')}
          </datalist>
        </label>
        <button type="submit" class="btn btn-primary">Toevoegen</button>
        <p id="bet-msg" class="msg"></p>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  const sluit = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) sluit();
  });
  overlay.querySelector('.modal-x').addEventListener('click', sluit);
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') sluit();
  });
  overlay.querySelector('#bet-bedrag').focus();

  overlay.querySelector('#betaling-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = overlay.querySelector('#bet-msg');
    const bedrag = parseBedrag(overlay.querySelector('#bet-bedrag').value);
    const maand = Number(overlay.querySelector('#bet-maand').value);
    const opm = overlay.querySelector('#bet-opm').value.trim();
    if (!bedrag) {
      msg.textContent = 'Vul een geldig bedrag in.';
      msg.className = 'msg error';
      return;
    }
    try {
      await addOvergemaakt(sj.id, maand, bedrag, opm);
      sluit();
      render(); // ververs de huidige pagina (overzicht toont de nieuwe som)
    } catch (err) {
      console.error(err);
      msg.textContent = 'Opslaan mislukt.';
      msg.className = 'msg error';
    }
  });
}

betalingBtn.addEventListener('click', openBetalingModal);

// --- Overzichten-dropdown ----------------------------------------------
const overzichtenBtn = document.getElementById('overzichten-btn');
const overzichtenDropdown = document.getElementById('overzichten-dropdown');
overzichtenBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  overzichtenDropdown.hidden = !overzichtenDropdown.hidden;
});
overzichtenDropdown.addEventListener('click', (e) => {
  const item = e.target.closest('[data-rapport]');
  if (!item) return;
  overzichtenDropdown.hidden = true;
  const acties = {
    deelnemers: openDeelnemersRapport,
    openstaand: openstaandeBetalingenRapport,
    binnengekomen: binnengekomenBetalingenRapport,
    totaal: totaaloverzichtRapport,
  };
  acties[item.dataset.rapport]?.();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#overzichten-menu')) overzichtenDropdown.hidden = true;
});

// --- Leerling zoeken in de header --------------------------------------
async function laadZoekIndex() {
  if (zoekIndex) return zoekIndex;
  const sj = getHuidigSchooljaar();
  if (!sj || !isUnlocked()) return [];
  const groepen = await getGroepen(sj.id);
  const groepNaam = new Map(groepen.map((g) => [g.id, g.naam]));
  const rows = await getLeerlingen(groepen.map((g) => g.id));
  const lijst = [];
  for (const r of rows) {
    let v = '';
    let a = '';
    try {
      ({ v, a } = JSON.parse(await decryptText(r.enc_naam, r.iv)));
    } catch {
      /* onleesbaar */
    }
    lijst.push({
      voornaam: v,
      achternaam: a,
      groep_id: r.groep_id,
      groep: groepNaam.get(r.groep_id) || '',
      zoek: normaliseer(`${v} ${a}`),
    });
  }
  zoekIndex = lijst;
  return lijst;
}

zoekInput.addEventListener('input', async () => {
  const q = normaliseer(zoekInput.value);
  if (!q) {
    zoekResultaat.hidden = true;
    zoekResultaat.innerHTML = '';
    return;
  }
  const idx = await laadZoekIndex();
  const treffers = idx.filter((l) => l.zoek.includes(q)).slice(0, 10);
  zoekResultaat.innerHTML = treffers.length
    ? treffers
        .map(
          (l) => `<button class="zoek-item" data-groep="${l.groep_id}">
            <span>${escapeAttr(pseudoniem(l.voornaam, l.achternaam))}</span>
            <span class="muted">${escapeAttr(l.groep)}</span>
          </button>`
        )
        .join('')
    : '<div class="zoek-leeg">Geen leerling gevonden.</div>';
  zoekResultaat.hidden = false;
});

zoekResultaat.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-groep]');
  if (!btn) return;
  zoekInput.value = '';
  zoekResultaat.hidden = true;
  zoekResultaat.innerHTML = '';
  window.location.hash = `#/groep/${btn.dataset.groep}`;
});

zoekInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    zoekInput.value = '';
    zoekResultaat.hidden = true;
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.topbar-zoek')) zoekResultaat.hidden = true;
});

// Zorgt dat de encryptie is ingesteld (eerste keer) en ontgrendeld.
async function ontgrendelIndienNodig() {
  const instellingen = await getInstellingen();
  if (!instellingen.enc_salt) {
    await toonGate('setup', instellingen);
  } else {
    await restoreKey();
    if (!isUnlocked()) await toonGate('unlock', instellingen);
  }
}

window.addEventListener('hashchange', render);

(async () => {
  const sessie = await vereisSessie();
  if (!sessie) return; // vereisSessie stuurt zelf door naar login
  await ontgrendelIndienNodig();
  await laadSchooljaren();
  if (!window.location.hash) window.location.hash = '#/overzicht';
  await renderNav();
  render();
})();
