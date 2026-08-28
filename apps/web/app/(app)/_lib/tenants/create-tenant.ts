import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DEFAULT_FX_ROUNDING } from '@istock/domain';
import { fxSettings, locations, memberships, tenants } from '@istock/db';
import { authDriver } from '../auth/driver';
import { withServiceDb } from '../db/session';
import { logError, logEvent } from '../log';
import { slugSchema } from '../slug';
import { normalizeArWaPhone } from '../wa-phone';
import { parseFxArsPerUsd } from './parse-fx';
import { invalidateStorefront } from './storefront-cache';

/** Trial de 14 días (`CLAUDE.md` §1 · `PRODUCT.md` §Planes). El trial no toca Mercado Pago. */
export const TRIAL_DAYS = 14;

/**
 * Alta del negocio. Es la única escritura del esqueleto, y toca cuatro cosas que después no se
 * pueden arreglar barato: el subdominio, el aislamiento, el trial y el cache de la vidriera.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El alta también siembra `fx_settings` y un punto de retiro, y eso NO es conveniencia
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El read model de la vidriera (`(storefront)/_lib/listings.ts`) corta así:
 *
 *     const fx = await fxContext(tx, tenant.id);
 *     if (fx === null) return { rows: [], publishedCount };   // grilla
 *     if (fx === null) return null;                            // ficha → 404
 *
 * O sea: **sin fila en `fx_settings` no se publica nada**, ni siquiera el precio en USD. Un tenant
 * que nace sin esa fila carga 15 equipos, abre su vidriera y ve la grilla vacía con el cartel de
 * "Vidriera casi lista". Eso rompe el "done cobrable" de `CLAUDE.md` §1 para **todo** tenant que
 * no sea el del seed. Por eso las dos filas se escriben en la **misma transacción** que el tenant:
 * un negocio a medio nacer es peor que uno que no nació.
 *
 * ── El TC se PREGUNTA, no se inventa ────────────────────────────────────────────────────────
 * `CLAUDE.md` §1: *"el TC lo setea el DUEÑO, manualmente, por tenant. No hay API de dólar en el
 * hot path."* Las tres salidas posibles eran:
 *
 * | opción | qué pasa |
 * |---|---|
 * | no sembrar `fx_settings` | la vidriera no publica **nada** hasta que exista la pantalla de TC (S4+) |
 * | sembrar un TC de relleno | se publica un ARS que el dueño no dijo, en la ficha que él pegó en un estado |
 * | **preguntarlo en el alta** | el TC es del dueño desde el segundo cero y la vidriera nace viva |
 *
 * Se eligió la tercera, y hay una cuarta que **no** existe: no hay forma de sembrar un TC
 * "sin confirmar". El esquema no tiene columna para eso y el sentinel obvio —`ars_per_usd = 0`—
 * hace que `fxRateFromArsCents()` **tire** adentro de un render con `'use cache'`, que bajo PPR
 * no es un 500 sino un stream que nunca cierra. `updated_by` tampoco sirve de señal: no está en
 * el `GRANT` de columnas de `anon` (migración 0002), así que la vidriera ni lo ve.
 *
 * El redondeo sí es nuestro y es `ceil_1000` (ratificado en FASE 2): así publica el reseller y
 * nunca deja el ARS por debajo del USD × TC. Se cambia por tenant, no por deploy.
 *
 * ── El punto de retiro sembrado es un placeholder VERDADERO ─────────────────────────────────
 * Sale publicado en la ficha de un desconocido, así que no puede ser una dirección inventada de
 * Neuquén. Lo que se siembra es la única cosa que ya sabemos que es cierta de todo tenant nuevo:
 * la entrega se coordina por WhatsApp, que es donde se cierra la operación. Es editable y es
 * exacto; una dirección falsa sería editable y mentira.
 */

/**
 * Punto de retiro inicial. Texto de mostrador, no relleno: mientras el dueño no cargue su local,
 * esto es literalmente cómo se entrega. `city` queda `null` a propósito — no sabemos en qué
 * ciudad está y no lo vamos a suponer.
 */
export const INITIAL_PICKUP_POINT = {
  name: 'A coordinar por WhatsApp',
  address: 'Escribinos y arreglamos dónde te lo entregamos',
  hours: 'Todos los días, por WhatsApp',
} as const;

const businessNameSchema = z
  .string({ error: 'Poné el nombre de tu negocio.' })
  .transform((raw) => raw.trim().replace(/\s+/gu, ' '))
  .pipe(
    z
      .string()
      .min(2, 'El nombre necesita al menos 2 caracteres.')
      .max(60, 'El nombre no puede pasar de 60 caracteres.'),
  );

/**
 * El teléfono es el mismo número que después arma el `wa.me`, y el botón de WhatsApp **es** el
 * producto: si se guarda sin código de país, el link no abre ningún chat y eso no se descubre el
 * día del alta sino semanas después, cuando el dueño ya pegó el link en un estado.
 *
 * `normalizeArWaPhone()` (`_lib/wa-phone.ts`) traduce lo que la gente escribe de verdad
 * (`299 555-1234`, `0299…`) al formato que necesita `wa.me`, y delega la validación E.164 final
 * en `normalizeWaPhone()` de `@istock/domain`. Devuelve un resultado, no una excepción: el
 * mensaje de error es por campo y en castellano.
 */
const waPhoneSchema = z
  .string({ error: 'Poné el WhatsApp donde te escriben los clientes.' })
  .transform((raw, ctx) => {
    const result = normalizeArWaPhone(raw);
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: result.reason });
      return z.NEVER;
    }
    return result.value;
  });

/**
 * El TC inicial. Es un campo obligatorio del alta y no un "después lo cargás": ver el encabezado
 * del módulo. El parseo vive en `parse-fx.ts` (puro, con test propio) y el dominio tiene la
 * última palabra sobre la forma del número.
 *
 * El valor que sale de acá está en **centavos de ARS por USD** — el nombre del campo lo dice para
 * que nadie lo inserte creyendo que son pesos.
 */
const fxRateSchema = z
  .string({ error: 'Poné a cuánto tomás el dólar hoy.' })
  .transform((raw, ctx) => {
    const result = parseFxArsPerUsd(raw);
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: result.reason });
      return z.NEVER;
    }
    return result.arsCentsPerUsd;
  });

export const createTenantSchema = z.object({
  name: businessNameSchema,
  slug: slugSchema,
  waPhone: waPhoneSchema,
  fxArsCentsPerUsd: fxRateSchema,
  acceptsTradeIn: z.boolean().default(false),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export interface CreateTenantFailure {
  readonly ok: false;
  readonly field: 'slug' | 'name' | 'waPhone' | 'fxRate' | 'form';
  readonly message: string;
}

export type CreateTenantResult =
  | { readonly ok: true; readonly tenantId: string; readonly slug: string }
  | CreateTenantFailure;

/**
 * Un solo objeto para las **dos** puertas que dicen lo mismo: el chequeo previo `hasMembership()`
 * y la constraint `memberships_single_owner_per_user_key` cuando se pierde la carrera. Es una
 * constante y no dos literales iguales a propósito: si fueran dos, el día que cambie el texto va a
 * cambiar uno solo, y el resultado del alta va a depender de si ganaste una carrera de
 * milisegundos. Eso es un bug con dos caras.
 */
const ALREADY_HAS_TENANT: CreateTenantFailure = {
  ok: false,
  field: 'form',
  message: 'Ya tenés un negocio creado.',
};

/** El subdominio está tomado. Acá sí hay algo que la persona puede cambiar: el link. */
const SLUG_TAKEN: CreateTenantFailure = {
  ok: false,
  field: 'slug',
  message: 'Ese link ya lo está usando otro negocio.',
};

/**
 * ¿Está libre el slug? Corre con privilegios porque quien pregunta todavía no tiene tenant y RLS
 * le devolvería 0 filas siempre (o sea: "libre" para todos).
 *
 * No filtra nada: los slugs **son públicos por definición**, cada uno es un subdominio que
 * cualquiera puede visitar. Lo que sí importa es que el endpoint que llama a esto exija sesión,
 * para que no sea un enumerador gratis de tenants (ver `app/api/tenants/slug-check/route.ts`).
 */
export async function isSlugTaken(slug: string): Promise<boolean> {
  const rows = await withServiceDb(async (tx) =>
    tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1),
  );
  return rows.length > 0;
}

/**
 * ¿Este usuario ya tiene negocio? En Capa 1 es uno solo por persona.
 *
 * **Module-private a propósito**: su único llamador es `createTenant()`, ocho líneas más abajo.
 * Exportarla ofrecería una lectura privilegiada cross-tenant a cualquier módulo del panel, y
 * cada consumidor nuevo sería una copia de la justificación de abajo que nadie vuelve a leer.
 *
 * No lleva filtro de tenant porque no hay tenant contra el cual filtrar. `createTenant()` la
 * llama en su primera línea, cuando la persona todavía no es miembro de ningún negocio; acotarla
 * a un `tenantId` la convertiría en "¿es miembro de ESTE negocio?", que durante el alta responde
 * "no" siempre. El "un negocio por persona" de Capa 1 dejaría de existir sin que falle nada.
 *
 * Que eso no sea un agujero es la otra mitad, y hay que mostrarla: lo único que se proyecta es un
 * `id` que no sale de esta función —el retorno es un `boolean`—, el `user_id` viene de
 * `requireUser()`, o sea de la sesión y jamás del `FormData`, y no hay forma de preguntar por la
 * membresía de otra persona. No cruza el borde ningún dato de ningún tenant.
 *
 * El privilegio tampoco sobra. Las policies de `memberships` se evalúan contra
 * `app_metadata.tenant_id`, que es exactamente el claim que todavía no existe: bajo
 * `withTenantDb` esto no fallaría con un error, devolvería 0 filas y contestaría "no tiene
 * negocio" siempre. Acá menos permiso no da menos datos, da la respuesta equivocada — y la
 * equivocada habilita una escritura. Es el uso 2 de `withServiceDb` (`_lib/db/session.ts`).
 *
 * web-lint:sin-tenant pregunta existencial sobre todos los tenants, hecha antes de que exista el primero
 */
async function hasMembership(userId: string): Promise<boolean> {
  const rows = await withServiceDb(async (tx) =>
    tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, userId)).limit(1),
  );
  return rows.length > 0;
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Un `23505` no es un mensaje. Hay que preguntar QUÉ constraint murió.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Desde la migración `0005` hay **dos** `unique index` que pueden tirar `23505` dentro de la misma
 * transacción del alta, y le piden a la persona cosas opuestas:
 *
 * | constraint | qué pasó | qué tiene que hacer |
 * |---|---|---|
 * | `tenants_slug_key` | el subdominio ya existe | elegir otro link |
 * | `memberships_single_owner_per_user_key` | ya tiene un negocio | **nada**: entrar al que tiene |
 *
 * Mapear los dos al mensaje del slug —lo que hacía este módulo hasta `0005`— no es "un mensaje
 * impreciso". Le dice a alguien que cambie el nombre de su negocio cuando el problema es que ya
 * tiene uno: va a cambiar el slug, reintentar, y fallar igual con el mismo cartel. Un error que
 * manda al usuario a arreglar lo que no está roto es peor que un error genérico.
 *
 * `memberships_single_owner_per_user_key` devuelve el **mismo objeto** que el chequeo previo, que
 * es lo único que hace que ganar o perder la carrera se vea igual desde afuera.
 */
const FAILURE_BY_CONSTRAINT: Readonly<Record<string, CreateTenantFailure>> = {
  tenants_slug_key: SLUG_TAKEN,
  memberships_single_owner_per_user_key: ALREADY_HAS_TENANT,
};

/**
 * Nombre de la constraint de un `23505`, o `null` si el error es otra cosa.
 *
 * `postgres-js` expone el campo `n` del `ErrorResponse` como `constraint_name`; `node-postgres` lo
 * llama `constraint`. Se leen los dos por el mismo motivo que en `listings/create-listing.ts`: el
 * driver es un detalle de infraestructura y esta decisión no puede depender de cuál está montado.
 *
 * Un `23505` **sin** nombre de constraint devuelve `'unnamed'`, no `null`: sigue siendo una
 * violación de unicidad, sólo que anónima, y una anónima no puede heredar el mensaje de ninguna de
 * las dos que conocemos. Postgres manda ese campo desde 9.3 para toda violación de integridad, así
 * que llegar ahí ya es raro — razón de más para no adivinar.
 */
function uniqueViolationConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const pg = error as { code?: string; constraint_name?: string; constraint?: string };
  if (pg.code !== '23505') return null;
  return pg.constraint_name ?? pg.constraint ?? 'unnamed';
}

/**
 * Crea tenant + membresía `owner` + `fx_settings` + punto de retiro en **una** transacción.
 *
 * Por qué `withServiceDb` y no `withTenantDb`: el usuario todavía no tiene `app_metadata.tenant_id`,
 * así que la policy `tenants_tenant_insert` (`with check id = <claim>`) evaluaría contra `null` y
 * rechazaría la fila. Es uno de los tres usos declarados de la conexión privilegiada.
 *
 * Por qué una sola transacción: un tenant sin membresía es un negocio que nadie puede administrar
 * y un slug quemado para siempre (el `unique index` no lo suelta). Y un tenant sin `fx_settings`
 * es un negocio cuya vidriera no publica nada, con el mismo slug quemado — el fallo parcial que
 * el board registró como S3.1. Las cuatro filas o ninguna.
 */
export async function createTenant(userId: string, input: CreateTenantInput): Promise<CreateTenantResult> {
  /**
   * La constraint de `0005` es la garantía; esto es la cortesía, y sigue valiendo lo que costaba.
   *
   * No es el caso raro: es el **normal**. Quien ya tiene negocio y vuelve a `/app/crear-negocio`
   * —una pestaña vieja, el botón de atrás, un link guardado— cae acá, y no está en ninguna
   * carrera. Sin este `select`, cada una de esas visitas abriría la transacción de cuatro inserts
   * para abortarla contra el índice. La constraint atrapa los milisegundos; este chequeo atrapa
   * todo lo demás, que es casi todo.
   *
   * Lo que **no** hace, para que nadie se lo agradezca de más: no salva ningún slug. Una
   * transacción abortada no quema el valor —Postgres da de baja la entrada del índice en el
   * rollback—, así que perder la carrera contra `memberships_single_owner_per_user_key` deja el
   * slug tan libre como estaba. Lo que se ahorra es la transacción y, sobre todo, es el camino que
   * da el mensaje correcto sin depender de qué constraint gane.
   */
  if (await hasMembership(userId)) {
    return ALREADY_HAS_TENANT;
  }

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  let tenantId: string;
  try {
    tenantId = await withServiceDb(async (tx) => {
      const inserted = await tx
        .insert(tenants)
        .values({
          slug: input.slug,
          name: input.name,
          waPhone: input.waPhone,
          acceptsTradeIn: input.acceptsTradeIn,
          plan: 'trial',
          status: 'active',
          trialEndsAt,
        })
        .returning({ id: tenants.id });

      const row = inserted[0];
      if (row === undefined) throw new Error('insert de tenant sin fila devuelta');

      await tx.insert(memberships).values({
        tenantId: row.id,
        userId,
        role: 'owner',
        acceptedAt: sql`now()`,
      });

      /**
       * El TC que la persona acaba de tipear en el alta. `updated_by` es quien lo puso, y es
       * quien lo puso de verdad: no hay TC de sistema en este producto.
       */
      await tx.insert(fxSettings).values({
        tenantId: row.id,
        arsPerUsd: input.fxArsCentsPerUsd,
        rounding: DEFAULT_FX_ROUNDING,
        updatedBy: userId,
      });

      /** Un punto de retiro, activo, verdadero y editable. Ver el encabezado del módulo. */
      await tx.insert(locations).values({
        tenantId: row.id,
        name: INITIAL_PICKUP_POINT.name,
        address: INITIAL_PICKUP_POINT.address,
        hours: INITIAL_PICKUP_POINT.hours,
        isActive: true,
        sortOrder: 0,
      });

      return row.id;
    });
  } catch (error) {
    const constraint = uniqueViolationConstraint(error);
    if (constraint !== null) {
      const failure = FAILURE_BY_CONSTRAINT[constraint];
      if (failure !== undefined) return failure;

      /**
       * Una tercera constraint. **No se traga con un mensaje inventado**, y el motivo no es de
       * estilo: un error desconocido presentado como uno conocido es cómo se pierde un incidente.
       * Si esto devolviera `SLUG_TAKEN`, un bug nuevo del alta se vería en producción como gente
       * que "eligió links repetidos", que es un síntoma que nadie investiga.
       *
       * Se propaga, que es exactamente lo que este módulo ya hacía con cualquier otro error de
       * Postgres —un `23503`, un `40P01`— desde antes de `0005`. Compartir el código `23505` con
       * dos constraints que sí entendemos no es motivo para heredar su mensaje: la línea de abajo
       * es literalmente el mismo `throw` de siempre.
       *
       * Antes de propagar queda el rastro barato de investigar: el **nombre** de la constraint. El
       * `Error` crudo que sube no se loguea nunca (`log.ts`) porque el `DETAIL` de Postgres cita la
       * fila que violó la constraint, y la fila del alta lleva el WhatsApp del dueño. El nombre de
       * un índice es un identificador de DDL, no un dato de nadie.
       */
      logError('tenant.create.unknown_unique_violation', '23505', { userId, constraint });
    }
    throw error;
  }

  // El claim viaja en `app_metadata`, JAMÁS en `user_metadata` (lint 0015, ERROR). La firma de
  // `syncTenantClaim` no deja elegir destino.
  await authDriver().syncTenantClaim(userId, tenantId);

  /**
   * Regla 7 de `app-agent` y, acá, algo más grave que una regla de estilo.
   * `ARCHITECTURE.md` §"Resolución host → tenant" lo dice explícito:
   *
   *   *"Slug inexistente → **página legible con `noindex, nofollow` y status 200**, cacheada con
   *   perfil corto (**ADR-011**). […] Corolario operativo **intacto**: **el alta de un tenant
   *   tiene que invalidar el tag de su propio slug**, o la respuesta negativa queda cacheada y la
   *   vidriera nace muerta."*
   *
   * O sea: si alguien probó `minegocio.maat.work` antes de que el negocio existiera, el CDN tiene
   * guardada la página de miss. Bajo ADR-011 el corolario pesa **más**, no menos: el miss se
   * cachea igual, y encima ya no se distingue por status code en los logs de acceso. Sin esta
   * línea, el dueño carga 15 equipos, pega el link en un estado de Instagram y el link no muestra
   * su vidriera. Es el peor bug posible del producto.
   *
   * Va **después** del insert y **antes** del `return`: invalidar antes de que la fila exista
   * regenera la entrada con el mismo miss y la deja cacheada de nuevo, que es el bug con un paso
   * extra. Por qué `invalidateStorefront` y no `revalidateTag(tag, 'max')`: ver el módulo — con
   * `'max'` la respuesta negativa se sigue sirviendo un año, medido `[404, 404, 404, 404, 404]`
   * cuando el miss todavía era un 404 duro (pre-ADR-011; lo que se midió es el mecanismo del
   * cache, que no cambió).
   */
  invalidateStorefront(input.slug);

  // `fxSeeded` y `pickupPoints` son la señal operativa de S3.1: un `tenant.created` sin las dos
  // es un negocio cuya vidriera no publica nada. El valor del TC no se loguea: no hace falta.
  logEvent('tenant.created', {
    tenantId,
    userId,
    plan: 'trial',
    fxSeeded: true,
    pickupPoints: 1,
  });

  return { ok: true, tenantId, slug: input.slug };
}
