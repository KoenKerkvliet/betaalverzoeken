import { supabase } from './supabaseClient.js';

// --- Instellingen (één rij, id = 1) ---------------------------------------

export async function getInstellingen() {
  const { data, error } = await supabase
    .from('instellingen')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  // Als de rij nog niet bestaat, val terug op standaardwaarden.
  return data ?? { id: 1, tso_dagprijs: 1.75, schooljaar: '2025-2026' };
}

export async function saveDagprijs(prijs) {
  const { error } = await supabase
    .from('instellingen')
    .upsert({ id: 1, tso_dagprijs: prijs });
  if (error) throw error;
}

// Slaat de encryptie-metadata op (salt + controlewaarde). Nooit de sleutel zelf.
export async function saveEncryptieSetup({ enc_salt, enc_check, enc_check_iv }) {
  const { error } = await supabase
    .from('instellingen')
    .update({ enc_salt, enc_check, enc_check_iv })
    .eq('id', 1);
  if (error) throw error;
}

// --- Schooljaren -----------------------------------------------------------

export async function getSchooljaren() {
  const { data, error } = await supabase
    .from('schooljaren')
    .select('*')
    .order('naam', { ascending: false }); // nieuwste bovenaan
  if (error) throw error;
  return data ?? [];
}

// Zoekt een schooljaar op naam of maakt het aan. Geeft de rij terug.
export async function findOrCreateSchooljaar(naam, dagprijs = 1.75) {
  const { data: bestaand } = await supabase
    .from('schooljaren')
    .select('*')
    .eq('naam', naam)
    .maybeSingle();
  if (bestaand) return bestaand;

  const { data, error } = await supabase
    .from('schooljaren')
    .insert({ naam, tso_dagprijs: dagprijs })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function saveDagprijsSchooljaar(schooljaarId, prijs) {
  const { error } = await supabase
    .from('schooljaren')
    .update({ tso_dagprijs: prijs })
    .eq('id', schooljaarId);
  if (error) throw error;
}

// --- Groepen ---------------------------------------------------------------

export async function getGroepen(schooljaarId) {
  let q = supabase
    .from('groepen')
    .select('*')
    .order('volgorde', { ascending: true })
    .order('naam', { ascending: true });
  if (schooljaarId) q = q.eq('schooljaar_id', schooljaarId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// Zoekt een groep binnen een schooljaar op naam, of maakt 'm aan (voor import).
export async function findOrCreateGroep(naam, volgorde, schooljaarId) {
  const { data: bestaand } = await supabase
    .from('groepen')
    .select('*')
    .eq('schooljaar_id', schooljaarId)
    .eq('naam', naam)
    .maybeSingle();
  if (bestaand) return bestaand;

  const { data, error } = await supabase
    .from('groepen')
    .insert({ naam, volgorde, schooljaar_id: schooljaarId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function renameGroep(id, naam) {
  const { error } = await supabase.from('groepen').update({ naam }).eq('id', id);
  if (error) throw error;
}

export async function deleteGroep(id) {
  const { error } = await supabase.from('groepen').delete().eq('id', id);
  if (error) throw error;
}

// --- TSO-dagen per groep per maand ----------------------------------------

// Haalt tso-dagen op, optioneel beperkt tot een set groep-id's (één schooljaar).
export async function getTsoDagen(groepIds) {
  let q = supabase.from('tso_dagen').select('*');
  if (groepIds) {
    if (!groepIds.length) return [];
    q = q.in('groep_id', groepIds);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// Slaat het aantal dagen op voor één groep/maand-combinatie.
export async function upsertTsoDagen(groep_id, maand, dagen) {
  const { error } = await supabase
    .from('tso_dagen')
    .upsert({ groep_id, maand, dagen }, { onConflict: 'groep_id,maand' });
  if (error) throw error;
}

// --- Leerlingen (naam versleuteld) ----------------------------------------

// groep mag een id (string) of een lijst id's (array) zijn, of leeg (alles).
export async function getLeerlingen(groep) {
  let q = supabase.from('leerlingen').select('*');
  if (Array.isArray(groep)) {
    if (!groep.length) return [];
    q = q.in('groep_id', groep);
  } else if (groep) {
    q = q.eq('groep_id', groep);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// velden mag { leergeld, leergeld_bedrag } bevatten (één of beide).
export async function setLeergeld(id, velden) {
  const { error } = await supabase.from('leerlingen').update(velden).eq('id', id);
  if (error) throw error;
}

export async function insertLeerlingen(rows) {
  if (!rows.length) return;
  const { error } = await supabase.from('leerlingen').insert(rows);
  if (error) throw error;
}

export async function deleteLeerling(id) {
  const { error } = await supabase.from('leerlingen').delete().eq('id', id);
  if (error) throw error;
}
