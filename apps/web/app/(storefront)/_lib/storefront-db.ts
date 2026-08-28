// `server-only` hace **fallar el build** si este módulo termina importado desde un Client
// Component. Ya está en `apps/web/package.json`, así que el guard es real y no una nota al pie.
import 'server-only';

import { sql } from 'drizzle-orm';
import { createDb, type Database } from '@istock/db';

/**
 * **La única puerta de `(storefront)` a Postgres.** Vivía adentro de `_lib/tenant.ts`, donde era
 * privada; S3 agregó un segundo lector (`_lib/listings.ts`) y una función de sesión duplicada es
 * la forma más silenciosa de perder el `set local role anon`: la copia nueva "funciona" en local,
 * donde el dueño de la conexión es superusuario, y lee cero filas en producción. Se movió acá
 * entera, sin cambiarle una línea de comportamiento, para que haya **una** sesión de vidriera.
 *
 * ## Por qué el visitante NO es un cliente de Postgres, y por qué igual bajamos de rol
 * El visitante nunca abre una conexión: el 5% que falla el cache lo resuelve el server. Pero el
 * server **no puede consultar con los privilegios que tenga la conexión de la app**: eso deja a la
 * vidriera leyendo `listings` sin ninguna policy aplicable, y en local, donde el dueño de la
 * conexión es superusuario, `FORCE ROW LEVEL SECURITY` tampoco frena nada. Toda query de la
 * vidriera baja a `anon` dentro de una transacción, exactamente como hace el panel en
 * `apps/web/app/(app)/_lib/db/session.ts` y como hace PostgREST en producción.
 *
 * El `where tenant_id = …` explícito de cada query **se queda igual**: es defensa en profundidad
 * (`CLAUDE.md` §2 y §5), no un reemplazo de RLS. Si mañana alguien afloja la policy en un fix
 * apurado, la query sigue acotada; si mañana alguien borra el `where`, la policy sigue acotando.
 */

/**
 * Pool memoizado a nivel de módulo. **Esto es legal acá y sería un bug en `proxy.ts`**: el proxy
 * corre fuera del runtime de la app y la doc dice explícito que no dependas de globals; este
 * módulo corre dentro de la función de la página.
 *
 * `max: 1`: Vercel abre una función por request y Postgres cobra por conexión. Un pool grande en
 * serverless no da throughput, agota el pool.
 *
 * Lo que se memoiza es **la conexión**, nunca el rol ni los claims: esos se setean por transacción
 * con `set local`, que muere en el `commit`. Una conexión reusada no puede arrastrar el slug de
 * otro visitante al siguiente request.
 */
let pool: Database | null = null;

function storefrontPool(): Database {
  if (pool === null) pool = createDb({ max: 1 }).db;
  return pool;
}

/** El tipo de la transacción de Drizzle, sin repetir los genéricos de `PgTransaction`. */
export type StorefrontTx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Los claims de la vidriera anónima. **No hay usuario y no hay `tenant_id`**: lo único que el
 * server conoce antes de consultar nada es el slug del host, y eso es lo que acota las filas.
 *
 * Forma exacta que exige `packages/db/drizzle/0002_storefront_anon_grants.sql`:
 *
 *     {"role":"anon","app_metadata":{"storefront_slug":"acme"}}
 *
 * `public.storefront_slug()` lee `auth.jwt() -> 'app_metadata' ->> 'storefront_slug'`. Sin claim
 * devuelve NULL y **todas** las policies `TO anon` dan falso: cero filas. Falla cerrado.
 *
 * El slug va en `app_metadata` y no en `user_metadata` por la misma razón que el `tenant_id` del
 * panel (`CLAUDE.md` §2, lint `0015`): `user_metadata` lo escribe el propio usuario.
 */
function storefrontClaims(slug: string): string {
  return JSON.stringify({ role: 'anon', app_metadata: { storefront_slug: slug } });
}

/**
 * Toda query de la vidriera pasa por acá. Es el equivalente de `withTenantDb()` del panel:
 *
 *     begin;
 *       set local role anon;
 *       select set_config('request.jwt.claims', '{"role":"anon",…}', true);
 *       <la query, con su where explícito ADEMÁS de RLS>
 *     commit;
 *
 * `set local role anon` es lo que hace que el test de aislamiento pruebe algo: sin él, en local la
 * conexión es superusuario y **se saltea `FORCE ROW LEVEL SECURITY` entera**, así que la vidriera
 * daría verde en dev y leería cero filas en producción — donde `anon` sí es `anon`.
 *
 * `set local` muere con la transacción. No hay forma de que el slug de un request sobreviva al
 * siguiente aunque la conexión del pool se reuse.
 *
 * Una sola transacción por render cacheado: la ficha lee tenant + fx + puntos + equipo + fotos +
 * modelo adentro del mismo `fn`. No es una micro-optimización — son seis roundtrips contra uno en
 * el 5% de requests que fallan el cache, y el otro 95% no ejecuta nada de esto.
 */
export async function withStorefrontDb<T>(slug: string, fn: (tx: StorefrontTx) => Promise<T>): Promise<T> {
  const claims = storefrontClaims(slug);

  return storefrontPool().transaction(async (tx) => {
    // Literal, sin interpolación: `set local role` no acepta parámetros y el rol no es un dato
    // de entrada. El slug sí es dato de entrada, y va parametrizado en el `set_config`.
    await tx.execute(sql`set local role anon`);
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    return fn(tx);
  });
}
