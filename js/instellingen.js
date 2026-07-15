import { getGroepen, saveDagprijsSchooljaar, renameGroep, deleteGroep } from './data.js';
import { getHuidigSchooljaar } from './state.js';

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
  `;

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
