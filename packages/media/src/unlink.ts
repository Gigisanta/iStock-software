/**
 * `unlinkListingPhotos` — se llama **unlink** y no **delete** por una razón concreta.
 *
 * La key pública es content-addressed: `v1/{ab}/{sha256_32}.webp` es el hash del byte de salida.
 * Dos tenants que suben la MISMA foto (la promo de un mayorista, un render de fábrica, la misma
 * caja sobre el mismo escritorio) producen la MISMA key y **comparten el objeto**.
 *
 * Por lo tanto: **borrar un listing nunca borra el objeto de R2.** Se borra la fila del mapeo.
 * Borrar por key es un borrado cruzado entre tenants — el tenant B se queda sin fotos porque el
 * tenant A borró un listing. `CLAUDE.md` §2 lo marca como causal de rechazo automático.
 *
 * El byte se recolecta después, en un job aparte (`collectOrphanObjects`), y sólo con prueba de
 * que **ningún** tenant lo referencia. Ese conteo se hace sin RLS (service role) porque justamente
 * necesita ver todos los tenants; por eso vive en un job, no en el request del dueño.
 */

import { z } from 'zod';
import { ForbiddenObjectDeleteError, MediaConfigError } from './errors';
import { isMasterObjectKey, isPublicVariantKey } from './keys';
import type { ListingPhotoRow } from './types';
import type { MediaBucket, StorageDriver } from './storage';

/**
 * Puerto hacia el mapeo `listing_photos` (Postgres, `tenant_id` + RLS).
 * Lo implementa el DAL de `apps/web`; `packages/media` no habla con la DB.
 */
export interface ListingPhotoMappingStore {
  listByListing(tenantId: string, listingId: string): Promise<readonly ListingPhotoRow[]>;
  /** Borra las filas del mapeo del listing. Devuelve cuántas borró. */
  deleteByListing(tenantId: string, listingId: string): Promise<number>;
}

export interface UnlinkListingPhotosResult {
  readonly unlinkedRows: number;
  /** Keys que este listing dejó de referenciar. Candidatas a GC, **no** borradas. */
  readonly releasedKeys: readonly string[];
  /** Siempre 0. Está en el tipo para que sea imposible leer mal el contrato. */
  readonly deletedObjects: 0;
}

const inputSchema = z.object({ tenantId: z.uuid(), listingId: z.uuid() });

export async function unlinkListingPhotos(
  input: { tenantId: string; listingId: string },
  deps: { store: ListingPhotoMappingStore },
): Promise<UnlinkListingPhotosResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new MediaConfigError('unlinkListingPhotos: tenantId y listingId deben ser UUID');
  }
  const { tenantId, listingId } = parsed.data;

  const rows = await deps.store.listByListing(tenantId, listingId);
  const releasedKeys: string[] = [];
  for (const row of rows) {
    releasedKeys.push(row.thumbKey, row.cardKey, row.detailKey, row.masterKey);
  }

  const unlinkedRows = await deps.store.deleteByListing(tenantId, listingId);

  return {
    unlinkedRows,
    releasedKeys: Object.freeze([...new Set(releasedKeys)]),
    deletedObjects: 0,
  };
}

// ---------------------------------------------------------------------------
// GC — el único camino a un DeleteObject, y pide pruebas.
// ---------------------------------------------------------------------------

export interface OrphanCollectorDeps {
  readonly driver: StorageDriver;
  /**
   * Cuenta referencias a la key en `listing_photos` **cruzando todos los tenants**
   * (service role, sin RLS). Si devuelve > 0, la key no se toca.
   */
  countReferencesAcrossAllTenants(key: string): Promise<number>;
}

export interface CollectOrphanObjectsResult {
  readonly deleted: readonly string[];
  readonly kept: readonly string[];
}

/**
 * Job de recolección. **No se llama desde el request de borrado de un listing.**
 * Sólo borra una key si el conteo global de referencias da exactamente 0.
 */
export async function collectOrphanObjects(
  input: { candidateKeys: readonly string[]; dryRun?: boolean },
  deps: OrphanCollectorDeps,
): Promise<CollectOrphanObjectsResult> {
  const deleted: string[] = [];
  const kept: string[] = [];

  for (const key of input.candidateKeys) {
    const bucket = bucketForKey(key);
    const refs = await deps.countReferencesAcrossAllTenants(key);
    if (!Number.isInteger(refs) || refs < 0) {
      throw new ForbiddenObjectDeleteError(key, 'el conteo de referencias no es un entero ≥ 0');
    }
    if (refs > 0) {
      kept.push(key);
      continue;
    }
    if (input.dryRun === true) {
      kept.push(key);
      continue;
    }
    await deps.driver.delete(bucket, key);
    deleted.push(key);
  }

  return { deleted: Object.freeze(deleted), kept: Object.freeze(kept) };
}

function bucketForKey(key: string): MediaBucket {
  if (isPublicVariantKey(key)) return 'media';
  if (isMasterObjectKey(key)) return 'originals';
  throw new ForbiddenObjectDeleteError(key, 'no es una key conocida de iStock');
}
