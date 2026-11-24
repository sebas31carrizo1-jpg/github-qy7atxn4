import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

console.log('URL Supabase:', supabaseUrl);
console.log(
  'Prefijo de clave:',
  supabaseKey?.substring(0, 20)
);
console.log(
  'Longitud de clave:',
  supabaseKey?.length
);

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Faltan las credenciales de Supabase.');
}

export const supabase = createClient(
  supabaseUrl,
  supabaseKey
);