import { supabase, vereisSessie } from './supabaseClient.js';
import { renderOverzicht } from './overzicht.js';
import { renderInstellingen } from './instellingen.js';

const content = document.getElementById('content');
const nav = document.getElementById('nav');
const logoutBtn = document.getElementById('logout-btn');

const routes = {
  overzicht: renderOverzicht,
  instellingen: renderInstellingen,
};

function huidigeRoute() {
  const hash = window.location.hash.replace(/^#\//, '');
  return routes[hash] ? hash : 'overzicht';
}

function markeerActief(route) {
  document.querySelectorAll('[data-route]').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === route);
  });
}

async function render() {
  const route = huidigeRoute();
  markeerActief(route);
  content.innerHTML = '<div class="loader">Laden…</div>';
  try {
    await routes[route](content);
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
  render();
})();
