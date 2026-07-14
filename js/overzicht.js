import { euro } from './supabaseClient.js';
import { MAANDEN } from './config.js';
import { getInstellingen, getGroepen, getTsoDagen, upsertTsoDagen } from './data.js';

export async function renderOverzicht(root) {
  const [instellingen, groepen, dagen] = await Promise.all([
    getInstellingen(),
    getGroepen(),
    getTsoDagen(),
  ]);

  const dagprijs = Number(instellingen.tso_dagprijs) || 0;

  // Snelle opzoektabel: "groepId:maand" -> aantal dagen
  const kaart = new Map();
  for (const d of dagen) kaart.set(`${d.groep_id}:${d.maand}`, d.dagen);

  if (groepen.length === 0) {
    root.innerHTML = `
      <header class="page-head">
        <h1>Overzicht</h1>
        <p class="muted">Schooljaar ${instellingen.schooljaar ?? ''} · €${dagprijs
      .toFixed(2)
      .replace('.', ',')} per TSO-dag</p>
      </header>
      <div class="empty-state">
        <p>Er zijn nog geen groepen. Maak eerst groepen aan bij
        <a href="#/instellingen">Instellingen</a>.</p>
      </div>`;
    return;
  }

  // Kolomkoppen
  const maandKoppen = MAANDEN.map((m) => `<th class="maand">${m}</th>`).join('');

  // Rijen
  const rijen = groepen
    .map((g) => {
      const cellen = MAANDEN.map((_, i) => {
        const maand = i + 1;
        const waarde = kaart.get(`${g.id}:${maand}`) ?? '';
        return `
          <td class="cel">
            <input class="dagen-input" type="number" min="0" step="1"
                   inputmode="numeric"
                   value="${waarde}"
                   data-groep="${g.id}" data-maand="${maand}"
                   aria-label="${g.naam} — ${MAANDEN[i]}" />
            <span class="bedrag" data-groep="${g.id}" data-maand="${maand}">
              ${waarde === '' ? '—' : euro.format(Number(waarde) * dagprijs)}
            </span>
          </td>`;
      }).join('');

      return `
        <tr>
          <th class="groep-cel" scope="row">${g.naam}</th>
          ${cellen}
          <td class="totaal-cel" data-groep-totaal="${g.id}">€ 0,00</td>
        </tr>`;
    })
    .join('');

  root.innerHTML = `
    <header class="page-head">
      <h1>Overzicht</h1>
      <p class="muted">Schooljaar ${instellingen.schooljaar ?? ''} · €${dagprijs
    .toFixed(2)
    .replace('.', ',')} per TSO-dag · vul per groep en maand het aantal TSO-dagen in</p>
    </header>

    <div class="tabel-wrap">
      <table class="overzicht-tabel">
        <thead>
          <tr>
            <th class="hoek">Groep</th>
            ${maandKoppen}
            <th class="totaal-kop">Totaal</th>
          </tr>
        </thead>
        <tbody>
          ${rijen}
        </tbody>
      </table>
    </div>
    <p id="save-status" class="save-status" aria-live="polite"></p>
  `;

  // --- Interactie ---------------------------------------------------------

  const status = root.querySelector('#save-status');
  let statusTimer = null;
  function meldOpgeslagen() {
    status.textContent = 'Opgeslagen ✓';
    status.classList.add('zichtbaar');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.classList.remove('zichtbaar'), 1500);
  }

  function herbereken() {
    let eindtotaal = 0;
    for (const g of groepen) {
      let groepTotaal = 0;
      for (let i = 1; i <= MAANDEN.length; i++) {
        const v = kaart.get(`${g.id}:${i}`);
        if (v != null && v !== '') groepTotaal += Number(v) * dagprijs;
      }
      const cel = root.querySelector(`[data-groep-totaal="${g.id}"]`);
      if (cel) cel.textContent = euro.format(groepTotaal);
      eindtotaal += groepTotaal;
    }
  }
  herbereken();

  // Debounced opslaan per cel.
  const timers = new Map();

  root.querySelectorAll('.dagen-input').forEach((input) => {
    input.addEventListener('input', () => {
      const groep = input.dataset.groep;
      const maand = Number(input.dataset.maand);
      const ruw = input.value.trim();
      const bedragEl = root.querySelector(
        `.bedrag[data-groep="${groep}"][data-maand="${maand}"]`
      );

      if (ruw === '') {
        kaart.delete(`${groep}:${maand}`);
        bedragEl.textContent = '—';
      } else {
        const dagenNum = Math.max(0, Math.floor(Number(ruw) || 0));
        kaart.set(`${groep}:${maand}`, dagenNum);
        bedragEl.textContent = euro.format(dagenNum * dagprijs);
      }
      herbereken();

      const sleutel = `${groep}:${maand}`;
      clearTimeout(timers.get(sleutel));
      timers.set(
        sleutel,
        setTimeout(async () => {
          const dagenNum = ruw === '' ? 0 : Math.max(0, Math.floor(Number(ruw) || 0));
          try {
            await upsertTsoDagen(groep, maand, dagenNum);
            meldOpgeslagen();
          } catch (e) {
            console.error(e);
            status.textContent = 'Opslaan mislukt — probeer opnieuw';
            status.classList.add('zichtbaar', 'fout');
          }
        }, 500)
      );
    });
  });
}
