-- ===========================================================================
-- TSO Betaalverzoeken — databaseschema
-- Draai dit in de Supabase SQL Editor (of via `apply_migration` met de MCP).
-- ===========================================================================

-- --- Instellingen (één rij) ------------------------------------------------
create table if not exists public.instellingen (
  id           smallint primary key default 1,
  tso_dagprijs numeric(6,2) not null default 1.75,
  schooljaar   text not null default '2025-2026',
  updated_at   timestamptz not null default now(),
  -- Encryptie-metadata (nullable = nog niet ingesteld). Nooit de sleutel/passphrase.
  enc_salt     text,
  enc_check    text,
  enc_check_iv text,
  constraint instellingen_enkele_rij check (id = 1)
);

-- Zorg dat de standaardrij bestaat.
insert into public.instellingen (id) values (1)
  on conflict (id) do nothing;

-- --- Schooljaren -----------------------------------------------------------
-- Elk schooljaar heeft eigen groepen en een eigen dagprijs, zodat een
-- prijswijziging in een nieuw jaar de historie niet verandert.
create table if not exists public.schooljaren (
  id           uuid primary key default gen_random_uuid(),
  naam         text not null unique,
  tso_dagprijs numeric(6,2) not null default 1.75,
  created_at   timestamptz not null default now()
);

-- --- Groepen (per schooljaar) ---------------------------------------------
create table if not exists public.groepen (
  id           uuid primary key default gen_random_uuid(),
  naam         text not null,
  volgorde     integer not null default 0,
  schooljaar_id uuid not null references public.schooljaren(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (schooljaar_id, naam)
);

-- --- TSO-dagen per groep per maand ----------------------------------------
-- maand = 1..10 (Aug/sept, Okt, Nov, Dec, Jan, Feb, Mrt, Apr, Mei, Jun)
create table if not exists public.tso_dagen (
  id         uuid primary key default gen_random_uuid(),
  groep_id   uuid not null references public.groepen(id) on delete cascade,
  maand      smallint not null check (maand between 1 and 10),
  dagen      integer not null default 0 check (dagen >= 0),
  updated_at timestamptz not null default now(),
  unique (groep_id, maand)
);

-- --- Leerlingen (naam versleuteld) ----------------------------------------
create table if not exists public.leerlingen (
  id         uuid primary key default gen_random_uuid(),
  groep_id   uuid not null references public.groepen(id) on delete cascade,
  enc_naam   text not null,   -- ciphertext (base64) van {voornaam, achternaam}
  iv         text not null,   -- unieke IV per leerling (base64)
  leergeld        boolean not null default false, -- vergoed door Stichting Leergeld
  leergeld_bedrag numeric(8,2),                    -- handmatig in te vullen bedrag
  instroom_maand  smallint check (instroom_maand between 1 and 10), -- meedoen vanaf
  uitgesloten_maanden smallint[] not null default '{}',            -- maanden die niet meetellen
  regelingen      jsonb not null default '{}'::jsonb,              -- maand -> opmerking (regeling)
  created_at timestamptz not null default now()
);
create index if not exists leerlingen_groep_idx on public.leerlingen(groep_id);

-- --- Betalingen (per leerling per maand) ----------------------------------
create table if not exists public.betalingen (
  id          uuid primary key default gen_random_uuid(),
  leerling_id uuid not null references public.leerlingen(id) on delete cascade,
  maand       smallint not null check (maand between 1 and 10),
  bedrag      numeric(8,2) not null,
  updated_at  timestamptz not null default now(),
  unique (leerling_id, maand)
);
create index if not exists betalingen_leerling_idx on public.betalingen(leerling_id);

-- --- Overgemaakt (handmatig; meerdere betalingen per schooljaar/maand) -----
create table if not exists public.overgemaakt (
  id            uuid primary key default gen_random_uuid(),
  schooljaar_id uuid not null references public.schooljaren(id) on delete cascade,
  maand         smallint not null check (maand between 1 and 10),
  bedrag        numeric(10,2) not null default 0,
  opmerking     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists overgemaakt_schooljaar_maand_idx
  on public.overgemaakt(schooljaar_id, maand);

-- --- Notities (logboek per leerling; actie versleuteld) -------------------
create table if not exists public.notities (
  id          uuid primary key default gen_random_uuid(),
  leerling_id uuid not null references public.leerlingen(id) on delete cascade,
  datum       date not null,
  enc_actie   text not null,
  iv          text not null,
  created_at  timestamptz not null default now()
);
create index if not exists notities_leerling_idx on public.notities(leerling_id);

-- ===========================================================================
-- Row Level Security
-- Er is geen registratie: alleen door jou in Supabase aangemaakte accounts
-- kunnen inloggen. Elke ingelogde (authenticated) gebruiker mag alles lezen
-- en schrijven; anoniem verkeer krijgt niets.
-- ===========================================================================

alter table public.instellingen enable row level security;
alter table public.schooljaren  enable row level security;
alter table public.groepen      enable row level security;
alter table public.tso_dagen    enable row level security;
alter table public.leerlingen   enable row level security;
alter table public.betalingen   enable row level security;
alter table public.overgemaakt  enable row level security;
alter table public.notities     enable row level security;

do $$
begin
  -- instellingen
  if not exists (select 1 from pg_policies where tablename = 'instellingen' and policyname = 'ingelogd_alles') then
    create policy ingelogd_alles on public.instellingen
      for all to authenticated using (true) with check (true);
  end if;
  -- groepen
  if not exists (select 1 from pg_policies where tablename = 'groepen' and policyname = 'ingelogd_alles') then
    create policy ingelogd_alles on public.groepen
      for all to authenticated using (true) with check (true);
  end if;
  -- tso_dagen
  if not exists (select 1 from pg_policies where tablename = 'tso_dagen' and policyname = 'ingelogd_alles') then
    create policy ingelogd_alles on public.tso_dagen
      for all to authenticated using (true) with check (true);
  end if;
  -- leerlingen
  if not exists (select 1 from pg_policies where tablename = 'leerlingen' and policyname = 'ingelogd_alles') then
    create policy ingelogd_alles on public.leerlingen
      for all to authenticated using (true) with check (true);
  end if;
  -- schooljaren
  if not exists (select 1 from pg_policies where tablename = 'schooljaren' and policyname = 'ingelogd_alles') then
    create policy ingelogd_alles on public.schooljaren
      for all to authenticated using (true) with check (true);
  end if;
  -- betalingen
  if not exists (select 1 from pg_policies where tablename = 'betalingen' and policyname = 'ingelogd_alles') then
    create policy ingelogd_alles on public.betalingen
      for all to authenticated using (true) with check (true);
  end if;
  -- overgemaakt
  if not exists (select 1 from pg_policies where tablename = 'overgemaakt' and policyname = 'ingelogd_alles') then
    create policy ingelogd_alles on public.overgemaakt
      for all to authenticated using (true) with check (true);
  end if;
  -- notities
  if not exists (select 1 from pg_policies where tablename = 'notities' and policyname = 'ingelogd_alles') then
    create policy ingelogd_alles on public.notities
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- ===========================================================================
-- Aggregatie-functie: schoolbreed betaald per maand (vermijdt de 1000-rijen
-- limiet van de REST-API door server-side op te tellen).
-- ===========================================================================
create or replace function public.betalingen_per_maand(p_schooljaar_id uuid)
returns table(maand smallint, totaal numeric)
language sql
stable
as $$
  select b.maand, sum(b.bedrag)::numeric as totaal
  from public.betalingen b
  join public.leerlingen l on l.id = b.leerling_id
  join public.groepen g on g.id = l.groep_id
  where g.schooljaar_id = p_schooljaar_id
  group by b.maand;
$$;
