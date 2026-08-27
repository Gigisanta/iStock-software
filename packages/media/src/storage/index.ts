/** Selección de driver. `MEDIA_DRIVER=local` es el default mientras B1 esté abierto. */

import { mediaEnv, type MediaEnv } from '../env';
import { createLocalDriver } from './local';
import { createR2Driver } from './r2';
import type { StorageDriver } from './driver';

export type { MediaBucket, ObjectHead, PutObjectInput, StorageDriver } from './driver';
export { IMMUTABLE_CACHE_CONTROL, PRIVATE_CACHE_CONTROL } from './driver';
export { LocalDiskDriver, createLocalDriver } from './local';
export { R2Driver, createR2Driver } from './r2';

let cached: StorageDriver | null = null;

export function createStorageDriver(env: MediaEnv): StorageDriver {
  if (env.MEDIA_DRIVER === 'r2') return createR2Driver(env);
  return createLocalDriver(env.MEDIA_LOCAL_ROOT ? { root: env.MEDIA_LOCAL_ROOT } : {});
}

/** Driver del proceso, memoizado. */
export function getStorageDriver(): StorageDriver {
  cached ??= createStorageDriver(mediaEnv());
  return cached;
}

/** Sólo para tests. */
export function resetStorageDriver(): void {
  cached = null;
}
