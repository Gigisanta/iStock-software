/**
 * `@istock/media` — superficie pública.
 *
 * Lo que el resto del monorepo usa, y nada más:
 *   - `uploadListingPhoto()`   subir una foto (server-side, con resize obligatorio)
 *   - `variantUrl()`           armar la URL de una variante (no tira: degrada y reporta)
 *   - `unlinkListingPhotos()`  desvincular las fotos de un listing borrado
 *
 * Nadie fuera de este paquete conoce el bucket, la base del CDN ni el formato de las keys.
 *
 * **No se exporta ningún borrado de objeto por key.** El único camino a un `DeleteObject` es
 * `collectOrphanObjects`, que exige probar que ningún tenant referencia la key.
 */

export { uploadListingPhoto } from './upload';
export type { UploadListingPhotoInput, UploadListingPhotoDeps } from './upload';

export {
  variantUrl,
  variantUrls,
  renderableVariantUrls,
  publicUrlForKey,
  cardSrcSet,
  UNRENDERABLE_VARIANT_URL,
} from './url';
export type { UrlOptions } from './url';

export {
  setMediaIncidentReporter,
  resetMediaIncidentReporter,
  reportMediaIncident,
} from './incidents';
export type { MediaIncident, MediaIncidentCode, MediaIncidentReporter } from './incidents';

export { unlinkListingPhotos, collectOrphanObjects } from './unlink';
export type {
  ListingPhotoMappingStore,
  UnlinkListingPhotosResult,
  OrphanCollectorDeps,
  CollectOrphanObjectsResult,
} from './unlink';

export { buildVariants, OUTPUT_CONTENT_TYPE } from './pipeline';
export type { BuiltVariants, EncodedImage, SourceInfo, BuildVariantsOptions } from './pipeline';

export {
  VARIANT_SPECS,
  VARIANT_BUDGETS,
  MASTER_SPEC,
  MAX_UPLOAD_BYTES,
  MAX_INPUT_PIXELS,
  MAX_OUTPUT_EDGE,
  assertWithinBudget,
  qualityLadder,
} from './budgets';
export type { BudgetTable, EncodeSpec } from './budgets';

export {
  contentHash,
  publicVariantKey,
  masterObjectKey,
  isPublicVariantKey,
  isMasterObjectKey,
  assertPublicVariantKey,
  publicVariantKeyProblem,
  PUBLIC_KEY_VERSION,
} from './keys';

export { VARIANTS, isVariant } from './types';
export type {
  Variant,
  ListingPhotoKeys,
  ListingPhotoRow,
  UploadedListingPhoto,
  VariantMeasurement,
} from './types';

export {
  createLocalDriver,
  createR2Driver,
  createStorageDriver,
  getStorageDriver,
  resetStorageDriver,
  LocalDiskDriver,
  R2Driver,
  IMMUTABLE_CACHE_CONTROL,
  PRIVATE_CACHE_CONTROL,
} from './storage';
export type { StorageDriver, MediaBucket, PutObjectInput, ObjectHead } from './storage';

export { mediaEnv, parseMediaEnv, resetMediaEnvCache, MEDIA_DRIVERS } from './env';
export type { MediaEnv, MediaDriverName } from './env';

export {
  MediaError,
  UnsupportedImageError,
  ImageTooLargeError,
  VariantBudgetExceededError,
  UnsafeMediaKeyError,
  MediaConfigError,
  MediaStorageError,
  ForbiddenObjectDeleteError,
} from './errors';
export type { MediaErrorCode } from './errors';
