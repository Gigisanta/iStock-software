/**
 * Driver de disco. **Default mientras B1 (credenciales de R2) esté abierto.**
 *
 * Guarda un sidecar `.meta.json` por objeto con `contentType` y `cacheControl`, para que los
 * tests puedan verificar que el `Cache-Control` se setea de verdad sin necesidad de R2.
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { MediaStorageError } from '../errors';
import type { MediaBucket, ObjectHead, PutObjectInput, StorageDriver } from './driver';

export interface LocalDriverOptions {
  /** Raíz en disco. Default: `<cwd>/.media-local`. */
  readonly root?: string;
}

interface SidecarMeta {
  contentType: string;
  cacheControl: string;
  bytes: number;
}

export class LocalDiskDriver implements StorageDriver {
  readonly name = 'local';
  readonly root: string;

  constructor(options: LocalDriverOptions = {}) {
    this.root = resolve(options.root ?? join(process.cwd(), '.media-local'));
  }

  private pathFor(bucket: MediaBucket, key: string): string {
    // Sin `..`, sin absolutas: el key viene de nuestro propio generador, pero el driver no confía.
    if (key.includes('..') || key.startsWith('/') || key.includes('\0')) {
      throw new MediaStorageError('key inválida para el driver local');
    }
    const full = resolve(join(this.root, bucket, key));
    if (!full.startsWith(this.root + sep)) {
      throw new MediaStorageError('path traversal bloqueado');
    }
    return full;
  }

  async put(input: PutObjectInput): Promise<void> {
    const path = this.pathFor(input.bucket, input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body);
    const meta: SidecarMeta = {
      contentType: input.contentType,
      cacheControl: input.cacheControl,
      bytes: input.body.byteLength,
    };
    await writeFile(`${path}.meta.json`, JSON.stringify(meta), 'utf8');
  }

  async head(bucket: MediaBucket, key: string): Promise<ObjectHead | null> {
    const path = this.pathFor(bucket, key);
    try {
      const info = await stat(path);
      let meta: SidecarMeta | null = null;
      try {
        meta = JSON.parse(await readFile(`${path}.meta.json`, 'utf8')) as SidecarMeta;
      } catch {
        meta = null;
      }
      return {
        bytes: info.size,
        cacheControl: meta?.cacheControl,
        contentType: meta?.contentType,
      };
    } catch {
      return null;
    }
  }

  async get(bucket: MediaBucket, key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.pathFor(bucket, key)));
    } catch {
      return null;
    }
  }

  async delete(bucket: MediaBucket, key: string): Promise<void> {
    const path = this.pathFor(bucket, key);
    await rm(path, { force: true });
    await rm(`${path}.meta.json`, { force: true });
  }
}

export function createLocalDriver(options?: LocalDriverOptions): StorageDriver {
  return new LocalDiskDriver(options);
}
