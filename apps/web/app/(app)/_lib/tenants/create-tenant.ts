import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { memberships, tenants } from '@istock/db';
import { authDriver } from '../auth/driver';
import { withServiceDb } from '../db/session';
import { logEvent } from '../log';
import { slugSchema } from '../slug';
import { normalizeArWaPhone } from '../wa-phone';
import { invalidateStorefront } from './storefront-cache';

/** Trial de 14 días (`CLAUDE.md` §1 · `PRODUCT.md` §Planes). El trial no toca Mercado Pago. */
export const TRIAL_DAYS = 14;

/**
 * Alta del negocio. Es la única escritura del esqueleto, y toca cuatro cosas que después no se
 * pueden arreglar barato: el subdominio, el aislamiento, el trial y el cache de la vidriera.
 */

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

export const createTenantSchema = z.object({
  name: businessNameSchema,
  slug: slugSchema,
  waPhone: waPhoneSchema,
  acceptsTradeIn: z.boolean().default(false),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export type CreateTenantResult =
  | { readonly ok: true; readonly tenantId: string; readonly slug: string }
  | { readonly ok: false; readonly field: 'slug' | 'name' | 'waPhone' | 'form'; readonly message: string };

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

/** ¿Este usuario ya tiene negocio? En Capa 1 es uno solo por persona. */
export async function hasMembership(userId: string): Promise<boolean> {
  const rows = await withServiceDb(async (tx) =>
    tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, userId)).limit(1),
  );
  return rows.length > 0;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/**
 * Crea tenant + membresía `owner` en **una** transacción.
 *
 * Por qué `withServiceDb` y no `withTenantDb`: el usuario todavía no tiene `app_metadata.tenant_id`,
 * así que la policy `tenants_tenant_insert` (`with check id = <claim>`) evaluaría contra `null` y
 * rechazaría la fila. Es uno de los tres usos declarados de la conexión privilegiada.
 *
 * Por qué una sola transacción: un tenant sin membresía es un negocio que nadie puede administrar
 * y un slug quemado para siempre (el `unique index` no lo suelta).
 */
export async function createTenant(userId: string, input: CreateTenantInput): Promise<CreateTenantResult> {
  if (await hasMembership(userId)) {
    return { ok: false, field: 'form', message: 'Ya tenés un negocio creado.' };
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

      return row.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, field: 'slug', message: 'Ese link ya lo está usando otro negocio.' };
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
   *   *"Slug inexistente → 404 real y cacheable. Corolario operativo: el alta de un tenant tiene
   *   que invalidar el tag de su propio slug, o el 404 negativo queda cacheado y la vidriera
   *   nace muerta."*
   *
   * O sea: si alguien probó `minegocio.maat.work` antes de que el negocio existiera, el CDN tiene
   * un 404 guardado con `cacheLife('max')`. Sin esta línea, el dueño carga 15 equipos, pega el
   * link en un estado de Instagram y el link no anda. Es el peor bug posible del producto.
   *
   * Va **después** del insert y **antes** del `return`: invalidar antes de que la fila exista
   * regenera la entrada con el mismo 404 y la deja cacheada de nuevo, que es el bug con un paso
   * extra. Por qué `invalidateStorefront` y no `revalidateTag(tag, 'max')`: ver el módulo — con
   * `'max'` el 404 se sigue sirviendo un año, medido `[404, 404, 404, 404, 404]`.
   */
  invalidateStorefront(input.slug);

  logEvent('tenant.created', { tenantId, userId, plan: 'trial' });

  return { ok: true, tenantId, slug: input.slug };
}
