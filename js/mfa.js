// Tweestapsverificatie (2FA) via Supabase MFA — TOTP (authenticator-app).

import { supabase } from './supabaseClient.js';

// Is er een geverifieerde TOTP-factor? Geeft { enrolled, factorId }.
export async function mfaIngeschakeld() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return { enrolled: false, factorId: null };
  const totp = (data?.totp || []).find((f) => f.status === 'verified');
  return { enrolled: !!totp, factorId: totp?.id || null };
}

// Moet er na het wachtwoord nog een code worden ingevoerd (aal1 → aal2)?
export async function mfaChallengeNodig() {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return !!data && data.currentLevel === 'aal1' && data.nextLevel === 'aal2';
}

// Start het instellen: ruimt losse (niet-bevestigde) factoren op en enrollt een
// nieuwe. Geeft { factorId, qr, secret } terug om te tonen.
export async function startEnroll() {
  const { data: list } = await supabase.auth.mfa.listFactors();
  for (const f of (list?.all || []).filter((f) => f.status === 'unverified')) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Authenticator',
  });
  if (error) throw error;
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

async function challengeEnVerify(factorId, code) {
  const ch = await supabase.auth.mfa.challenge({ factorId });
  if (ch.error) throw ch.error;
  const ver = await supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code });
  if (ver.error) throw ver.error;
  return true;
}

// Bevestig het instellen met een code uit de app.
export async function bevestigEnroll(factorId, code) {
  return challengeEnVerify(factorId, code);
}

// Schakel 2FA uit.
export async function schakelUit(factorId) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

// Codescherm bij inloggen. Resolvt zodra de code klopt (aal2).
export function toonMfaGate(factorId) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'gate-overlay';
    overlay.innerHTML = `
      <div class="auth-card">
        <div class="auth-brand">
          <div class="auth-logo">🔐</div>
          <h1>Tweestapsverificatie</h1>
          <p class="muted">Voer de 6-cijferige code uit je authenticator-app in.</p>
        </div>
        <form id="mfa-form" class="auth-form">
          <label>Code
            <input type="text" id="mfa-code" inputmode="numeric" autocomplete="one-time-code"
                   maxlength="6" placeholder="123456" autofocus />
          </label>
          <button type="submit" class="btn btn-primary" id="mfa-btn">Verifiëren</button>
          <p class="auth-links"><a href="#" id="mfa-uitloggen">Uitloggen</a></p>
          <p id="mfa-msg" class="msg"></p>
        </form>
      </div>`;
    document.body.appendChild(overlay);

    const codeInput = overlay.querySelector('#mfa-code');
    const msg = overlay.querySelector('#mfa-msg');
    codeInput.focus();
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    });

    overlay.querySelector('#mfa-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = overlay.querySelector('#mfa-btn');
      btn.disabled = true;
      btn.textContent = 'Bezig…';
      try {
        await challengeEnVerify(factorId, codeInput.value.trim());
        overlay.remove();
        resolve();
      } catch (err) {
        console.error(err);
        msg.textContent = 'Onjuiste of verlopen code. Probeer opnieuw.';
        msg.className = 'msg error';
        btn.disabled = false;
        btn.textContent = 'Verifiëren';
        codeInput.select();
      }
    });

    overlay.querySelector('#mfa-uitloggen').addEventListener('click', async (e) => {
      e.preventDefault();
      await supabase.auth.signOut();
      window.location.replace('index.html');
    });
  });
}
