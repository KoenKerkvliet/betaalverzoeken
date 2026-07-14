// Supabase configuratie.
// De anon/publishable key is bedoeld om publiek te zijn — die mag in deze
// statische site staan. Zet HIER NOOIT de service_role key neer.
//
// TODO: plak hieronder je anon/publishable key uit het Supabase dashboard:
//   Project Settings → API → Project API keys → "anon" / "publishable".

export const SUPABASE_URL = 'https://qssxuenhqzpjynjensir.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_967lK1PyGtWb34WlIYBuqw_i5ni1TmG';

// De 10 schoolmaanden (index 1..10), volgorde zoals in je Excel-overzicht.
export const MAANDEN = [
  'Aug/sept',
  'Oktober',
  'November',
  'December',
  'Januari',
  'Februari',
  'Maart',
  'April',
  'Mei',
  'Juni',
];
