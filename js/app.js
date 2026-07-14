import { supabase, vereisSessie } from './supabaseClient.js';
import { getGroepen } from './data.js';
import { renderOverzicht } from './overzicht.js';
import { renderInstellingen } from './instellingen.js';
import { renderGroep } from './groep.js';

const content = document.getElementById('content');
const navGroepen = document.getElementById('nav-groepen');
const logoutBtn = document.getElementById('logout-btn');

function parseRoute() {
  const raw = window.location.hash.replace(/^#\//, '');
  const [base, id] = raw.split('/');
  if (base === 'instellingen') return { name: 'instellingen', key: 'instellingen' };
  if (base === 'groep' && id) return { name: 'groep', id, key: `groep/${id}` };
  return { name: 'overzicht', key: 'overzicht' };
}

function markeerActief(routeKey) {
  document.querySelectorAll('[data-route]').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === routeKey);
  });
}

// Vult de sidebar met alle groepen onder "Overzicht".
async function renderNav() {
  const groepen = await getGroepen();
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

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.replace('index.html');
});

window.addEventListener('hashchange', render);

(async () => {
  const sessie = await vereisSessie();
  if (!sessie) return; // vereisSessie stuurt zelf door naar login
  if (!window.location.hash) window.location.hash = '#/overzicht';
  await renderNav();
  render();
})();
