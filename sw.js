// Service worker voor de installeerbare app (PWA).
//
// Bewust minimaal: alleen de offline-melding wordt gecachet. Alle andere
// verzoeken (HTML, CSS, JS, Supabase, CDN) gaan gewoon over het netwerk, zodat
// er geen gegevens op het apparaat blijven staan. Verhoog VERSIE als
// offline.html verandert.
//
// GitHub Pages laat browsers bestanden 10 minuten cachen (max-age=600). Na een
// deploy kreeg je daardoor soms nieuwe HTML of data met oude JavaScript. Daarom
// vragen we pagina's, JS en CSS van onze eigen site op met cache: 'no-cache':
// de browser controleert dan elke keer kort bij de server (304 als er niets
// veranderd is) en gebruikt nooit ongemerkt een verouderde versie.
const VERSIE = 'v2';
const CACHE = `tso-offline-${VERSIE}`;
const OFFLINE_BESTANDEN = ['offline.html', 'icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(OFFLINE_BESTANDEN))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(
        namen.filter((n) => n.startsWith('tso-offline-') && n !== CACHE).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Zelfde verzoek, maar met verplichte controle bij de server. Lukt het maken
// van die kopie niet (oudere browser), dan gewoon het originele verzoek.
function zonderVerouderdeCache(req) {
  try {
    return new Request(req, { cache: 'no-cache' });
  } catch {
    return req;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Paginanavigatie: netwerk, en alleen bij geen verbinding de offline-melding.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(zonderVerouderdeCache(req)).catch(
        async () => (await caches.match('offline.html')) || Response.error()
      )
    );
    return;
  }

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, CDN: niet onderscheppen

  // Het icoon op de offline-pagina moet ook zonder netwerk laden.
  if (url.pathname.endsWith('/icons/icon-192.png')) {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match('icons/icon-192.png')) || Response.error())
    );
    return;
  }

  // Eigen JS en CSS: altijd de actuele versie.
  if (/\.(js|css)$/.test(url.pathname)) {
    event.respondWith(fetch(zonderVerouderdeCache(req)));
  }
  // Al het andere: niet onderscheppen, de browser handelt het af.
});
