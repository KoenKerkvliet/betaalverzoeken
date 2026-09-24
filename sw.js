// Service worker voor de installeerbare app (PWA).
//
// Bewust minimaal: alleen de offline-melding wordt gecachet. Alle andere
// verzoeken (HTML, CSS, JS, Supabase, CDN) gaan gewoon over het netwerk, zodat
// er geen gegevens op het apparaat blijven staan en je na een deploy nooit een
// oude versie van de app ziet. Verhoog VERSIE als offline.html verandert.
const VERSIE = 'v1';
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

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Paginanavigatie: netwerk, en alleen bij geen verbinding de offline-melding.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match('offline.html')) || Response.error())
    );
    return;
  }

  // Het icoon op de offline-pagina moet ook zonder netwerk laden.
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.endsWith('/icons/icon-192.png')) {
    event.respondWith(fetch(req).catch(async () => (await caches.match('icons/icon-192.png')) || Response.error()));
  }
  // Al het andere: niet onderscheppen, de browser handelt het af.
});
