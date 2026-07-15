import { euro } from './supabaseClient.js';
import { MAANDEN } from './config.js';
import {
  getGroepen,
  getTsoDagen,
  getLeerlingen,
  insertLeerlingen,
  deleteLeerling,
  getBetalingen,
} from './data.js';
import { encryptText, decryptText, isUnlocked } from './crypto.js';
import { getHuidigSchooljaar } from './state.js';

// Maakt van {voornaam, achternaam} het pseudoniem "Voornaam A." — de initiaal
// is die van de achternaam-kern (laatste woord), dus tussenvoegsels tellen niet.
function pseudoniem(v, a) {
  const kern = (a || '').trim().split(/\s+/).pop();
  return kern ? `${v} ${kern[0].toUpperCase()}.` : v;
}

export async function renderGroep(root, id) {
  const schooljaar = getHuidigSchooljaar();
  const dagprijs = Number(schooljaar?.tso_dagprijs) || 0;

  const groepen = schooljaar ? await getGroepen(schooljaar.id) : [];
  const groep = groepen.find((g) => g.id === id);

  if (!groep) {
    root.innerHTML =
      '<div class="empty-state">Deze groep bestaat niet in dit schooljaar. Kies een groep in de zijbalk.</div>';
    return;
  }

  if (!isUnlocked()) {
    root.innerHTML = `
      <header class="page-head"><h1>Groep ${groep.naam}</h1></header>
      <div class="empty-state">De encryptie is niet ontgrendeld. Herlaad de pagina en voer je passphrase in.</div>`;
    return;
  }

  // Bedrag per maand voor deze groep (dagen × dagprijs)
  const tsoDagen = await getTsoDagen([id]);
  const dagenPerMaand = new Map();
  for (const d of tsoDagen) dagenPerMaand.set(d.maand, d.dagen);
  const maandBedrag = (maand) => {
    const dg = dagenPerMaand.get(maand);
    return dg == null ? null : dg * dagprijs;
  };

  // Leerlingen ophalen en ontsleutelen
  const rijenData = await getLeerlingen(id);
  const leerlingen = [];
  for (const r of rijenData) {
    try {
      const { v, a } = JSON.parse(await decryptText(r.enc_naam, r.iv));
      leerlingen.push({ id: r.id, voornaam: v, achternaam: a, leergeld: r.leergeld });
    } catch {
      leerlingen.push({ id: r.id, voornaam: '⚠︎ onleesbaar', achternaam: '', leergeld: r.leergeld });
    }
  }
  leerlingen.sort((x, y) => x.voornaam.localeCompare(y.voornaam, 'nl'));

  // Betaalde bedragen per leerling per maand
  const betalingen = await getBetalingen(leerlingen.map((l) => l.id));
  const betaalMap = new Map();
  for (const b of betalingen) betaalMap.set(`${b.leerling_id}:${b.maand}`, Number(b.bedrag));

  const maandKoppen = MAANDEN.map((m) => `<th class="maand">${m}</th>`).join('');

  // Cel per leerling per maand: betaald (groen) of nog open (verschuldigd, grijs)
  const cellenVoor = (l) =>
    MAANDEN.map((_, i) => {
      const maand = i + 1;
      const betaald = betaalMap.get(`${l.id}:${maand}`);
      const verschuldigd = maandBedrag(maand);
      if (betaald != null) {
        return `<td class="cel bedrag-cel betaald">${euro.format(betaald)}</td>`;
      }
      if (verschuldigd != null) {
        return `<td class="cel bedrag-cel open">${euro.format(verschuldigd)}</td>`;
      }
      return `<td class="cel bedrag-cel"><span class="leeg">—</span></td>`;
    }).join('');

  const leerlingRijen = leerlingen
    .map(
      (l) => `
      <tr class="${l.leergeld ? 'leergeld-rij' : ''}">
        <th class="groep-cel" scope="row">
          <div class="leerling-cel">
            <span>${pseudoniem(l.voornaam, l.achternaam)}${
        l.leergeld ? ' <span class="leergeld-badge">Leergeld</span>' : ''
      }</span>
            <button class="mini-x" data-del="${l.id}" title="Leerling verwijderen">✕</button>
          </div>
        </th>
        ${cellenVoor(l)}
      </tr>`
    )
    .join('');

  root.innerHTML = `
    <header class="page-head">
      <h1>Groep ${groep.naam}</h1>
      <p class="muted">${leerlingen.length} leerling(en) · schooljaar ${schooljaar.naam} ·
        <span class="legenda"><span class="stip betaald"></span> betaald</span>
        <span class="legenda"><span class="stip open"></span> nog open</span></p>
    </header>

    <div class="tabel-wrap">
      <table class="overzicht-tabel">
        <thead>
          <tr>
            <th class="hoek">
              <div class="hoek-inhoud">
                <span>Leerling</span>
                <button class="kebab" id="kebab" title="Leerling toevoegen" aria-label="Menu">⋮</button>
              </div>
            </th>
            ${maandKoppen}
          </tr>
        </thead>
        <tbody>
          ${
            leerlingRijen ||
            `<tr><td class="cel" colspan="${MAANDEN.length + 1}" style="text-align:left;padding:14px">Nog geen leerlingen. Voeg toe via de ⋮ hierboven of via <a href="#/import">EDEX</a>.</td></tr>`
          }
        </tbody>
      </table>
    </div>

    <div class="popover" id="add-popover" hidden>
      <form id="leerling-form" class="popover-form">
        <strong>Leerling toevoegen</strong>
        <label>Voornaam
          <input type="text" id="voornaam" required maxlength="60" placeholder="bijv. Sanne" />
        </label>
        <label>Achternaam
          <input type="text" id="achternaam" maxlength="60" placeholder="bijv. de Vries" />
        </label>
        <button type="submit" class="btn btn-primary">Toevoegen</button>
      </form>
    </div>
  `;

  // Dropdown (⋮) voor toevoegen
  const kebab = root.querySelector('#kebab');
  const pop = root.querySelector('#add-popover');
  kebab.addEventListener('click', () => {
    const r = kebab.getBoundingClientRect();
    pop.style.top = `${r.bottom + 6}px`;
    pop.style.left = `${Math.max(12, r.right - 240)}px`;
    pop.hidden = false;
    root.querySelector('#voornaam').focus();
  });
  pop.addEventListener('focusout', (e) => {
    if (!pop.contains(e.relatedTarget)) pop.hidden = true;
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      pop.hidden = true;
      kebab.focus();
    }
  });

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
  root.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const naam = btn.closest('tr').querySelector('.leerling-cel span').textContent.trim();
      if (window.confirm(`Leerling "${naam}" verwijderen?`)) {
        await deleteLeerling(btn.dataset.del);
        await renderGroep(root, id);
      }
    });
  });
}
