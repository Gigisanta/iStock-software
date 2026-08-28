/**
 * Cache de 60 s del system y del bloque de ficha (`docs/CHATBOT.md` §Dieta).
 *
 * ## Qué ahorra y qué NO ahorra
 * Ahorra **armado**: sanitizar la descripción del dueño, recortar por tokens y renderizar 16 líneas
 * en cada mensaje de una conversación de 6 turnos. **No ahorra tokens**: el prompt se paga entero
 * en cada turno igual, porque el context caching de los proveedores no nos aplica a esta dieta
 * (`docs/research/llm-pricing.md` §1). Confundir las dos cosas lleva a inflar el prompt "total está
 * cacheado", que es falso y sale plata.
 *
 * ## Es un cache por instancia, y eso está asumido
 * En Vercel cada instancia de función tiene el suyo y se pierde en el frío. No hay invalidación por
 * evento: el TTL de 60 s **es** la política de consistencia. Si el dueño cambia el precio, el chat
 * puede ir hasta un minuto atrasado; la ficha HTML no, porque esa sí se invalida por tag. La
 * asimetría es deliberada y barata: 60 s.
 *
 * Nada de esto vive en `proxy.ts`, donde un `Map` de módulo no es un cache (ADR-007).
 */

export interface TtlCacheOptions {
  readonly ttlMs?: number;
  /** Reloj inyectable. `Date.now` por default; los tests pasan el suyo. */
  readonly now?: () => number;
  /** Techo de entradas. Se descarta la más vieja por inserción. */
  readonly maxEntries?: number;
}

export interface TtlCache<V> {
  /** Devuelve el valor cacheado o lo construye. `build` no se llama si hay hit vigente. */
  get(key: string, build: () => V): V;
  /** Cantidad de entradas vivas, para tests y métricas. */
  readonly size: number;
  clear(): void;
}

interface Entry<V> {
  readonly value: V;
  readonly expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 200;

export function createTtlCache<V>(options?: TtlCacheOptions): TtlCache<V> {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const now = options?.now ?? Date.now;
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const entries = new Map<string, Entry<V>>();

  return {
    get(key, build) {
      const at = now();
      const hit = entries.get(key);
      if (hit !== undefined && hit.expiresAt > at) return hit.value;
      const value = build();
      entries.delete(key);
      entries.set(key, { value, expiresAt: at + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
      return value;
    },
    get size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
  };
}
