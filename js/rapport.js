// Rapporten — volledig in de browser gegenereerd (PDF via jsPDF), niets wordt
// opgeslagen. Namen worden lokaal ontsleuteld.

import {
  getGroepen,
  getLeerlingen,
  getOpenstaand,
  getBetalingenPerMaand,
  getOvergemaakt,
  getTotaaloverzicht,
} from './data.js';
import { decryptText, isUnlocked } from './crypto.js';
import { getHuidigSchooljaar } from './state.js';
import { MAANDEN } from './config.js';
import { euro } from './supabaseClient.js';
import { escapeAttr } from './util.js';

// --- Gedeelde PDF-helpers -------------------------------------------------

async function laadPdf() {
  const jspdfMod = await import('https://esm.sh/jspdf@2.5.2');
  const autoTable = (await import('https://esm.sh/jspdf-autotable@3.8.4')).default;
  return { jsPDF: jspdfMod.jsPDF || jspdfMod.default, autoTable };
}

function pdfKop(doc, titel, sj, regels) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(31, 41, 55);
  doc.text(titel, 14, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(110, 110, 120);
  doc.text(`Schooljaar ${sj.naam} · gegenereerd ${new Date().toLocaleString('nl-NL')}`, 14, 25);
  let y = 30;
  (regels || []).forEach((r) => {
    doc.text(r, 14, y);
    y += 5;
  });
  return y + 4;
}

const KOP_STIJL = { fillColor: [109, 40, 217], textColor: 255 };
const VOET_STIJL = { fillColor: [237, 233, 254], textColor: [31, 41, 55], fontStyle: 'bold' };
const WISSEL_STIJL = { fillColor: [247, 247, 251] };

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

  // Leerlingen ophalen + ontsleutelen. Uitsluitingen deze maand + vergelijking
  // met vorige maand (voor de sectie "Actie nodig").
  const rows = await getLeerlingen(groepIds);
  const uitgesloten = [];
  const actieNodig = [];
  for (const r of rows) {
    const redenenNu = uitsluitReden(r, maand);
    const redenenVorig = maand > 1 ? uitsluitReden(r, maand - 1) : [];
    const inUitgesloten = redenenNu.length > 0;
    const inActie = maand > 1 && redenenVorig.length > 0 && redenenNu.length === 0;
    if (!inUitgesloten && !inActie) continue;

    let naam = '⚠︎ onleesbaar';
    try {
      const { v, a } = JSON.parse(await decryptText(r.enc_naam, r.iv));
      naam = volledigeNaam(v, a);
    } catch {
      /* onleesbaar */
    }
    const groep = groepNaam.get(r.groep_id) || '';
    const volgorde = groepVolgorde.get(r.groep_id) ?? 99;

    if (inUitgesloten) uitgesloten.push({ naam, groep, volgorde, reden: redenenNu.join('; ') });
    if (inActie) actieNodig.push({ naam, groep, volgorde, reden: redenenVorig.join('; ') });
  }
  const opVolgorde = (a, b) => a.volgorde - b.volgorde || a.naam.localeCompare(b.naam, 'nl');
  uitgesloten.sort(opVolgorde);
  actieNodig.sort(opVolgorde);

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
  doc.text('Deelnemers TSO', 14, 18);

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

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(31, 41, 55);
  doc.text('Niet-deelnemers (uitsluiten van betaalverzoek)', 14, 43);

  autoTable(doc, {
    startY: 46,
    head: [['Naam', 'Groep', 'Reden']],
    body: uitgesloten.length
      ? uitgesloten.map((u) => [u.naam, u.groep, u.reden])
      : [['—', '—', 'Geen uitgesloten leerlingen voor deze selectie']],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [109, 40, 217], textColor: 255 },
    alternateRowStyles: { fillColor: [247, 247, 251] },
    columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 22 }, 2: { cellWidth: 'auto' } },
  });

  // Sectie "Actie nodig": wie deed vorige maand niet mee, maar nu wél.
  if (maand > 1) {
    let y = doc.lastAutoTable.finalY + 12;
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(31, 41, 55);
    doc.text('Actie nodig — toevoegen aan betaalverzoek', 14, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(110, 110, 120);
    doc.text(
      `Deze leerling(en) waren vorige maand (${MAANDEN[maand - 2]}) nog uitgesloten en doen deze maand wél mee. Voeg ze toe aan de juiste betaalverzoek-groep.`,
      14,
      y + 5,
      { maxWidth: 182 }
    );

    autoTable(doc, {
      startY: y + 12,
      head: [['Naam', 'Groep', `Vorige maand uitgesloten wegens`]],
      body: actieNodig.length
        ? actieNodig.map((u) => [u.naam, u.groep, u.reden])
        : [['—', '—', 'Geen wijzigingen ten opzichte van vorige maand']],
      styles: { fontSize: 9, cellPadding: 2.5 },
      headStyles: { fillColor: [217, 119, 6], textColor: 255 },
      alternateRowStyles: { fillColor: [255, 251, 235] },
      columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 22 }, 2: { cellWidth: 'auto' } },
    });
  }

  const slug = `${MAANDEN[maand - 1]}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  doc.save(`deelnemers-tso-${slug}.pdf`);
}

// Ontsleutelt de namen van alle leerlingen van dit schooljaar → Map(id → naam).
async function naamMapVoorSchooljaar(sj) {
  const groepen = await getGroepen(sj.id);
  const rows = await getLeerlingen(groepen.map((g) => g.id));
  const map = new Map();
  for (const r of rows) {
    let naam = '⚠︎ onleesbaar';
    try {
      const { v, a } = JSON.parse(await decryptText(r.enc_naam, r.iv));
      naam = volledigeNaam(v, a);
    } catch {
      /* onleesbaar */
    }
    map.set(r.id, naam);
  }
  return map;
}

// --- Rapport: Openstaande betalingen --------------------------------------
export async function openstaandeBetalingenRapport() {
  const sj = getHuidigSchooljaar();
  if (!sj) return;
  if (!isUnlocked()) {
    alert('De encryptie is niet ontgrendeld. Herlaad de pagina en voer je passphrase in.');
    return;
  }

  const naamMap = await naamMapVoorSchooljaar(sj);
  const rows = (await getOpenstaand(sj.id))
    .map((r) => ({
      naam: naamMap.get(r.leerling_id) || '?',
      groep: r.groep,
      volgorde: r.volgorde,
      maanden: (r.posten || [])
        .map((p) => `${MAANDEN[p.maand - 1]} (${euro.format(Number(p.bedrag))})`)
        .join(', '),
      totaal: Number(r.totaal),
    }))
    .sort((a, b) => a.volgorde - b.volgorde || a.naam.localeCompare(b.naam, 'nl'));
  const grand = rows.reduce((s, r) => s + r.totaal, 0);

  const { jsPDF, autoTable } = await laadPdf();
  const doc = new jsPDF();
  const y = pdfKop(doc, 'Openstaande betalingen', sj, [
    `${rows.length} leerling(en) · totaal openstaand ${euro.format(grand)}`,
  ]);

  autoTable(doc, {
    startY: y,
    head: [['Naam', 'Groep', 'Niet betaald', 'Openstaand']],
    body: rows.length
      ? rows.map((r) => [r.naam, r.groep, r.maanden, euro.format(r.totaal)])
      : [['—', '—', 'Iedereen heeft betaald 🎉', '—']],
    foot: rows.length ? [['', '', 'Totaal openstaand', euro.format(grand)]] : undefined,
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: KOP_STIJL,
    footStyles: VOET_STIJL,
    alternateRowStyles: WISSEL_STIJL,
    columnStyles: { 0: { cellWidth: 48 }, 1: { cellWidth: 18 }, 3: { cellWidth: 24, halign: 'right' } },
  });

  doc.save(`openstaande-betalingen-${sj.naam}.pdf`);
}

// --- Rapport: Binnengekomen betalingen ------------------------------------
export async function binnengekomenBetalingenRapport() {
  const sj = getHuidigSchooljaar();
  if (!sj) return;

  const binMap = new Map((await getBetalingenPerMaand(sj.id)).map((r) => [r.maand, Number(r.totaal)]));
  const ogMap = {};
  for (const o of await getOvergemaakt(sj.id)) ogMap[o.maand] = (ogMap[o.maand] || 0) + Number(o.bedrag);

  const rijen = MAANDEN.map((m, i) => ({
    maand: m,
    binnen: binMap.get(i + 1) || 0,
    over: ogMap[i + 1] || 0,
  }));
  const totBin = rijen.reduce((s, r) => s + r.binnen, 0);
  const totOver = rijen.reduce((s, r) => s + r.over, 0);

  const { jsPDF, autoTable } = await laadPdf();
  const doc = new jsPDF();
  const y = pdfKop(doc, 'Binnengekomen betalingen', sj, [
    `Daadwerkelijk overgemaakt door ouders · totaal ${euro.format(totBin)}`,
  ]);

  autoTable(doc, {
    startY: y,
    head: [['Maand', 'Binnengekomen', 'Overgemaakt (gemeld)']],
    body: rijen.map((r) => [
      r.maand,
      r.binnen ? euro.format(r.binnen) : '—',
      r.over ? euro.format(r.over) : '—',
    ]),
    foot: [['Totaal', euro.format(totBin), euro.format(totOver)]],
    styles: { fontSize: 10, cellPadding: 3 },
    headStyles: KOP_STIJL,
    footStyles: VOET_STIJL,
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
  });

  doc.save(`binnengekomen-betalingen-${sj.naam}.pdf`);
}

// --- Rapport: Totaaloverzicht ---------------------------------------------
export async function totaaloverzichtRapport() {
  const sj = getHuidigSchooljaar();
  if (!sj) return;

  const t = await getTotaaloverzicht(sj.id);
  if (!t) return;
  const binMap = new Map((await getBetalingenPerMaand(sj.id)).map((r) => [r.maand, Number(r.totaal)]));
  const totOver = (await getOvergemaakt(sj.id)).reduce((s, o) => s + Number(o.bedrag), 0);

  const binnen = Number(t.binnengekomen);
  const openstaand = Number(t.openstaand);
  const uitgevraagd = Number(t.aantal_uitgevraagd);
  const betaald = Number(t.aantal_betaald);
  const pctAantal = uitgevraagd ? (betaald / uitgevraagd) * 100 : 0;
  const verwacht = binnen + openstaand;
  const pctBedrag = verwacht ? (binnen / verwacht) * 100 : 0;

  const { jsPDF, autoTable } = await laadPdf();
  const doc = new jsPDF();
  const y = pdfKop(doc, 'Totaaloverzicht TSO', sj, []);

  autoTable(doc, {
    startY: y,
    theme: 'plain',
    body: [
      ['Totaal binnengekomen', euro.format(binnen)],
      ['Totaal openstaand', euro.format(openstaand)],
      ['Betaald (aantal betaalverzoeken)', `${betaald} van ${uitgevraagd}  (${pctAantal.toFixed(1)}%)`],
      ['Betaald (bedrag)', `${euro.format(binnen)} van ${euro.format(verwacht)}  (${pctBedrag.toFixed(1)}%)`],
      ['Leerlingen met leergeld', `${t.aantal_leergeld} van ${t.aantal_leerlingen}`],
      ['Overgemaakt (gemeld op rekening)', euro.format(totOver)],
    ],
    styles: { fontSize: 11, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 90 } },
  });

  let y2 = doc.lastAutoTable.finalY + 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(31, 41, 55);
  doc.text('Binnengekomen per maand', 14, y2);

  autoTable(doc, {
    startY: y2 + 4,
    head: [['Maand', 'Binnengekomen']],
    body: MAANDEN.map((m, i) => [m, binMap.get(i + 1) ? euro.format(binMap.get(i + 1)) : '—']),
    foot: [['Totaal', euro.format(binnen)]],
    styles: { fontSize: 10, cellPadding: 2.5 },
    headStyles: KOP_STIJL,
    footStyles: VOET_STIJL,
    columnStyles: { 1: { halign: 'right' } },
  });

  doc.save(`totaaloverzicht-tso-${sj.naam}.pdf`);
}
