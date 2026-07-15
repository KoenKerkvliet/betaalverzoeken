import { setupEncryptie, unlockEncryptie } from './crypto.js';
import { saveEncryptieSetup } from './data.js';

// Toont een volledig scherm om de encryptie in te stellen (eerste keer) of te
// ontgrendelen. Resolvt de Promise zodra de sleutel actief is.
export function toonGate(mode, instellingen) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate-overlay';
    overlay.innerHTML = mode === 'setup' ? setupHtml() : unlockHtml();
    document.body.appendChild(overlay);

    const msg = overlay.querySelector('#gate-msg');
    const toon = (t, type = 'error') => {
      msg.textContent = t;
      msg.className = 'msg ' + type;
    };

    if (mode === 'setup') {
      const form = overlay.querySelector('#gate-form');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const p1 = overlay.querySelector('#pass1').value;
        const p2 = overlay.querySelector('#pass2').value;
        if (p1.length < 10) return toon('Kies een passphrase van minstens 10 tekens.');
        if (p1 !== p2) return toon('De twee invoervelden komen niet overeen.');

        const btn = overlay.querySelector('#gate-btn');
        btn.disabled = true;
        btn.textContent = 'Bezig…';
        try {
          const velden = await setupEncryptie(p1);
          await saveEncryptieSetup(velden);
          overlay.remove();
          resolve();
        } catch (err) {
          console.error(err);
          toon('Instellen mislukt. Probeer het opnieuw.');
          btn.disabled = false;
          btn.textContent = 'Encryptie instellen';
        }
      });
    } else {
      const form = overlay.querySelector('#gate-form');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pass = overlay.querySelector('#pass1').value;
        const btn = overlay.querySelector('#gate-btn');
        btn.disabled = true;
        btn.textContent = 'Bezig…';
        try {
          const ok = await unlockEncryptie(pass, instellingen);
          if (!ok) {
            toon('Onjuiste passphrase.');
            btn.disabled = false;
            btn.textContent = 'Ontgrendelen';
            return;
          }
          overlay.remove();
          resolve();
        } catch (err) {
          console.error(err);
          toon('Ontgrendelen mislukt. Probeer het opnieuw.');
          btn.disabled = false;
          btn.textContent = 'Ontgrendelen';
        }
      });
    }
  });
}

function setupHtml() {
  return `
    <div class="auth-card">
      <div class="auth-brand">
        <div class="auth-logo">🔒</div>
        <h1>Encryptie instellen</h1>
        <p class="muted">Kies een passphrase waarmee leerlingnamen worden versleuteld.</p>
      </div>
      <div class="privacy-note" style="margin-bottom:16px">
        Bewaar deze passphrase in je wachtwoordkluis. <strong>Gebruik niet je
        Supabase-wachtwoord.</strong> Ben je 'm kwijt, dan zijn versleutelde namen
        niet meer te herstellen.
      </div>
      <form id="gate-form" class="auth-form">
        <label>Passphrase
          <input type="password" id="pass1" required autocomplete="new-password" placeholder="minstens 10 tekens" />
        </label>
        <label>Herhaal passphrase
          <input type="password" id="pass2" required autocomplete="new-password" placeholder="••••••••" />
        </label>
        <button type="submit" class="btn btn-primary" id="gate-btn">Encryptie instellen</button>
        <p id="gate-msg" class="msg"></p>
      </form>
    </div>`;
}

function unlockHtml() {
  return `
    <div class="auth-card">
      <div class="auth-brand">
        <div class="auth-logo">🔓</div>
        <h1>Ontgrendelen</h1>
        <p class="muted">Voer je encryptie-passphrase in om leerlingnamen te kunnen zien.</p>
      </div>
      <form id="gate-form" class="auth-form">
        <label>Passphrase
          <input type="password" id="pass1" required autocomplete="off" placeholder="••••••••" autofocus />
        </label>
        <button type="submit" class="btn btn-primary" id="gate-btn">Ontgrendelen</button>
        <p id="gate-msg" class="msg"></p>
      </form>
    </div>`;
}
