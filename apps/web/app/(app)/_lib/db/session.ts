import 'server-only';
import { sql } from 'drizzle-orm';
import { buildJwtClaims } from '../auth/types';
import { db, type Tx } from './connection';

/**
 * Las **dos** formas de hablar con Postgres desde el panel. Son dos y no una porque tienen
 * privilegios distintos, y mezclarlas es exactamente el bug que RLS existe para atrapar.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *  `withTenantDb(ctx, fn)`  → TODA query de negocio. Corre como `authenticated` con los claims
 *                             del usuario, o sea **con RLS activa**.
 *  `withServiceDb(fn)`      → lo que **no puede tener claim de tenant por construcción**: el
 *                             bootstrap de la sesión, los jobs sin persona y el webhook que
 *                             autentica un tercero por HMAC. Sin RLS. Criterio y usos, abajo.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Lo que hace `withTenantDb` es literalmente lo que hace PostgREST en producción, y lo mismo que
 * hace `packages/db/src/test-session.ts` en los tests de RLS cruzado:
 *
 *   begin;
 *     set local role authenticated;
 *     select set_config('request.jwt.claims', '<json>', true);
 *     <la query>
 *   commit;
 *
 * `set local` muere con la transacción: no hay forma de que los claims de un request se filtren
 * al siguiente aunque la conexión se reuse. Eso es justamente por qué **todo va adentro de una
 * transacción** y no en un `SET SESSION`.
 *
 * Y aun así, **RLS no alcanza sola**: `CLAUDE.md` §2 pide el `where tenant_id = ...` explícito en
 * cada query *además* de la policy. Este helper habilita la policy; no exime del `where`. Si
 * mañana alguien afloja una policy en un fix apurado, la query sigue acotada.
 */

export interface TenantContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: 'owner' | 'seller';
}

export async function withTenantDb<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const claims = JSON.stringify(buildJwtClaims(ctx.userId, ctx.tenantId));

  return db().transaction(async (tx) => {
    await tx.execute(sql`set local role authenticated`);
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    return fn(tx);
  });
}

/**
 * Conexión con privilegios de operador. **Bypassea RLS.**
 *
 * ── EL CRITERIO (esto es lo que hay que aplicar; la lista de abajo es su consecuencia) ────────
 *
 * `withServiceDb` es legítimo **cuando el llamador no puede tener claim de tenant por
 * construcción** — no cuando le queda incómodo tenerlo. "Por construcción" es literal y se
 * responde con una sola pregunta: *¿de dónde saldría el claim?* Hay exactamente tres formas de que
 * la respuesta sea "de ningún lado":
 *
 *   (a) **El claim es lo que se está resolviendo.** Huevo y gallina: la fila que diría a qué tenant
 *       pertenece esta sesión es la que hay que leer para tener el claim.
 *   (b) **No hay persona.** Lo dispara un scheduler nuestro, no un request de alguien.
 *   (c) **Hay un tercero, y su autenticación no es una sesión.** Lo llama un sistema externo que se
 *       identifica con una firma (HMAC), no con un usuario. No hay cookie, no hay JWT, no hay claim.
 *
 * Y el motivo por el que "menos permiso" no es la opción conservadora acá: bajo `withTenantDb` con
 * el claim en `null`, las policies **no fallan** — devuelven cero filas y no escriben nada, con un
 * `commit` limpio. El cron no vencería una sola reserva; el webhook devolvería 200 sin activar el
 * plan. Menos permiso no da menos datos: da **la respuesta equivocada, en silencio**, que es
 * exactamente el modo de falla que RLS existe para no tener.
 *
 * Lo que el criterio **no** acepta, dicho para que no haya que deducirlo: "es más simple", "es sólo
 * una lectura", "el usuario es owner igual", "es un endpoint interno". Todas esas tienen claim
 * disponible y por lo tanto van por `withTenantDb`.
 *
 * ── LA OBLIGACIÓN QUE VIENE CON LA EXCEPCIÓN ─────────────────────────────────────────────────
 * Sin RLS, la única capa que queda es la del §2 de `CLAUDE.md`: **el `tenant_id` explícito**. Todo
 * uso de acá abajo lleva su `tenant_id` en el `where` (lectura) o en el `values()` (escritura), y
 * ninguno recibe datos del request sin validarlos antes. Un `withServiceDb` sin filtro de tenant
 * explícito no es una excepción justificada: es una query sin ninguna capa.
 *
 * ── LOS USOS DE HOY, aplicando el criterio ───────────────────────────────────────────────────
 *
 * Son cinco. **El número no es la regla** —la regla es el criterio de arriba— y esta línea decía lo
 * contrario hasta el 2026-08-28: decía que "cualquier quinto uso es un bug de seguridad". Un
 * docblock que prohíbe por contador envejece mal: el día que aparece un caso legítimo obliga a
 * elegir entre mentirle al docblock o no hacer el trabajo, y las dos son malas. Lo que sí sigue
 * siendo cierto es que **un uso nuevo se agrega acá con su motivo escrito, o no se agrega**.
 *
 * 1. `resolveMembership()` — (a). Leer a qué tenant pertenece un usuario. Es el problema del huevo y
 *    la gallina: para leer `memberships` bajo RLS hace falta el claim de tenant, y el claim de
 *    tenant sale de `memberships`. En Supabase esto lo resuelve el Custom Access Token Hook, que
 *    también corre con privilegios. Está acotado por `user_id = auth.uid()` verificado antes.
 * 2. `createTenant()` — (a). El usuario todavía no tiene claim, así que la policy
 *    `tenants_tenant_insert` (`with check id = <claim>`) lo rechazaría con el claim en `null`.
 * 3. El driver local de auth — (a). Emula el alta de `auth.users` que en producción hace GoTrue.
 * 4. `expireDueReservations()` (S6) — (b). El cron de expiración: lo dispara Vercel Cron, no una
 *    persona. Es el primero que **no** es bootstrap de sesión. Bajo `withTenantDb` no vencería una
 *    sola reserva y no habría error. Acotado por lo que escribe: los tres `update`/`insert` llevan
 *    `tenant_id` del tenant de **su** fila, y lo único que sale de la función son cinco números. Su
 *    justificación completa, incluida la excepción `web-lint:sin-tenant` del `select`, vive en
 *    `_lib/reservations/expire-reservations.ts`.
 * 5. `createPgBillingEventLedger()` (B2, `(billing)/_lib/webhook/pg-ledger.ts`) — (c). El ledger de
 *    idempotencia del webhook de Mercado Pago. **Lo llama Mercado Pago, no una persona**: el
 *    handler nunca ve una cookie ni un JWT. Lo verifiqué leyendo el camino entero antes de escribir
 *    esta línea, y el orden importa porque es lo que hace que la excepción no sea una puerta
 *    abierta: `billing/webhooks/mercadopago/route.ts:113-115` resuelve las dependencias y devuelve
 *    401 si falta el secreto —o sea que sin secreto configurado el handler no llega ni a leer el
 *    body—; `_lib/webhook/handle-notification.ts:105` verifica el HMAC de `x-signature` y corta con
 *    401 en `:115`; recién en `:160` se toca Postgres. Cuando `withServiceDb` corre, la firma ya se
 *    validó. Acotado por lo que escribe: el `insert` lleva `tenant_id` explícito, salido del
 *    `external_reference` validado con forma de UUID, y el único único es
 *    `(provider, provider_event_id)` — sin `tenant_id`, porque los ids de notificación de MP son
 *    globales y meter el tenant en la clave permitiría aplicar el mismo cobro una vez por tenant.
 *
 * Si necesitás leer listings, fotos, ventas o canjes desde una pantalla, ninguna de las tres formas
 * aplica —hay sesión, hay claim— y va por `withTenantDb`.
 */
export async function withServiceDb<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => fn(tx));
}
