import { getGroepen, getLeerlingen, insertLeerlingen, deleteLeerling } from './data.js';
import { encryptText, decryptText, isUnlocked } from './crypto.js';

// Maakt van {voornaam, achternaam} het pseudoniem "Voornaam A."
function pseudoniem(v, a) {
  const init = a ? ` ${a.trim()[0].toUpperCase()}.` : '';
  return `${v}${init}`;
}

export async function renderGroep(root, id) {
  const groepen = await getGroepen();
  const groep = groepen.find((g) => g.id === id);

  if (!groep) {
    root.innerHTML =
      '<div class="empty-state">Deze groep bestaat niet (meer). Kies een groep in de zijbalk.</div>';
    return;
  }

  if (!isUnlocked()) {
    root.innerHTML = `
      <header class="page-head"><h1>Groep ${groep.naam}</h1></header>
      <div class="empty-state">De encryptie is niet ontgrendeld. Herlaad de pagina en voer je passphrase in.</div>`;
    return;
  }

  // Leerlingen ophalen en ontsleutelen
  const rijen = await getLeerlingen(id);
  const leerlingen = [];
  for (const r of rijen) {
    try {
      const { v, a } = JSON.parse(await decryptText(r.enc_naam, r.iv));
      leerlingen.push({ id: r.id, voornaam: v, achternaam: a });
    } catch {
      leerlingen.push({ id: r.id, voornaam: '⚠︎ onleesbaar', achternaam: '' });
    }
  }
  leerlingen.sort((x, y) => x.voornaam.localeCompare(y.voornaam, 'nl'));

  root.innerHTML = `
    <header class="page-head">
      <h1>Groep ${groep.naam}</h1>
      <p class="muted">${leerlingen.length} leerling(en) · namen zijn versleuteld opgeslagen</p>
    </header>

    <section class="kaart">
      <h2>Leerlingen</h2>
      <ul class="groep-lijst" id="leerling-lijst">
        ${
          leerlingen
            .map(
              (l) => `
          <li data-id="${l.id}">
            <span class="groep-naam">${pseudoniem(l.voornaam, l.achternaam)}</span>
            <span class="groep-acties">
              <button class="btn btn-ghost btn-danger" data-delete>Verwijderen</button>
            </span>
          </li>`
            )
            .join('') || '<li class="muted">Nog geen leerlingen. Voeg ze toe of gebruik Importeren.</li>'
        }
      </ul>

      <form id="leerling-form" class="inline-form">
        <label>Voornaam
          <input type="text" id="voornaam" required maxlength="60" placeholder="bijv. Sanne" />
        </label>
        <label>Achternaam
          <input type="text" id="achternaam" maxlength="60" placeholder="bijv. de Vries" />
        </label>
        <button type="submit" class="btn btn-primary">Toevoegen</button>
      </form>
      <p class="muted" style="font-size:12px;margin-top:8px">Op het scherm zie je alleen voornaam + eerste letter achternaam. De volledige naam wordt versleuteld opgeslagen.</p>
    </section>
  `;

  // Toevoegen
  root.querySelector('#leerling-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const voornaam = root.querySelector('#voornaam').value.trim();
    const achternaam = root.querySelector('#achternaam').value.trim();
    if (!voornaam) return;
    const enc = await encryptText(JSON.stringify({ v: voornaam, a: achternaam }));
    await insertLeerlingen([{ groep_id: id, enc_naam: enc.ct, iv: enc.iv }]);
    await renderGroep(root, id);
  });

  // Verwijderen
  root.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const li = btn.closest('li');
      const naam = li.querySelector('.groep-naam').textContent;
      if (window.confirm(`Leerling "${naam}" verwijderen?`)) {
        await deleteLeerling(li.dataset.id);
        await renderGroep(root, id);
      }
    });
  });
}
