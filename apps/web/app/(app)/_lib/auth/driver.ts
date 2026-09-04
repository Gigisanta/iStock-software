import 'server-only';
import { assertLocalDriverAllowed, serverEnv } from '../env';
import { localAuthDriver } from './local-driver';
import { neonAuthDriver } from './neon-driver';
import type { AuthDriver } from './types';

/**
 * Selector del driver. Producción usa Neon Auth; el driver local existe sólo para desarrollo y
 * tests. Mantener una sola ruta productiva evita que el panel dependa de dos contratos de sesión.
 */
export function authDriver(): AuthDriver {
  const env = serverEnv();

  if (env.AUTH_DRIVER === 'neon') return neonAuthDriver();

  // Tira si `NODE_ENV === 'production'`. Un driver que no verifica el mail no se despliega.
  assertLocalDriverAllowed(env);
  return localAuthDriver();
}
