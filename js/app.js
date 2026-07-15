import { supabase, vereisSessie } from './supabaseClient.js';
import { getGroepen, getInstellingen, getSchooljaren } from './data.js';
import { restoreKey, isUnlocked, lock } from './crypto.js';
import {
  setHuidigSchooljaar,
  getHuidigSchooljaar,
  getOpgeslagenSchooljaarId,
} from './state.js';
import { toonGate } from './gate.js';
import { renderOverzicht } from './overzicht.js';
import { renderInstellingen } from './instellingen.js';
import { renderGroep } from './groep.js';
import { renderImport } from './import.js';

const content = document.getElementById('content');
const navGroepen = document.getElementById('nav-groepen');
const logoutBtn = document.getElementById('logout-btn');
const schooljaarSelect = document.getElementById('schooljaar-select');

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
