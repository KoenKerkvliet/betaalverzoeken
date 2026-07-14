import { supabase } from './supabaseClient.js';

const form = document.getElementById('login-form');
const emailEl = document.getElementById('email');
const passwordEl = document.getElementById('password');
const btn = document.getElementById('login-btn');
const msg = document.getElementById('msg');
const forgot = document.getElementById('forgot-link');

function toon(tekst, type = 'error') {
  msg.textContent = tekst;
  msg.className = 'msg ' + type;
}

// Al ingelogd? Meteen door naar het dashboard.
(async () => {
  const { data } = await supabase.auth.getSession();
  if (data.session) window.location.replace('app.html');
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  toon('', '');
  btn.disabled = true;
  btn.textContent = 'Bezig…';

  const { error } = await supabase.auth.signInWithPassword({
    email: emailEl.value.trim(),
    password: passwordEl.value,
  });

  if (error) {
    toon('Inloggen mislukt. Controleer je e-mailadres en wachtwoord.');
    btn.disabled = false;
    btn.textContent = 'Inloggen';
    return;
  }

  window.location.replace('app.html');
});

forgot.addEventListener('click', async (e) => {
  e.preventDefault();
  const email = (emailEl.value || '').trim();
  if (!email) {
    toon('Vul eerst je e-mailadres in en klik dan op "Wachtwoord vergeten?".', 'info');
    emailEl.focus();
    return;
  }

  const redirectTo = new URL('reset.html', window.location.href).href;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  if (error) {
    toon('Kon geen herstelmail versturen. Probeer het later opnieuw.');
    return;
  }
  toon('Als dit e-mailadres bekend is, is er een herstelmail verstuurd.', 'success');
});
