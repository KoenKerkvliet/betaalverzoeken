import { euro } from './supabaseClient.js';
import { MAANDEN } from './config.js';
import {
  getGroepen,
  getLeerlingen,
  insertLeerlingen,
  deleteLeerling,
  getBetalingen,
  updateLeerling,
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

  // Leerlingen ophalen en ontsleutelen
  const rijenData = await getLeerlingen(id);
  const leerlingen = [];
  for (const r of rijenData) {
    const extra = {
      leergeld: r.leergeld,
      instroom_maand: r.instroom_maand,
      uitgesloten_maanden: r.uitgesloten_maanden || [],
    };
    try {
      const { v, a } = JSON.parse(await decryptText(r.enc_naam, r.iv));
      leerlingen.push({ id: r.id, voornaam: v, achternaam: a, ...extra });
    } catch {
      leerlingen.push({ id: r.id, voornaam: '⚠︎ onleesbaar', achternaam: '', ...extra });
    }
  }
  leerlingen.sort((x, y) => x.voornaam.localeCompare(y.voornaam, 'nl'));

  // Betaalde bedragen per leerling per maand + totaal per maand
  const betalingen = await getBetalingen(leerlingen.map((l) => l.id));
  const betaalMap = new Map();
  const maandTotaal = {};
  for (const b of betalingen) {
    betaalMap.set(`${b.leerling_id}:${b.maand}`, Number(b.bedrag));
    maandTotaal[b.maand] = (maandTotaal[b.maand] || 0) + Number(b.bedrag);
  }

  const maandKoppen = MAANDEN.map((m) => `<th class="maand">${m}</th>`).join('');

  // Totaalrij: hoeveel geld is die maand binnengekomen (som van betalingen)
  const totaalCellen = MAANDEN.map((_, i) => {
    const t = maandTotaal[i + 1];
    return `<td class="cel bedrag-cel maand-totaal">${t ? euro.format(t) : '<span class="leeg">—</span>'}</td>`;
  }).join('');

  // Arceerklasse per leerling per maand: lichtgrijs vóór instroom, lichtblauw
  // voor uitgesloten maanden.
  const arceerKlasse = (l, maand) => {
    if (l.instroom_maand && maand < l.instroom_maand) return ' voor-instroom';
    if ((l.uitgesloten_maanden || []).includes(maand)) return ' uitgesloten';
    return '';
  };

  // Cel per leerling per maand: alleen betaalde (geïmporteerde) bedragen tonen
  const cellenVoor = (l) =>
    MAANDEN.map((_, i) => {
      const maand = i + 1;
      const betaald = betaalMap.get(`${l.id}:${maand}`);
      const betaaldCls = betaald != null ? ' betaald' : '';
      const inhoud = betaald != null ? euro.format(betaald) : '<span class="leeg">—</span>';
      return `<td class="cel bedrag-cel${betaaldCls}${arceerKlasse(l, maand)}"
                  data-leerling="${l.id}" data-maand="${maand}">${inhoud}</td>`;
    }).join('');

  const leerlingRijen = leerlingen
    .map(
      (l) => `
      <tr class="${l.leergeld ? 'leergeld-rij' : ''}">
        <th class="groep-cel" scope="row">
          <div class="leerling-cel">
            <button type="button" class="leerling-knop" data-leerling="${l.id}">
              <span class="ll-naam">${pseudoniem(l.voornaam, l.achternaam)}</span>${
        l.leergeld ? ' <span class="leergeld-badge">Leergeld</span>' : ''
      }
            </button>
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
        <span class="legenda"><span class="swatch voor-instroom"></span> vóór instroom</span>
        <span class="legenda"><span class="swatch uitgesloten"></span> uitgesloten</span></p>
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
            leerlingen.length
              ? `<tr class="maand-totaal-rij">
                   <th class="groep-cel totaal-label" scope="row">Binnengekomen</th>
                   ${totaalCellen}
                 </tr>${leerlingRijen}`
              : `<tr><td class="cel" colspan="${MAANDEN.length + 1}" style="text-align:left;padding:14px">Nog geen leerlingen. Voeg toe via de ⋮ hierboven of via <a href="#/import">EDEX</a>.</td></tr>`
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
      const naam = btn.closest('tr').querySelector('.ll-naam').textContent.trim();
      if (window.confirm(`Leerling "${naam}" verwijderen?`)) {
        await deleteLeerling(btn.dataset.del);
        await renderGroep(root, id);
      }
    });
  });

  // --- Uitvouwmenu per leerling (instroom / maanden uitsluiten) -----------
  let menuEl = null;
  function sluitMenu() {
    if (menuEl) {
      menuEl.remove();
      menuEl = null;
    }
  }

  // Werkt de arcering van één leerling-rij live bij (zonder her-render).
  function pasArceringToe(l) {
    for (let m = 1; m <= MAANDEN.length; m++) {
      const td = root.querySelector(`td[data-leerling="${l.id}"][data-maand="${m}"]`);
      if (!td) continue;
      td.classList.remove('voor-instroom', 'uitgesloten');
      if (l.instroom_maand && m < l.instroom_maand) td.classList.add('voor-instroom');
      else if ((l.uitgesloten_maanden || []).includes(m)) td.classList.add('uitgesloten');
    }
  }

  function menuHtml(l) {
    const instroomOpties = [
      `<label class="menu-optie"><input type="radio" name="instroom-${l.id}" value=""${
        !l.instroom_maand ? ' checked' : ''
      }> Vanaf begin</label>`,
      ...MAANDEN.map(
        (m, i) =>
          `<label class="menu-optie"><input type="radio" name="instroom-${l.id}" value="${i + 1}"${
            l.instroom_maand === i + 1 ? ' checked' : ''
          }> ${m}</label>`
      ),
    ].join('');
    const uitsluitOpties = MAANDEN.map(
      (m, i) =>
        `<label class="menu-optie"><input type="checkbox" value="${i + 1}"${
          (l.uitgesloten_maanden || []).includes(i + 1) ? ' checked' : ''
        }> ${m}</label>`
    ).join('');

    return `
      <div class="menu-sectie">
        <button type="button" class="menu-kop" data-sectie="instroom">Instroom vanaf <span>▾</span></button>
        <div class="menu-inhoud" data-inhoud="instroom" hidden>${instroomOpties}</div>
      </div>
      <div class="menu-sectie">
        <button type="button" class="menu-kop" data-sectie="uitsluiten">Maanden uitsluiten <span>▾</span></button>
        <div class="menu-inhoud" data-inhoud="uitsluiten" hidden>${uitsluitOpties}</div>
      </div>`;
  }

  function openMenu(l, knop) {
    sluitMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'leerling-menu';
    menuEl.tabIndex = -1;
    menuEl.innerHTML = menuHtml(l);
    document.body.appendChild(menuEl);

    const r = knop.getBoundingClientRect();
    menuEl.style.top = `${r.bottom + 4}px`;
    menuEl.style.left = `${Math.min(r.left, window.innerWidth - 256)}px`;

    // Accordion
    menuEl.querySelectorAll('.menu-kop').forEach((kop) => {
      kop.addEventListener('click', () => {
        const inh = menuEl.querySelector(`[data-inhoud="${kop.dataset.sectie}"]`);
        inh.hidden = !inh.hidden;
      });
    });

    // Instroom (radio)
    menuEl.querySelectorAll(`input[name="instroom-${l.id}"]`).forEach((radio) => {
      radio.addEventListener('change', async () => {
        l.instroom_maand = radio.value === '' ? null : Number(radio.value);
        pasArceringToe(l);
        try {
          await updateLeerling(l.id, { instroom_maand: l.instroom_maand });
        } catch (e) {
          console.error(e);
        }
      });
    });

    // Maanden uitsluiten (checkbox)
    menuEl.querySelectorAll('[data-inhoud="uitsluiten"] input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        l.uitgesloten_maanden = [
          ...menuEl.querySelectorAll('[data-inhoud="uitsluiten"] input:checked'),
        ]
          .map((x) => Number(x.value))
          .sort((a, b) => a - b);
        pasArceringToe(l);
        try {
          await updateLeerling(l.id, { uitgesloten_maanden: l.uitgesloten_maanden });
        } catch (e) {
          console.error(e);
        }
      });
    });

    menuEl.addEventListener('focusout', (e) => {
      if (!menuEl.contains(e.relatedTarget)) sluitMenu();
    });
    menuEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        sluitMenu();
        knop.focus();
      }
    });

    menuEl.focus();
  }

  root.querySelectorAll('.leerling-knop').forEach((knop) => {
    knop.addEventListener('click', () => {
      const l = leerlingen.find((x) => x.id === knop.dataset.leerling);
      if (l) openMenu(l, knop);
    });
  });
}
