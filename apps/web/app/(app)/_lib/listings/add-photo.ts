import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { isPublicStatus } from '@istock/domain';
import { uploadListingPhoto, type UploadedListingPhoto } from '@istock/media';
import { listingPhotos, listings } from '@istock/db';
import { withTenantDb, type TenantContext } from '../db/session';
import { logError, logEvent } from '../log';
import { invalidateListing, invalidateStorefrontUnit } from '../tenants/storefront-cache';
import { loadUnitForTransition } from './queries';
import { MAX_PHOTOS_PER_LISTING } from './schema';

/**
 * Agregar **una** foto a una unidad que ya existe.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué existe este archivo: una foto por request, y el motivo es de plataforma
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `MIN_PHOTOS_TO_PUBLISH` son 3 y el body del POST no puede pasar de 4 MB (Routing Middleware de
 * Vercel; la cadena completa está en `schema.ts`, `MAX_PHOTO_BYTES`). Tres fotos de celular en un
 * submit no entran y no hay config que lo arregle. Así que el alta crea el borrador con la
 * primera y `/app/stock/{id}/fotos` agrega las otras dos, de a una.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Mismo orden que el alta: R2 primero, Postgres después
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Si falla el `insert`, quedan bytes huérfanos en R2 que `collectOrphanObjects` recoge. Al revés
 * quedaría una fila apuntando a una key que no existe: una foto rota en la vidriera, permanente y
 * sin recolector.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Sí invalida la vidriera, y NO por las mismas razones que el alta no lo hace
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `create-listing.ts` no invalida porque una unidad nace en `draft` y un borrador no existe para
 * `anon`. Acá la unidad puede estar **publicada**: agregarle una foto cambia literalmente lo que
 * ve un visitante, y `CLAUDE.md` §0.7 no admite el olvido. La condición es `isPublicStatus()` de
 * `@istock/domain`, no una lista escrita a mano: la lista escrita a mano es la que se olvida de
 * `reserved`.
 *
 * ── El `sort_order` se calcula en la misma transacción ───────────────────────────────────────
 * `listing_photos_listing_sort_key` es un índice único sobre `(listing_id, sort_order)`. Con dos
 * pestañas abiertas, dos `max(sort_order) + 1` leídos por separado dan el mismo número y el
 * segundo `insert` explota con 23505. Se reintenta: la carrera es real (el dueño manda tres fotos
 * seguidas desde el teléfono) y perder una foto por eso sería un bug que nadie sabe reproducir.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El techo de 8 fotos se chequea DOS veces, y las dos hacen falta
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * El próximo que lea esto va a querer borrar una de las dos. No se borra ninguna:
 *
 * - **La guarda temprana** (antes del upload) existe para **no gastar R2**. El caso normal es el
 *   dueño que ya tiene 8 y toca "agregar": corta antes de subir 4 objetos (3 variantes + master)
 *   que después nadie referencia y que no se pueden borrar por key (`create-listing.ts`: la key
 *   es content-addressed y dos tenants la comparten). No cierra ninguna carrera, y no pretende.
 * - **La guarda de adentro de la transacción** es la que **cierra la carrera**. Entre el `select`
 *   de arriba y el `insert` hay un upload a R2 de cientos de ms: N submits en paralelo (el botón
 *   tocado tres veces con mala señal, las dos pestañas) leen todos `photoCount = 7 < 8`, pasan
 *   todos y insertan todos con `sort_order` distinto. El único índice único es
 *   `(listing_id, sort_order)`: impide dos fotos con el **mismo** orden, no nueve con órdenes
 *   distintos — y el retry de 23505 de más abajo justamente reasigna el orden y las deja pasar.
 *
 * Para que el `count(*)` de adentro sea una decisión y no otra lectura sucia, la transacción
 * **primero toma el lock de la fila del listing** (`for update`). En READ COMMITTED, dos
 * transacciones simultáneas no se ven los `insert` no commiteados: sin el lock, las dos contarían
 * 7 y las dos insertarían. Con el lock se serializan por listing, que es la granularidad correcta
 * (dos equipos distintos no se estorban). El `update listings` del final ya tomaba ese mismo lock,
 * sólo que **después** de contar, que es donde no sirve.
 *
 * Si se aborta acá, los bytes ya subidos quedan huérfanos en R2 y **está bien**: es la política
 * declarada en `create-listing.ts` y los recoge `collectOrphanObjects`. Nunca un `DeleteObject`
 * por key (`CLAUDE.md` §2).
 *
 * ── Qué se loguea ────────────────────────────────────────────────────────────────────────────
 * Ids y contadores. Nunca el `File`, nunca el nombre del archivo (el dueño le pone
 * "iphone-de-juan-imei.jpg" más seguido de lo que uno querría), nunca la key del master.
 */

export type AddPhotoOutcome =
  | { readonly ok: true; readonly photoCount: number }
  | { readonly ok: false; readonly message: string };

const ATTEMPTS = 3;

/** Un solo texto para las dos guardas: el dueño no tiene por qué saber cuál de las dos lo frenó. */
const FULL_MESSAGE = `Ya tiene ${String(MAX_PHOTOS_PER_LISTING)} fotos, que es el máximo por equipo.`;

const MISSING_MESSAGE = 'No encontramos ese equipo.';

/**
 * Lo que decide la transacción. `full` y `gone` significan "no se insertó nada": las dos son
 * cosas que pasaron **mientras subíamos la foto**, o sea después de la guarda temprana.
 */
type InsertOutcome =
  | { readonly kind: 'inserted'; readonly photoCount: number }
  | { readonly kind: 'full' }
  | { readonly kind: 'gone' };

function isSortOrderCollision(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const pg = error as { code?: string; constraint_name?: string; constraint?: string };
  if (pg.code !== '23505') return false;
  const name = pg.constraint_name ?? pg.constraint;
  return name === undefined || name === 'listing_photos_listing_sort_key';
}

/** Código del error, nunca el mensaje: Postgres cita la fila que violó la constraint. */
function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const named = error as { code?: string; name?: string };
  return named.code ?? named.name ?? 'unknown';
}

export async function addUnitPhoto(
  ctx: TenantContext,
  tenantSlug: string,
  listingId: string,
  data: Uint8Array,
): Promise<AddPhotoOutcome> {
  /**
   * Se relee la unidad en vez de confiar en lo que se renderizó: entre el render y el submit pasa
   * tiempo y el `POST` lo arma cualquiera. `loadUnitForTransition` ya filtra por tenant (RLS +
   * `where`), así que la unidad de otro negocio vuelve `null` y de acá sale como "no existe".
   */
  const unit = await loadUnitForTransition(ctx, listingId);
  if (unit === null) return { ok: false, message: MISSING_MESSAGE };

  // Guarda barata: corta antes de gastar R2. La que cierra la carrera está adentro de la
  // transacción de más abajo; ver el bloque "El techo de 8 fotos se chequea DOS veces".
  if (unit.photoCount >= MAX_PHOTOS_PER_LISTING) {
    return { ok: false, message: FULL_MESSAGE };
  }

  let uploaded: UploadedListingPhoto;
  try {
    uploaded = await uploadListingPhoto({ tenantId: ctx.tenantId, listingId, data });
  } catch (error) {
    logError('listing.photo.upload_failed', errorCode(error), {
      tenantId: ctx.tenantId,
      listingId,
    });
    return { ok: false, message: 'No pudimos procesar esa foto. Probá de nuevo con otra.' };
  }

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const outcome = await withTenantDb(ctx, async (tx): Promise<InsertOutcome> => {
        // Serializa las cargas de foto **de este listing**. Sin esto, el `count(*)` de abajo es
        // una lectura sucia más: en READ COMMITTED no ve los `insert` de la transacción vecina.
        const locked = await tx
          .select({ id: listings.id })
          .from(listings)
          .where(and(eq(listings.tenantId, ctx.tenantId), eq(listings.id, listingId)))
          .limit(1)
          .for('update');

        if (locked[0] === undefined) return { kind: 'gone' };

        const [next] = await tx
          .select({
            sortOrder: sql<number>`coalesce(max(${listingPhotos.sortOrder}), -1) + 1`,
            total: sql<number>`count(*)`,
          })
          .from(listingPhotos)
          .where(
            and(eq(listingPhotos.tenantId, ctx.tenantId), eq(listingPhotos.listingId, listingId)),
          );

        // Acá se decide de verdad: con el lock tomado, este total es el definitivo.
        const total = Number(next?.total ?? 0);
        if (total >= MAX_PHOTOS_PER_LISTING) return { kind: 'full' };

        await tx.insert(listingPhotos).values({
          tenantId: ctx.tenantId,
          listingId,
          sortOrder: Number(next?.sortOrder ?? 0),
          masterKey: uploaded.masterKey,
          thumbKey: uploaded.thumbKey,
          cardKey: uploaded.cardKey,
          detailKey: uploaded.detailKey,
          width: uploaded.width,
          height: uploaded.height,
          cardBytes: uploaded.variants.card.bytes,
        });

        // `updated_at` del listing se mueve: la ficha cambió aunque el estado no.
        await tx
          .update(listings)
          .set({ updatedAt: sql`now()` })
          .where(and(eq(listings.tenantId, ctx.tenantId), eq(listings.id, listingId)));

        return { kind: 'inserted', photoCount: total + 1 };
      });

      if (outcome.kind === 'gone') return { ok: false, message: MISSING_MESSAGE };

      if (outcome.kind === 'full') {
        // Se perdió la carrera: los bytes ya están en R2 y ahí se quedan (`collectOrphanObjects`).
        logEvent('listing.photo.rejected_full', {
          tenantId: ctx.tenantId,
          listingId,
          photos: MAX_PHOTOS_PER_LISTING,
        });
        return { ok: false, message: FULL_MESSAGE };
      }

      const { photoCount } = outcome;

      /**
       * ══════════════════════════════════════════════════════════════════════════════════════
       *  Qué se invalida: la ficha sola, o la vidriera entera (S3.2)
       * ══════════════════════════════════════════════════════════════════════════════════════
       * La unidad publicada cambió de verdad para el visitante (`CLAUDE.md` §0.7), pero **cuánto**
       * cambió depende de si esta foto es la que se ve en la grilla:
       *
       * - `photoCount === 1` → es la primera, o sea `photos[0]`, o sea la card de la grilla pasa
       *   de placeholder a foto. Cambia la grilla: van los tres tags.
       * - `photoCount > 1`  → el `sort_order` es `max + 1`, así que **nunca** es `photos[0]` y la
       *   grilla queda idéntica. Cambia sólo la ficha: va un tag y se purga una página.
       *
       * Esa segunda rama es la que arregla el hallazgo: con 200 equipos, la 2ª foto de uno tiraba
       * abajo las 200 fichas más la grilla. `photoCount` sale del `count(*)` tomado **con el lock
       * de la fila** unas líneas más arriba, así que no es una lectura optimista.
       */
      if (isPublicStatus(unit.status)) {
        if (photoCount === 1) invalidateStorefrontUnit(tenantSlug, listingId);
        else invalidateListing(tenantSlug, listingId);
      }

      logEvent('listing.photo.added', {
        tenantId: ctx.tenantId,
        listingId,
        photos: photoCount,
        status: unit.status,
      });

      return { ok: true, photoCount };
    } catch (error) {
      if (isSortOrderCollision(error) && attempt < ATTEMPTS - 1) continue;
      throw error;
    }
  }

  logError('listing.photo.sort_order_exhausted', '23505', {
    tenantId: ctx.tenantId,
    listingId,
  });
  return { ok: false, message: 'Se cruzaron dos cargas de foto. Probá de nuevo.' };
}
