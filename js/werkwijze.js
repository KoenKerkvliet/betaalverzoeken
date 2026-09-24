// Info-popup in de header: de maandelijkse werkwijze rond de betaalverzoeken,
// als geheugensteun voor de beheerder.

const VOORBEREIDEN = [
  'Exporteer de EDEX uit <strong>ParnasSys</strong>.',
  'Importeer de EDEX in <strong>Isy</strong> en in de <strong>TSO-app</strong> (upload-icoon). Staan er leerlingen onder <em>Niet meer in EDEX</em>? Markeer ze als uitgestroomd en haal ze ook uit de betaalgroep in Isy.',
  'Vergelijk de namenlijst van <strong>groep 1</strong> in ParnasSys met die in Isy en de TSO-app. Kinderen die nog geen 4 zijn en handmatig in Isy staan, horen <strong>niet</strong> in de betaalgroep.',
  'Vul op het Overzicht de <strong>TSO-dagen</strong> van deze maand in (↓-knop boven de maand).',
  'Maak het rapport <strong>Overzichten → Deelnemers TSO</strong> voor deze maand. Haal de niet-deelnemers (leergeld, regeling, uitgesloten) uit de betaalgroep in Isy en voeg de leerlingen onder <em>Actie nodig</em> weer toe.',
  'Voeg kinderen die deze maand <strong>instromen</strong> toe aan de betaalgroep in Isy (TSO groep 1 of TSO groep 2-8).',
  'Controleer of het <strong>aantal boven de maandkolom</strong> gelijk is aan het aantal leerlingen in de TSO-betaalgroep in Isy.',
  'Zet het <strong>betaalverzoek</strong> uit. Met de envelop boven de maandkolom kopieer je de tekst voor Isy.',
];

const AFRONDEN = [
  'Exporteer de betalingen uit Isy en <strong>importeer het Excel-bestand</strong> in de TSO-app (upload-icoon, kies de juiste maand).',
  'Bekijk <strong>Openstaand</strong> op het Overzicht, stuur herinneringen en leg contact met ouders vast in de notities.',
  'Is er geld bijgeschreven? Voeg het toe via het bankbiljet-icoon (<strong>Overgemaakt</strong>).',
];

function stappenHtml(stappen, start) {
  return `<ol class="werkwijze-lijst" start="${start}">${stappen
    .map((s) => `<li>${s}</li>`)
    .join('')}</ol>`;
}

export function openWerkwijzeModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card werkwijze-card" role="dialog" aria-modal="true" aria-labelledby="werkwijze-titel">
      <div class="modal-kop">
        <h2 id="werkwijze-titel">Werkwijze betaalverzoek</h2>
        <button type="button" class="modal-x" aria-label="Sluiten">✕</button>
      </div>
      <h3 class="werkwijze-kop">Begin van de maand</h3>
      ${stappenHtml(VOORBEREIDEN, 1)}
      <h3 class="werkwijze-kop">Na twee weken (betaaltermijn verlopen)</h3>
      ${stappenHtml(AFRONDEN, VOORBEREIDEN.length + 1)}
    </div>`;
  document.body.appendChild(overlay);

  const sluit = () => {
    overlay.remove();
    document.removeEventListener('keydown', opEscape);
  };
  function opEscape(e) {
    if (e.key === 'Escape') sluit();
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) sluit();
  });
  overlay.querySelector('.modal-x').addEventListener('click', sluit);
  document.addEventListener('keydown', opEscape);
  overlay.querySelector('.modal-x').focus();
}
