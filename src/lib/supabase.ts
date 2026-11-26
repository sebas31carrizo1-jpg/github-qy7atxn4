import { createClient } from '@supabase/supabase-js';

let supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
let supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

const esUrlHttp = (value: string) => /^https?:\/\//i.test(value);
const pareceClavePublica = (value: string) =>
  value.startsWith('sb_publishable_') || value.startsWith('eyJ');

// Si el hosting recibió URL y clave en los campos opuestos, corregirlo
// para evitar que Supabase arranque con una URL inválida.
if (
  !esUrlHttp(supabaseUrl) &&
  esUrlHttp(supabaseKey) &&
  pareceClavePublica(supabaseUrl)
) {
  [supabaseUrl, supabaseKey] = [supabaseKey, supabaseUrl];
  console.warn(
    'Las variables de Supabase estaban intercambiadas. Se corrigieron al iniciar; revisá también la configuración del hosting.'
  );
}

if (!supabaseUrl || !esUrlHttp(supabaseUrl)) {
  throw new Error(
    'Configuración de Supabase inválida: VITE_SUPABASE_URL debe contener la URL HTTPS del proyecto (https://<project-ref>.supabase.co).'
  );
}

if (
  !supabaseKey ||
  supabaseKey.startsWith('sb_secret_') ||
  supabaseKey.startsWith('service_role')
) {
  throw new Error(
    'Configuración de Supabase inválida: VITE_SUPABASE_ANON_KEY debe contener la clave pública sb_publishable_ del proyecto (nunca una clave secreta).'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
