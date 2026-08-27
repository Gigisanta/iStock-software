/** Tipos públicos de `packages/media`. Sin I/O. */

/** Las tres variantes que se sirven. El master **no** es una variante: no se sirve nunca. */
export const VARIANTS = ['thumb', 'card', 'detail'] as const;
export type Variant = (typeof VARIANTS)[number];

export function isVariant(value: string): value is Variant {
  return (VARIANTS as readonly string[]).includes(value);
}

/**
 * El subconjunto de `listing_photos` (packages/db) que hace falta para armar URLs.
 * Los nombres coinciden 1:1 con las columnas del schema de Drizzle a propósito.
 *
 * `masterKey` **no** está acá: la vidriera nunca recibe la key del original.
 */
export interface ListingPhotoKeys {
  readonly thumbKey: string;
  readonly cardKey: string;
  readonly detailKey: string;
}

/** Fila completa del mapeo, sólo para uso server-side (unlink / GC). */
export interface ListingPhotoRow extends ListingPhotoKeys {
  readonly id: string;
  readonly tenantId: string;
  readonly listingId: string;
  /** SENSITIVE: bucket privado. Nunca sale del server. */
  readonly masterKey: string;
}

export interface VariantMeasurement {
  readonly key: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  /** Calidad WebP efectivamente usada tras el descenso adaptativo. */
  readonly quality: number;
}

/**
 * Resultado de `uploadListingPhoto`. El caller (DAL de `apps/web`) es el que inserta la fila
 * en `listing_photos` con `tenant_id`; `packages/media` **no** habla con Postgres.
 */
export interface UploadedListingPhoto extends ListingPhotoKeys {
  /** SENSITIVE: `istock-originals`, privado. Nunca a un DTO público. */
  readonly masterKey: string;
  readonly masterBytes: number;
  readonly width: number;
  readonly height: number;
  readonly variants: Readonly<Record<Variant, VariantMeasurement>>;
  readonly urls: Readonly<Record<Variant, string>>;
  /** Class A ops de R2 consumidas por esta foto. Valor de diseño: 4. */
  readonly classAOps: number;
}
