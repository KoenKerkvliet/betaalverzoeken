// Rapporten — volledig in de browser gegenereerd (PDF via jsPDF), niets wordt
// opgeslagen. Namen worden lokaal ontsleuteld.

import { getGroepen, getLeerlingen } from './data.js';
import { decryptText, isUnlocked } from './crypto.js';
import { getHuidigSchooljaar } from './state.js';
import { MAANDEN } from './config.js';
import { escapeAttr } from './util.js';

// Kalendermaand → schoolmaand (1..10).
function huidigeSchoolMaand() {
  const cal = new Date().getMonth() + 1;
  const map = { 8: 1, 9: 1, 10: 2, 11: 3, 12: 4, 1: 5, 2: 6, 3: 7, 4: 8, 5: 9, 6: 10, 7: 10 };
  return map[cal] || 1;
}

function volledigeNaam(v, a) {
  return `${v}${a ? ' ' + a : ''}`.trim();
}

// Bepaalt of/waarom een leerling in maand M niet meedoet aan de TSO.
function uitsluitReden(l, M) {
  const redenen = [];
  if (l.leergeld) redenen.push('Leergeld');
  if (l.instroom_maand && M < l.instroom_maand) redenen.push('Nog niet ingestroomd');
  const reg = l.regelingen || {};
  if (Object.prototype.hasOwnProperty.call(reg, String(M))) {
    const note = (reg[String(M)] || '').trim();
    redenen.push(note ? `Regeling: ${note}` : 'Regeling');
  }
  if ((l.uitgesloten_maanden || []).includes(M)) redenen.push('Uitgesloten');
  return redenen;
}

export async function openDeelnemersRapport() {
  const sj = getHuidigSchooljaar();
  if (!sj) return;
  if (!isUnlocked()) {
    alert('De encryptie is niet ontgrendeld. Herlaad de pagina en voer je passphrase in.');
    return;
  }

  const groepen = await getGroepen(sj.id);
  const huidig = huidigeSchoolMaand();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card rapport-modal">
      <div class="modal-kop">
        <h2>Deelnemers TSO</h2>
        <button type="button" class="modal-x" aria-label="Sluiten">✕</button>
      </div>
      <p class="muted" style="margin-top:0">Genereer een PDF met de leerlingen die volgens het systeem <strong>niet</strong> meedoen aan de TSO (leergeld, nog niet ingestroomd, regeling of uitgesloten) — je uitsluitlijst voor het betaalverzoek.</p>

      <div class="rapport-body">
        <div class="rapport-kol">
          <h3>Groepen</h3>
          <div class="rapport-presets">
            <button type="button" class="preset-knop" data-preset="1">Groep 1</button>
            <button type="button" class="preset-knop" data-preset="28">Groep 2-8</button>
          </div>
          <div class="rapport-groepen">
            ${groepen
              .map(
                (g) =>
                  `<label class="rapport-optie"><input type="checkbox" class="rgroep" value="${g.id}" data-volgorde="${g.volgorde}" data-naam="${escapeAttr(
                    g.naam
                  )}" /> ${g.naam}</label>`
              )
              .join('')}
          </div>
        </div>
        <div class="rapport-kol">
          <h3>Maand</h3>
          <label class="rapport-optie"><input type="radio" name="rmaand" value="${huidig}" checked /> <strong>Huidige maand</strong> (${MAANDEN[huidig - 1]})</label>
          <hr class="menu-scheiding" />
          ${MAANDEN.map(
            (m, i) => `<label class="rapport-optie"><input type="radio" name="rmaand" value="${i + 1}" /> ${m}</label>`
          ).join('')}
        </div>
      </div>

      <div class="rapport-acties">
        <button type="button" class="btn btn-primary" id="rapport-genereer">Genereer rapport</button>
        <span id="rapport-status" class="msg"></span>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const sluit = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) sluit();
  });
  overlay.querySelector('.modal-x').addEventListener('click', sluit);
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') sluit();
  });

  const checks = [...overlay.querySelectorAll('.rgroep')];
  overlay.querySelectorAll('.preset-knop').forEach((knop) => {
    knop.addEventListener('click', () => {
      const preset = knop.dataset.preset;
      checks.forEach((c) => {
        const v = Number(c.dataset.volgorde);
        c.checked = preset === '1' ? v <= 2 : v >= 3;
      });
    });
  });

  overlay.querySelector('#rapport-genereer').addEventListener('click', async () => {
    const status = overlay.querySelector('#rapport-status');
    const gekozenGroepen = checks.filter((c) => c.checked);
    if (!gekozenGroepen.length) {
      status.className = 'msg error';
      status.textContent = 'Kies minstens één groep.';
      return;
    }
    const maand = Number(overlay.querySelector('input[name="rmaand"]:checked').value);

    status.className = 'msg';
    status.textContent = 'Bezig met genereren…';

    try {
      await genereerPdf(sj, gekozenGroepen, maand, groepen);
      status.className = 'msg success';
      status.textContent = 'PDF gedownload.';
    } catch (e) {
      console.error(e);
      status.className = 'msg error';
      status.textContent = 'Genereren mislukt.';
    }
  });
}

async function genereerPdf(sj, gekozenGroepen, maand, alleGroepen) {
  const groepIds = gekozenGroepen.map((c) => c.value);
  const groepNaam = new Map(alleGroepen.map((g) => [g.id, g.naam]));
  const groepVolgorde = new Map(alleGroepen.map((g) => [g.id, g.volgorde]));

  // Leerlingen ophalen + ontsleutelen, uitsluitingen bepalen.
  const rows = await getLeerlingen(groepIds);
  const uitgesloten = [];
  for (const r of rows) {
    const redenen = uitsluitReden(r, maand);
    if (!redenen.length) continue;
    let naam = '⚠︎ onleesbaar';
    try {
      const { v, a } = JSON.parse(await decryptText(r.enc_naam, r.iv));
      naam = volledigeNaam(v, a);
    } catch {
      /* onleesbaar */
    }
    uitgesloten.push({
      naam,
      groep: groepNaam.get(r.groep_id) || '',
      volgorde: groepVolgorde.get(r.groep_id) ?? 99,
      reden: redenen.join('; '),
    });
  }
  uitgesloten.sort((a, b) => a.volgorde - b.volgorde || a.naam.localeCompare(b.naam, 'nl'));

  // Groepslabel voor de kop
  const gekozenIds = new Set(groepIds);
  const groep1 = alleGroepen.filter((g) => g.volgorde <= 2).map((g) => g.id);
  const groep28 = alleGroepen.filter((g) => g.volgorde >= 3).map((g) => g.id);
  const isSet = (ids) => ids.length === gekozenIds.size && ids.every((id) => gekozenIds.has(id));
  let groepLabel;
  if (isSet(groep1)) groepLabel = 'Groep 1';
  else if (isSet(groep28)) groepLabel = 'Groep 2-8';
  else
    groepLabel = gekozenGroepen
      .map((c) => c.dataset.naam)
      .sort((a, b) => a.localeCompare(b, 'nl', { numeric: true }))
      .join(', ');

  // PDF opbouwen (jsPDF + autotable, lazy van de CDN).
  const jspdfMod = await import('https://esm.sh/jspdf@2.5.2');
  const autoTable = (await import('https://esm.sh/jspdf-autotable@3.8.4')).default;
  const jsPDF = jspdfMod.jsPDF || jspdfMod.default;

  const doc = new jsPDF();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(31, 41, 55);
  doc.text('TSO — niet-deelnemers', 14, 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(110, 110, 120);
  doc.text(`${MAANDEN[maand - 1]} · schooljaar ${sj.naam}`, 14, 25);
  doc.text(`Groepen: ${groepLabel}`, 14, 30);
  doc.text(
    `${uitgesloten.length} leerling(en) uitgesloten van het betaalverzoek · gegenereerd ${new Date().toLocaleString(
      'nl-NL'
    )}`,
    14,
    35
  );

  autoTable(doc, {
    startY: 41,
    head: [['Naam', 'Groep', 'Reden']],
    body: uitgesloten.length
      ? uitgesloten.map((u) => [u.naam, u.groep, u.reden])
      : [['—', '—', 'Geen uitgesloten leerlingen voor deze selectie']],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [109, 40, 217], textColor: 255 },
    alternateRowStyles: { fillColor: [247, 247, 251] },
    columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 22 }, 2: { cellWidth: 'auto' } },
  });

  const slug = `${MAANDEN[maand - 1]}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  doc.save(`niet-deelnemers-tso-${slug}.pdf`);
}
