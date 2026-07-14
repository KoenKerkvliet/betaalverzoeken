import { supabase } from './supabaseClient.js';

const form = document.getElementById('reset-form');
const p1 = document.getElementById('password');
const p2 = document.getElementById('password2');
const btn = document.getElementById('reset-btn');
const msg = document.getElementById('msg');

function toon(tekst, type = 'error') {
  msg.textContent = tekst;
  msg.className = 'msg ' + type;
}

// Als de gebruiker via de herstelmail komt, zet Supabase automatisch een
// tijdelijke "recovery"-sessie op. Zonder sessie kan hier niets gewijzigd worden.
(async () => {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    toon('Deze link is verlopen of ongeldig. Vraag een nieuwe herstelmail aan via de loginpagina.', 'info');
    btn.disabled = true;
  }
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (p1.value !== p2.value) {
    toon('De wachtwoorden komen niet overeen.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Bezig…';

  const { error } = await supabase.auth.updateUser({ password: p1.value });

  if (error) {
    toon('Kon het wachtwoord niet opslaan. Vraag eventueel een nieuwe herstelmail aan.');
    btn.disabled = false;
    btn.textContent = 'Wachtwoord opslaan';
    return;
  }

  toon('Wachtwoord opgeslagen. Je wordt doorgestuurd naar het inloggen…', 'success');
  setTimeout(() => window.location.replace('index.html'), 1800);
});
