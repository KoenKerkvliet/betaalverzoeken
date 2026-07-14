# TSO Betaalverzoeken

Privé dashboard om per groep en maand bij te houden hoeveel TSO-dagen er zijn
geweest en welk bedrag ouders daarvoor moeten betalen. Statische site (GitHub
Pages) met Supabase als backend (Auth + database).

## Structuur

```
index.html        Loginpagina (geen registratie)
reset.html        Nieuw wachtwoord instellen (via herstelmail)
app.html          Dashboard-shell met sidebar
css/styles.css    Styling
js/config.js      Supabase URL + anon key (aanpassen!) + maandenlijst
js/…              App-logica (auth, router, overzicht, instellingen)
db/schema.sql     Databaseschema + RLS
```

## Eenmalige setup

1. **Database inrichten** — draai `db/schema.sql` in de Supabase SQL Editor
   (of via de MCP-connector met `apply_migration`).
2. **Anon key invullen** — Supabase dashboard → Project Settings → API →
   kopieer de *anon / publishable* key en plak die in `js/config.js`.
   (Deze key hoort publiek te zijn; de `service_role` key komt hier NOOIT.)
3. **Login aanmaken** — Supabase dashboard → Authentication → Users →
   "Add user". Er is bewust geen registratie in de app.
4. **(Optioneel) wachtwoord-reset via mail** — werkt met de standaard
   Supabase-mail. Later te vervangen door emailit.

## Lokaal testen

Open de map met een simpele webserver (module-imports werken niet via
`file://`), bijvoorbeeld:

```
npx serve .
```

## Deploy

Push naar `main`; GitHub Pages deployt automatisch.

## Beveiliging

- Zonder login geeft Supabase (Auth + RLS) geen data terug.
- De publieke JS bevat alleen de anon key — nooit secrets of leerlingdata.
- Leerlingnamen komen pas in een latere fase en worden dan client-side
  versleuteld (alleen de naam); deze overzichtspagina bevat alleen groepen.
```
