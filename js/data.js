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

// --- Groepen ---------------------------------------------------------------

export async function getGroepen() {
  const { data, error } = await supabase
    .from('groepen')
    .select('*')
    .order('volgorde', { ascending: true })
    .order('naam', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addGroep(naam, volgorde) {
  const { error } = await supabase.from('groepen').insert({ naam, volgorde });
  if (error) throw error;
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

export async function getTsoDagen() {
  const { data, error } = await supabase.from('tso_dagen').select('*');
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
