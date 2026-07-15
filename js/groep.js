import { euro } from './supabaseClient.js';
import { MAANDEN } from './config.js';
import {
  getGroepen,
  getLeerlingen,
  insertLeerlingen,
  deleteLeerling,
  getBetalingen,
  updateBetaling,
  deleteBetaling,
  updateLeerling,
} from './data.js';
import { encryptText, decryptText, isUnlocked } from './crypto.js';
import { getHuidigSchooljaar } from './state.js';
import { parseBedrag } from './util.js';

// Maakt van {voornaam, achternaam} het pseudoniem "Voornaam A." — de initiaal
// is die van de achternaam-kern (laatste woord), dus tussenvoegsels tellen niet.
function pseudoniem(v, a) {
  const kern = (a || '').trim().split(/\s+/).pop();
  return kern ? `${v} ${kern[0].toUpperCase()}.` : v;
}

function escapeAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Status van een cel voor een leerling/maand: arceerklasse + tooltip.
// Volgorde: vóór instroom (grijs) > regeling (rood) > uitgesloten (blauw).
function celStatus(l, maand) {
  if (l.instroom_maand && maand < l.instroom_maand) return { klasse: 'voor-instroom', title: '' };
  const reg = l.regelingen || {};
  if (Object.prototype.hasOwnProperty.call(reg, String(maand))) {
    return { klasse: 'regeling', title: reg[String(maand)] || '' };
  }
  if ((l.uitgesloten_maanden || []).includes(maand)) return { klasse: 'uitgesloten', title: '' };
  return { klasse: '', title: '' };
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
      regelingen: r.regelingen || {},
    };
    try {
      const { v, a } = JSON.parse(await decryptText(r.enc_naam, r.iv));
      leerlingen.push({ id: r.id, voornaam: v, achternaam: a, ...extra });
    } catch {
      leerlingen.push({ id: r.id, voornaam: '⚠︎ onleesbaar', achternaam: '', ...extra });
    }
  }
  leerlingen.sort((x, y) => x.voornaam.localeCompare(y.voornaam, 'nl'));

  // Betaalde bedragen per leerling per maand (record incl. id) + totaal per maand
  const betalingen = await getBetalingen(leerlingen.map((l) => l.id));
  const betaalRecord = new Map(); // "leerlingId:maand" -> betaling-record
  const maandTotaal = {};
  for (const b of betalingen) {
    betaalRecord.set(`${b.leerling_id}:${b.maand}`, b);
    maandTotaal[b.maand] = (maandTotaal[b.maand] || 0) + Number(b.bedrag);
  }

  const maandKoppen = MAANDEN.map((m) => `<th class="maand">${m}</th>`).join('');

  // Totaalrij: hoeveel geld is die maand binnengekomen (som van betalingen)
  const totaalCellen = MAANDEN.map((_, i) => {
    const t = maandTotaal[i + 1];
    return `<td class="cel bedrag-cel maand-totaal">${t ? euro.format(t) : '<span class="leeg">—</span>'}</td>`;
  }).join('');

  // Cel per leerling per maand: alleen betaalde (geïmporteerde) bedragen tonen,
  // met arcering (instroom/regeling/uitgesloten) en tooltip bij een regeling.
  const cellenVoor = (l) =>
    MAANDEN.map((_, i) => {
      const maand = i + 1;
      const rec = betaalRecord.get(`${l.id}:${maand}`);
      const betaald = rec ? Number(rec.bedrag) : null;
      // €0,00 = wél een betaalregel maar niet betaald → rood signaal.
      const betaaldCls = betaald == null ? '' : betaald === 0 ? ' niet-betaald' : ' betaald';
      const inhoud = betaald != null ? euro.format(betaald) : '<span class="leeg">—</span>';
      const st = celStatus(l, maand);
      const cls = st.klasse ? ' ' + st.klasse : '';
      const klikbaar = rec ? ' klikbaar' : '';
      const extra = rec ? ` data-betaling-id="${rec.id}"` : '';
      const titel = st.title ? ` title="${escapeAttr(st.title)}"` : '';
      return `<td class="cel bedrag-cel${betaaldCls}${cls}${klikbaar}" data-leerling="${l.id}" data-maand="${maand}"${extra}${titel}>${inhoud}</td>`;
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
        <span class="legenda"><span class="swatch uitgesloten"></span> uitgesloten</span>
        <span class="legenda"><span class="swatch regeling"></span> regeling</span></p>
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

  // Werkt de arcering + tooltip van één leerling-rij live bij (zonder her-render).
  function pasArceringToe(l) {
    for (let m = 1; m <= MAANDEN.length; m++) {
      const td = root.querySelector(`td[data-leerling="${l.id}"][data-maand="${m}"]`);
      if (!td) continue;
      td.classList.remove('voor-instroom', 'uitgesloten', 'regeling');
      td.removeAttribute('title');
      const st = celStatus(l, m);
      if (st.klasse) td.classList.add(st.klasse);
      if (st.title) td.title = st.title;
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
    const uitsluitOpties =
      `<label class="menu-optie"><input type="checkbox" class="alle-maanden"> <strong>Alle maanden</strong></label>` +
      `<hr class="menu-scheiding" />` +
      MAANDEN.map(
        (m, i) =>
          `<label class="menu-optie"><input type="checkbox" class="maand-cb" value="${i + 1}"${
            (l.uitgesloten_maanden || []).includes(i + 1) ? ' checked' : ''
          }> ${m}</label>`
      ).join('');

    const reg = l.regelingen || {};
    const regelingOpties = MAANDEN.map((m, i) => {
      const maand = i + 1;
      const heeft = Object.prototype.hasOwnProperty.call(reg, String(maand));
      return `<div class="reg-rij">
        <label class="menu-optie"><input type="checkbox" class="reg-cb" value="${maand}"${
        heeft ? ' checked' : ''
      }> ${m}</label>
        <input type="text" class="reg-opm" data-maand="${maand}" placeholder="opmerking"
               value="${escapeAttr(heeft ? reg[String(maand)] : '')}"${heeft ? '' : ' disabled'} />
      </div>`;
    }).join('');

    return `
      <div class="menu-sectie">
        <button type="button" class="menu-kop" data-sectie="naam">Naam wijzigen <span>▾</span></button>
        <div class="menu-inhoud" data-inhoud="naam" hidden>
          <label class="menu-veld">Voornaam
            <input type="text" class="naam-voornaam" maxlength="60" value="${escapeAttr(l.voornaam)}" />
          </label>
          <label class="menu-veld">Achternaam
            <input type="text" class="naam-achternaam" maxlength="60" value="${escapeAttr(l.achternaam)}" />
          </label>
          <button type="button" class="btn btn-primary naam-opslaan">Opslaan</button>
        </div>
      </div>
      <div class="menu-sectie">
        <button type="button" class="menu-kop" data-sectie="instroom">Instroom vanaf <span>▾</span></button>
        <div class="menu-inhoud" data-inhoud="instroom" hidden>${instroomOpties}</div>
      </div>
      <div class="menu-sectie">
        <button type="button" class="menu-kop" data-sectie="uitsluiten">Maanden uitsluiten <span>▾</span></button>
        <div class="menu-inhoud" data-inhoud="uitsluiten" hidden>${uitsluitOpties}</div>
      </div>
      <div class="menu-sectie">
        <button type="button" class="menu-kop" data-sectie="regeling">Regeling <span>▾</span></button>
        <div class="menu-inhoud" data-inhoud="regeling" hidden>${regelingOpties}</div>
      </div>`;
  }

  function openMenu(l, knop) {
    sluitMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'leerling-menu';
    menuEl.tabIndex = -1;
    menuEl.innerHTML = menuHtml(l);
    document.body.appendChild(menuEl);

    // Houdt het menu binnen het scherm (opent naar boven als het niet past).
    function positioneer() {
      const r = knop.getBoundingClientRect();
      const marge = 8;
      const h = menuEl.offsetHeight;
      let top = r.bottom + 4;
      if (top + h > window.innerHeight - marge) {
        top = Math.max(marge, window.innerHeight - marge - h);
      }
      menuEl.style.top = `${top}px`;
      menuEl.style.left = `${Math.min(r.left, window.innerWidth - 256)}px`;
    }
    positioneer();

    // Accordion
    menuEl.querySelectorAll('.menu-kop').forEach((kop) => {
      kop.addEventListener('click', () => {
        const inh = menuEl.querySelector(`[data-inhoud="${kop.dataset.sectie}"]`);
        inh.hidden = !inh.hidden;
        positioneer();
      });
    });

    // Naam wijzigen (versleuteld opslaan)
    menuEl.querySelector('.naam-opslaan').addEventListener('click', async () => {
      const voornaam = menuEl.querySelector('.naam-voornaam').value.trim();
      const achternaam = menuEl.querySelector('.naam-achternaam').value.trim();
      if (!voornaam) return;
      try {
        const enc = await encryptText(JSON.stringify({ v: voornaam, a: achternaam }));
        await updateLeerling(l.id, { enc_naam: enc.ct, iv: enc.iv });
        sluitMenu();
        await renderGroep(root, id);
      } catch (e) {
        console.error(e);
      }
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

    // Maanden uitsluiten (checkboxes + "Alle maanden")
    const alleCb = menuEl.querySelector('.alle-maanden');
    const maandCbs = [...menuEl.querySelectorAll('.maand-cb')];
    function syncUitsluiten() {
      l.uitgesloten_maanden = maandCbs
        .filter((c) => c.checked)
        .map((c) => Number(c.value))
        .sort((a, b) => a - b);
      alleCb.checked = maandCbs.every((c) => c.checked);
      pasArceringToe(l);
      updateLeerling(l.id, { uitgesloten_maanden: l.uitgesloten_maanden }).catch((e) =>
        console.error(e)
      );
    }
    alleCb.checked = maandCbs.every((c) => c.checked);
    alleCb.addEventListener('change', () => {
      maandCbs.forEach((c) => (c.checked = alleCb.checked));
      syncUitsluiten();
    });
    maandCbs.forEach((cb) => cb.addEventListener('change', syncUitsluiten));

    // Regeling (checkbox per maand + opmerking)
    const regCbs = [...menuEl.querySelectorAll('.reg-cb')];
    function syncRegeling() {
      const reg = {};
      regCbs.forEach((cb) => {
        const opm = menuEl.querySelector(`.reg-opm[data-maand="${cb.value}"]`);
        if (cb.checked) reg[cb.value] = (opm?.value || '').trim();
      });
      l.regelingen = reg;
      pasArceringToe(l);
      updateLeerling(l.id, { regelingen: reg }).catch((e) => console.error(e));
    }
    regCbs.forEach((cb) => {
      cb.addEventListener('change', () => {
        const opm = menuEl.querySelector(`.reg-opm[data-maand="${cb.value}"]`);
        if (opm) opm.disabled = !cb.checked;
        syncRegeling();
      });
    });
    menuEl.querySelectorAll('.reg-opm').forEach((opm) => {
      opm.addEventListener('change', syncRegeling);
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

  // --- Klik op een bedrag → bewerken / verwijderen -----------------------
  let bedragPop = null;
  function sluitBedragPop() {
    if (bedragPop) {
      bedragPop.remove();
      bedragPop = null;
    }
  }
  async function herrenderMetScroll() {
    const y = root.scrollTop;
    await renderGroep(root, id);
    root.scrollTop = y;
  }

  function openBedragPop(td) {
    sluitBedragPop();
    const rec = betaalRecord.get(`${td.dataset.leerling}:${td.dataset.maand}`);
    if (!rec) return;

    bedragPop = document.createElement('div');
    bedragPop.className = 'bedrag-popover';
    bedragPop.tabIndex = -1;
    bedragPop.innerHTML = `
      <label class="bp-veld">Bedrag (€)
        <input type="text" class="bp-bedrag" inputmode="decimal" value="${String(rec.bedrag).replace('.', ',')}" />
      </label>
      <div class="bp-acties">
        <button type="button" class="btn btn-primary bp-opslaan">Opslaan</button>
        <button type="button" class="btn btn-ghost btn-danger bp-verwijder">Verwijderen</button>
      </div>`;
    document.body.appendChild(bedragPop);

    const r = td.getBoundingClientRect();
    bedragPop.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 130)}px`;
    bedragPop.style.left = `${Math.min(r.left, window.innerWidth - 212)}px`;

    const inp = bedragPop.querySelector('.bp-bedrag');
    inp.focus();
    inp.select();

    bedragPop.addEventListener('focusout', (e) => {
      if (!bedragPop.contains(e.relatedTarget)) sluitBedragPop();
    });
    bedragPop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') sluitBedragPop();
    });

    bedragPop.querySelector('.bp-opslaan').addEventListener('click', async () => {
      const bedrag = parseBedrag(inp.value);
      try {
        await updateBetaling(rec.id, bedrag);
      } catch (e) {
        console.error(e);
      }
      sluitBedragPop();
      await herrenderMetScroll();
    });
    bedragPop.querySelector('.bp-verwijder').addEventListener('click', async () => {
      try {
        await deleteBetaling(rec.id);
      } catch (e) {
        console.error(e);
      }
      sluitBedragPop();
      await herrenderMetScroll();
    });
  }

  root.querySelector('.overzicht-tabel tbody').addEventListener('click', (e) => {
    const td = e.target.closest('td.bedrag-cel.klikbaar');
    if (td) openBedragPop(td);
  });
}
