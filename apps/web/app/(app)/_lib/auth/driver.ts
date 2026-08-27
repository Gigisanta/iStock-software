import 'server-only';
import { assertLocalDriverAllowed, serverEnv } from '../env';
import { localAuthDriver } from './local-driver';
import { supabaseAuthDriver } from './supabase-driver';
import type { AuthDriver } from './types';

/**
 * Selector del driver. Un solo lugar donde se decide, para que "¿estamos con Supabase o con el
 * driver de dev?" tenga una respuesta y no siete.
 */
export function authDriver(): AuthDriver {
  const env = serverEnv();

  if (env.AUTH_DRIVER === 'supabase') return supabaseAuthDriver();

  // Tira si `NODE_ENV === 'production'`. Un driver que no verifica el mail no se despliega.
  assertLocalDriverAllowed(env);
  return localAuthDriver();
}
