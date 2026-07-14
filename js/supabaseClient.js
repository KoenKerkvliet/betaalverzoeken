import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Handig: euro-formatter (Nederlands).
export const euro = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
});

// Stuurt naar de loginpagina als er geen actieve sessie is.
export async function vereisSessie() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.replace('index.html');
    return null;
  }
  return data.session;
}
