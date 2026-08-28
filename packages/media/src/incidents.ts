/**
 * Canal de **incidentes de media**: lo que se reporta cuando el camino de render decide degradar
 * en vez de tirar.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué esto existe: un `throw` en render no es un 500, es una ficha colgada
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `url.ts` validaba la key y tiraba `UnsafeMediaKeyError` al armar la URL. Bajo `cacheComponents`
 * esa excepción cae adentro de un render cacheado y el resultado **no** es un error: es un 200 que
 * nunca cierra el stream. Lo midió `qa-agent`: timeout de 300 s, con un mensaje que ni siquiera
 * hablaba de media. Un fallo que se manifiesta como "la página tarda para siempre" es peor que uno
 * que se manifiesta como una foto que falta.
 *
 * Así que el camino de render **degrada**: omite la variante y reporta acá. Degradar en silencio
 * sería cambiar un problema ruidoso por uno invisible, y por eso el reporte no es opcional: es la
 * mitad del arreglo.
 *
 * ## Qué se reporta y qué NO
 * Sale `code` + `reason` + **prefijo** de la key + variante. No sale la key entera: una key
 * inválida puede ser justamente la key de un master (`originals/{tenant}/{listing}/…`) y esa no se
 * loguea nunca (regla de log de `./errors.ts`). Tampoco sale el listing, ni el tenant, ni bytes.
 */

import type { Variant } from './types';

export type MediaIncidentCode = 'MEDIA_UNSAFE_KEY' | 'MEDIA_CONFIG';

export interface MediaIncident {
  readonly code: MediaIncidentCode;
  /** Motivo estable, apto para agrupar en Sentry. Nunca incluye la key completa. */
  readonly reason: string;
  /** Primeros caracteres de la key, truncados. `''` cuando no había key. */
  readonly keyPrefix: string;
  /** Variante afectada, o `null` si el incidente no es de una variante puntual. */
  readonly variant: Variant | null;
}

export type MediaIncidentReporter = (incident: MediaIncident) => void;

/** Cuántos caracteres de la key se dejan ver. 12 alcanzan para distinguir familias de key. */
const KEY_PREFIX_LENGTH = 12;

/** Prefijo seguro de una key para logs. Nunca devuelve la key entera. */
export function keyPrefix(key: unknown): string {
  if (typeof key !== 'string' || key.length === 0) return '';
  return key.length <= KEY_PREFIX_LENGTH ? key : `${key.slice(0, KEY_PREFIX_LENGTH)}…`;
}

const defaultReporter: MediaIncidentReporter = (incident) => {
  // `console.warn` y no `console.log`: `media-lint` M005 prohíbe `console.log` en este paquete
  // porque es el que se usa para volcar objetos enteros. Acá se emiten cuatro campos escalares.
  console.warn(
    `[media] ${incident.code} variant=${incident.variant ?? '-'} key=${incident.keyPrefix} — ${incident.reason}`,
  );
};

let reporter: MediaIncidentReporter = defaultReporter;

/**
 * Enchufa el sink de incidentes (Sentry, PostHog, un contador). `null` vuelve al default.
 * Lo llama `apps/web` en su bootstrap; el paquete no conoce a Sentry.
 */
export function setMediaIncidentReporter(next: MediaIncidentReporter | null): void {
  reporter = next ?? defaultReporter;
}

/** Vuelve al reporter por defecto. Para tests. */
export function resetMediaIncidentReporter(): void {
  reporter = defaultReporter;
}

/**
 * Emite el incidente. **Nunca tira**, ni siquiera si el reporter que enchufaron está roto: este
 * canal existe para evitar una excepción en render, sería absurdo que la causara él.
 */
export function reportMediaIncident(
  incident: MediaIncident,
  override?: MediaIncidentReporter,
): void {
  try {
    (override ?? reporter)(incident);
  } catch {
    /* un sink roto no cuelga una ficha */
  }
}
