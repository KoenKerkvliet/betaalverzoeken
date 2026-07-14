import {
  getInstellingen,
  saveDagprijs,
  getGroepen,
  addGroep,
  renameGroep,
  deleteGroep,
} from './data.js';

export async function renderInstellingen(root) {
  const [instellingen, groepen] = await Promise.all([getInstellingen(), getGroepen()]);

  root.innerHTML = `
    <header class="page-head">
      <h1>Instellingen</h1>
      <p class="muted">Beheer de TSO-dagprijs en je groepen</p>
    </header>

    <section class="kaart">
      <h2>TSO-kosten</h2>
      <p class="muted">Kosten voor één TSO-dag. Dit bedrag wordt gebruikt om per groep en maand het te betalen bedrag te berekenen.</p>
      <form id="prijs-form" class="inline-form">
        <label>
          Prijs per dag (€)
          <input type="number" id="dagprijs" min="0" step="0.01" value="${Number(
            instellingen.tso_dagprijs
          ).toFixed(2)}" required />
        </label>
        <button type="submit" class="btn btn-primary">Opslaan</button>
        <span id="prijs-status" class="save-status"></span>
      </form>
    </section>

    <section class="kaart">
      <h2>Groepen</h2>
      <p class="muted">Deze groepen verschijnen (van boven naar beneden) in het overzicht.</p>

      <ul class="groep-lijst" id="groep-lijst">
        ${groepen.map(groepRij).join('') || '<li class="muted">Nog geen groepen.</li>'}
      </ul>

      <form id="groep-form" class="inline-form">
        <label>
          Nieuwe groep
          <input type="text" id="nieuwe-groep" placeholder="bijv. 1a" required maxlength="20" />
        </label>
        <button type="submit" class="btn btn-primary">Toevoegen</button>
      </form>
    </section>
  `;

  // --- Dagprijs -----------------------------------------------------------
  const prijsForm = root.querySelector('#prijs-form');
  const prijsStatus = root.querySelector('#prijs-status');
  prijsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prijs = Number(root.querySelector('#dagprijs').value);
    try {
      await saveDagprijs(prijs);
      prijsStatus.textContent = 'Opgeslagen ✓';
      prijsStatus.classList.add('zichtbaar');
      setTimeout(() => prijsStatus.classList.remove('zichtbaar'), 1500);
    } catch (err) {
      console.error(err);
      prijsStatus.textContent = 'Opslaan mislukt';
    }
  });

  // --- Groep toevoegen ----------------------------------------------------
  const groepForm = root.querySelector('#groep-form');
  groepForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = root.querySelector('#nieuwe-groep');
    const naam = input.value.trim();
    if (!naam) return;
    const volgorde = groepen.length ? Math.max(...groepen.map((g) => g.volgorde ?? 0)) + 1 : 0;
    await addGroep(naam, volgorde);
    await renderInstellingen(root);
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
          `Groep "${naam}" verwijderen? De ingevulde TSO-dagen van deze groep worden ook verwijderd.`
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
