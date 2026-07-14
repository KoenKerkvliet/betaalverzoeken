import { getGroepen } from './data.js';

// Placeholder-pagina per groep. De inhoud (leerlingen/ouders + betalingen)
// bouwen we in een volgende stap.
export async function renderGroep(root, id) {
  const groepen = await getGroepen();
  const groep = groepen.find((g) => g.id === id);

  if (!groep) {
    root.innerHTML =
      '<div class="empty-state">Deze groep bestaat niet (meer). Kies een groep in de zijbalk.</div>';
    return;
  }

  root.innerHTML = `
    <header class="page-head">
      <h1>Groep ${groep.naam}</h1>
      <p class="muted">Hier komt straks het overzicht van leerlingen/ouders en hun betalingen voor deze groep.</p>
    </header>
    <div class="empty-state">
      Deze pagina bouwen we in de volgende stap.
    </div>`;
}
