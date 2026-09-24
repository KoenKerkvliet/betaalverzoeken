// Registreert de service worker zodat de app te installeren is (PWA).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker registreren mislukt:', err);
    });
  });
}
