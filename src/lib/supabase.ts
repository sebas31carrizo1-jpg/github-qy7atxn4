import { createClient } from '@supabase/supabase-js';

let supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
let supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ||
  '';

const esUrlHttp = (value: string) => /^https?:\/\//i.test(value);
const pareceClavePublica = (value: string) =>
  value.startsWith('sb_publishable_') || value.startsWith('eyJ');

// GitHub Actions tenía las dos credenciales intercambiadas.
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
    'Configuración de Supabase inválida: VITE_SUPABASE_URL debe contener la URL HTTPS del proyecto.'
  );
}

if (!supabaseKey || !pareceClavePublica(supabaseKey)) {
  throw new Error(
    'Configuración de Supabase inválida: ingresá la clave pública sb_publishable_ del proyecto (o la clave anon JWT heredada). Nunca uses sb_secret_ ni service_role.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
