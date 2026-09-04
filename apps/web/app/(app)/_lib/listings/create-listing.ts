import 'server-only';
import { randomUUID, randomFillSync } from 'node:crypto';
import { sanitizeDescription } from '@istock/domain';
import { uploadListingPhoto, type UploadedListingPhoto } from '@istock/media';
import { listingEvents, listingPhotos, listings } from '@istock/db';
import { getCatalogModel } from '../catalog/queries';
import { uniqueViolationConstraint } from '../db/pg-error';
import { withTenantDb, type TenantContext } from '../db/session';
import { logError, logEvent } from '../log';
import { buildUnitTitle } from '../catalog/unit-title';
import { buildListingSlug } from './listing-slug';
import type { NewUnitInput } from './schema';

/**
 * Alta de una unidad con **una** foto. Es el camino completo `panel → @istock/media → Postgres`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Una foto, no ocho. El límite no es de diseño: es de plataforma.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * El POST del alta cae en el catch-all del `matcher` de `proxy.ts`, así que lo procesa el Routing
 * Middleware de Vercel, cuyo body está capado en **4 MB** y no varía por plan. Dos fotos de
 * celular no entran. El alta crea el borrador con la primera foto y manda a
 * `/app/stock/{id}/fotos`, donde las otras dos suben **una por request** (`add-photo.ts`).
 * Ver el cap y la cadena completa en `schema.ts` (`MAX_PHOTO_BYTES`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El orden de las operaciones NO es negociable: R2 primero, Postgres después.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Se genera el `id` del listing acá (`randomUUID()`) en vez de dejar que lo ponga el `DEFAULT` de
 * Postgres. Suena a capricho y no lo es: `masterObjectKey()` necesita `listingId` **antes** de
 * subir el master, así que o subimos primero y escribimos después, o insertamos primero y subimos
 * después. Las dos fallan distinto:
 *
 * | orden | si falla la otra mitad | se puede reparar |
 * |---|---|---|
 * | insert → upload | listing en Postgres sin fotos, invisible y sin dueño que lo note | no, es basura permanente |
 * | **upload → insert** | objetos en R2 que nadie referencia | **sí**: `collectOrphanObjects` |
 *
 * `packages/media` exporta `collectOrphanObjects` justamente para el segundo caso. Bytes huérfanos
 * son un problema de storage (USD 0.015/GB/mes) y tienen un recolector; filas huérfanas son un
 * problema de producto y no lo tienen.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Estado inicial: `draft`. Siempre.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Un equipo recién cargado **no** entra a la vidriera, así que esta función NO invalida el cache
 * del storefront: no hay nada que un visitante vea distinto. La invalidación vive en
 * `publish-listing.ts`, que es donde el equipo efectivamente entra o sale de la vidriera, y se
 * decide con `transitionEffects()` de `@istock/domain` en vez de a ojo.
 */

export interface CreateUnitResult {
  readonly ok: true;
  readonly listingId: string;
  readonly slug: string;
  readonly photoCount: number;
}

export interface CreateUnitFailure {
  readonly ok: false;
  readonly field: 'title' | 'catalogModelId' | 'storageGb' | 'color' | 'imei' | 'photo' | 'form';
  readonly message: string;
}

/**
 * ¿Es un `23505`, y —si se pide— de **esta** constraint?
 *
 * Delegaba en una lectura propia de `error.code` hasta el 2026-08-28, y por eso no delegaba en
 * nada: Drizzle envuelve el error del driver y `code` arriba es `undefined`, así que las tres
 * ramas de abajo eran código muerto y una colisión de slug o un IMEI repetido salían como 500.
 * La cadena la camina `uniqueViolationConstraint` (`_lib/db/pg-error.ts`), que es el único lugar
 * del panel donde se lee un error de Postgres y el único que tiene un test contra Postgres real.
 * Tercera copia de ese discriminador, y la que su propio docblock avisaba que se iba a olvidar.
 *
 * `'unnamed'` —un `23505` sin nombre— **no** matchea contra una constraint pedida: falla cerrado,
 * igual que antes. Sin `constraint`, cualquier `23505` cuenta; es la rama genérica de más abajo.
 */
function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const name = uniqueViolationConstraint(error);
  if (name === null) return false;
  return constraint === undefined || name === constraint;
}

function newSlug(title: string): string {
  return buildListingSlug(title, randomFillSync(new Uint8Array(8)));
}

export async function createUnit(
  ctx: TenantContext,
  input: NewUnitInput,
  photo: Uint8Array,
): Promise<CreateUnitResult | CreateUnitFailure> {
  const catalogModel = await getCatalogModel(ctx, input.catalogModelId);
  if (catalogModel === null) {
    return {
      ok: false,
      field: 'catalogModelId',
      message: 'Elegí un modelo disponible de la lista.',
    };
  }
  if (input.storageGb === null || !catalogModel.storageOptionsGb.includes(input.storageGb)) {
    return {
      ok: false,
      field: 'storageGb',
      message: 'Elegí una capacidad disponible para ese modelo.',
    };
  }
  if (input.color === null || !catalogModel.colors.includes(input.color)) {
    return {
      ok: false,
      field: 'color',
      message: 'Elegí un color disponible para ese modelo.',
    };
  }

  const listingId = randomUUID();
  // El título se deriva del catálogo en el server: el campo visible es una ayuda, no una fuente
  // confiable. Así un POST manual no puede guardar un modelo distinto del que eligió.
  const title = buildUnitTitle(catalogModel.displayName, input.storageGb, input.color);

  let uploaded: UploadedListingPhoto;
  try {
    uploaded = await uploadListingPhoto({ tenantId: ctx.tenantId, listingId, data: photo });
  } catch (error) {
    // El mensaje crudo de `packages/media` puede citar bytes y formatos; no cita datos del equipo,
    // pero igual se loguea el código y no el objeto (`CLAUDE.md` §2).
    logError('listing.photos.upload_failed', errorCode(error), {
      tenantId: ctx.tenantId,
      listingId,
      photos: 1,
    });
    return {
      ok: false,
      field: 'photo',
      message: 'No pudimos procesar esa foto. Probá de nuevo con otra.',
    };
  }

  /**
   * `cost_usd` sólo se escribe si quien carga es `owner`. El `seller` no lo ve **ni en el
   * payload** (`CLAUDE.md` §0.9) y tampoco lo escribe: el filtro está acá, en el server, no en
   * un `disabled` del formulario que cualquiera saca con el inspector.
   */
  const costUsd = ctx.role === 'owner' ? input.costUsd : null;
  const description = input.description === null ? null : sanitizeDescription(input.description);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = newSlug(title);
    try {
      await withTenantDb(ctx, async (tx) => {
        await tx.insert(listings).values({
          id: listingId,
          tenantId: ctx.tenantId,
          slug,
          kind: 'unit',
          title,
          // Sin esto la unidad nace impublicable: `checkPublishable` deniega
          // `missing_catalog_model` para todo `kind: 'unit'`. Ver `schema.ts`.
          catalogModelId: input.catalogModelId,
          storageGb: input.storageGb,
          color: input.color,
          condition: input.condition,
          batteryPct: input.batteryPct,
          imei: input.imei,
          description,
          priceUsd: input.priceUsd,
          costUsd,
          qty: 1,
          status: 'draft',
          createdBy: ctx.userId,
        });

        // `sortOrder: 0` — es la primera y la que se ve en la grilla. Las que se agreguen después
        // por `/app/stock/{id}/fotos` van a `max(sort_order) + 1`.
        await tx.insert(listingPhotos).values({
          tenantId: ctx.tenantId,
          listingId,
          sortOrder: 0,
          masterKey: uploaded.masterKey,
          thumbKey: uploaded.thumbKey,
          cardKey: uploaded.cardKey,
          detailKey: uploaded.detailKey,
          width: uploaded.width,
          height: uploaded.height,
          cardBytes: uploaded.variants.card.bytes,
        });

        // Bitácora. `metadata` NUNCA lleva IMEI, costo ni notas internas (`events.ts`).
        await tx.insert(listingEvents).values({
          tenantId: ctx.tenantId,
          listingId,
          kind: 'created',
          toStatus: 'draft',
          actorUserId: ctx.userId,
          metadata: { photos: 1, kind: 'unit' },
        });
      });

      logEvent('listing.created', {
        tenantId: ctx.tenantId,
        listingId,
        photos: 1,
        status: 'draft',
      });

      return { ok: true, listingId, slug, photoCount: 1 };
    } catch (error) {
      // El slug lleva un sufijo aleatorio: una colisión es rarísima y se resuelve reintentando.
      if (isUniqueViolation(error, 'listings_tenant_slug_key')) continue;

      if (isUniqueViolation(error, 'listings_tenant_imei_key')) {
        return { ok: false, field: 'imei', message: 'Ya tenés cargado un equipo con ese IMEI.' };
      }
      if (isUniqueViolation(error)) {
        return { ok: false, field: 'form', message: 'Ese equipo ya estaba cargado.' };
      }
      throw error;
    }
  }

  logError('listing.create.slug_exhausted', '23505', { tenantId: ctx.tenantId, listingId });
  return { ok: false, field: 'title', message: 'No pudimos generar un link para ese nombre. Cambialo un poco.' };
}

/** Código del error, nunca el mensaje: Postgres cita la fila que violó la constraint. */
function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const named = error as { code?: string; name?: string };
  return named.code ?? named.name ?? 'unknown';
}
