import { getGroepen, saveDagprijsSchooljaar, renameGroep, deleteGroep } from './data.js';
import { getHuidigSchooljaar } from './state.js';
import { mfaIngeschakeld, startEnroll, bevestigEnroll, schakelUit } from './mfa.js';

export async function renderInstellingen(root) {
  const schooljaar = getHuidigSchooljaar();

  if (!schooljaar) {
    root.innerHTML = `
      <header class="page-head"><h1>Instellingen</h1></header>
      <div class="empty-state">Er is nog geen schooljaar. Ga naar
        <a href="#/import">Importeren</a> om een EDEX-bestand in te lezen.</div>`;
    return;
  }

  const groepen = await getGroepen(schooljaar.id);

  root.innerHTML = `
    <header class="page-head">
      <h1>Instellingen</h1>
      <p class="muted">Schooljaar ${schooljaar.naam}</p>
    </header>

    <section class="kaart">
      <h2>TSO-kosten</h2>
      <p class="muted">Kosten voor één TSO-dag in schooljaar ${schooljaar.naam}. Elk schooljaar heeft een eigen prijs.</p>
      <form id="prijs-form" class="inline-form">
        <label>
          Prijs per dag (€)
          <input type="number" id="dagprijs" min="0" step="0.01" value="${Number(
            schooljaar.tso_dagprijs
          ).toFixed(2)}" required />
        </label>
        <button type="submit" class="btn btn-primary">Opslaan</button>
        <span id="prijs-status" class="save-status"></span>
      </form>
    </section>

    <section class="kaart">
      <h2>Groepen</h2>
      <p class="muted">Groepen komen uit de EDEX-import (<a href="#/import">Importeren</a>). Je kunt ze hier hernoemen of verwijderen.</p>

      <ul class="groep-lijst" id="groep-lijst">
        ${groepen.map(groepRij).join('') || '<li class="muted">Nog geen groepen. Importeer een EDEX-bestand.</li>'}
      </ul>
    </section>

    <section class="kaart">
      <h2>Tweestapsverificatie (2FA)</h2>
      <div id="mfa-inhoud"><p class="muted">Laden…</p></div>
    </section>
  `;

  bouwMfaSectie(root.querySelector('#mfa-inhoud'));

  // --- Dagprijs (per schooljaar) -----------------------------------------
  const prijsForm = root.querySelector('#prijs-form');
  const prijsStatus = root.querySelector('#prijs-status');
  prijsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prijs = Number(root.querySelector('#dagprijs').value);
    try {
      await saveDagprijsSchooljaar(schooljaar.id, prijs);
      schooljaar.tso_dagprijs = prijs; // lokaal bijwerken
      prijsStatus.textContent = 'Opgeslagen ✓';
      prijsStatus.classList.add('zichtbaar');
      setTimeout(() => prijsStatus.classList.remove('zichtbaar'), 1500);
    } catch (err) {
      console.error(err);
      prijsStatus.textContent = 'Opslaan mislukt';
    }
  });

  // --- Groep hernoemen / verwijderen -------------------------------------
  root.querySelectorAll('[data-rename]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const li = btn.closest('li');
      const id = li.dataset.id;
      const huidig = li.querySelector('.groep-naam').textContent;
      const nieuw = window.prompt('Nieuwe naam voor deze groep:', huidig);
      if (nieuw && nieuw.trim() && nieuw.trim() !== huidig) {
        await renameGroep(id, nieuw.trim());
        await renderInstellingen(root);
      }
    });
  });

  root.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const li = btn.closest('li');
      const id = li.dataset.id;
      const naam = li.querySelector('.groep-naam').textContent;
      if (
        window.confirm(
          `Groep "${naam}" verwijderen? De TSO-dagen én leerlingen van deze groep worden ook verwijderd.`
        )
      ) {
        await deleteGroep(id);
        await renderInstellingen(root);
      }
    });
  });
}

function qrHtml(qr) {
  const s = String(qr || '').trim();
  return s.startsWith('<') ? s : `<img class="mfa-qr" src="${s}" alt="QR-code" />`;
}

async function bouwMfaSectie(container) {
  let status;
  try {
    status = await mfaIngeschakeld();
  } catch {
    container.innerHTML = '<p class="msg error">Kon de 2FA-status niet laden.</p>';
    return;
  }

  if (status.enrolled) {
    container.innerHTML = `
      <p class="mfa-aan">✔ Tweestapsverificatie staat <strong>aan</strong>. Bij het inloggen vraagt de app na je wachtwoord een code uit je authenticator-app.</p>
      <button type="button" class="btn btn-ghost btn-danger" id="mfa-uit">Uitschakelen</button>`;
    container.querySelector('#mfa-uit').addEventListener('click', async () => {
      if (!window.confirm('Tweestapsverificatie uitschakelen? Je logt daarna weer alleen met je wachtwoord in.')) return;
      try {
        await schakelUit(status.factorId);
      } catch (e) {
        console.error(e);
      }
      bouwMfaSectie(container);
    });
    return;
  }

  container.innerHTML = `
    <p class="muted">Beveilig het inloggen met een authenticator-app (Google Authenticator, Microsoft Authenticator, Authy, 1Password, …). Naast je wachtwoord vraagt de app dan een 6-cijferige code.</p>
    <button type="button" class="btn btn-primary" id="mfa-start">2FA instellen</button>`;

  container.querySelector('#mfa-start').addEventListener('click', async () => {
    let enroll;
    try {
      enroll = await startEnroll();
    } catch (e) {
      console.error(e);
      container.querySelector('#mfa-start').insertAdjacentHTML(
        'afterend',
        '<p class="msg error">Instellen mislukt. Probeer het opnieuw.</p>'
      );
      return;
    }

    container.innerHTML = `
      <p class="muted">1. Scan deze QR-code met je authenticator-app (of voer de sleutel handmatig in).</p>
      <div class="mfa-enroll">
        <div class="mfa-qr-wrap">${qrHtml(enroll.qr)}</div>
        <div class="mfa-secret">
          <span class="muted">Handmatige sleutel</span>
          <code>${enroll.secret}</code>
          <span class="muted" style="font-size:12px">Bewaar deze in je wachtwoordkluis als back-up.</span>
        </div>
      </div>
      <p class="muted">2. Voer de 6-cijferige code uit de app in om te bevestigen.</p>
      <form id="mfa-bevestig-form" class="inline-form">
        <label>Code
          <input type="text" id="mfa-enroll-code" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code" />
        </label>
        <button type="submit" class="btn btn-primary">Bevestigen</button>
        <button type="button" class="btn btn-ghost" id="mfa-annuleer">Annuleren</button>
        <span id="mfa-enroll-msg" class="msg"></span>
      </form>`;

    const codeInp = container.querySelector('#mfa-enroll-code');
    codeInp.focus();
    codeInp.addEventListener('input', () => {
      codeInp.value = codeInp.value.replace(/\D/g, '').slice(0, 6);
    });
    container.querySelector('#mfa-annuleer').addEventListener('click', () => bouwMfaSectie(container));
    container.querySelector('#mfa-bevestig-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = container.querySelector('#mfa-enroll-msg');
      try {
        await bevestigEnroll(enroll.factorId, codeInp.value.trim());
        bouwMfaSectie(container);
      } catch (err) {
        console.error(err);
        msg.textContent = 'Onjuiste code, probeer opnieuw.';
        msg.className = 'msg error';
      }
    });
  });
}

function groepRij(g) {
  return `
    <li data-id="${g.id}">
      <span class="groep-naam">${g.naam}</span>
      <span class="groep-acties">
        <button class="btn btn-ghost" data-rename title="Naam wijzigen">Hernoemen</button>
        <button class="btn btn-ghost btn-danger" data-delete title="Verwijderen">Verwijderen</button>
      </span>
    </li>`;
}
