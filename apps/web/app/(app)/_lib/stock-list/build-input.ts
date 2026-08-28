/**
 * De filas de Postgres al `StockListInput` de `@istock/domain` — mitad de panel de S9.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué este archivo es puro y vive fuera de la página
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `buildStockList` es determinista y sin I/O, pero **el mapeo es donde se pierde plata**: el
 * `nameSource` mal puesto duplica `256 Grafito`, el ARS mal calculado publica el catálogo entero
 * a otro precio, y una URL relativa deja un renglón de stock sin manera de llegar a la ficha.
 * Nada de eso se puede probar desde `page.tsx` (importa `server-only`, la sesión y Drizzle), así
 * que el mapeo vive acá, sin un solo import de servidor, y tiene su `build-input.test.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Dos imports que cruzan a `(storefront)`, y por qué se importa en vez de copiar
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. **`listingPath`** — `LISTING_PATH_PREFIX = '/p'` es propio de `apps/web` (una ruta no es una
 *    validación, por eso no está en `@istock/domain`) y ya vive declarado una vez. Copiar el `'/p'`
 *    acá sería una segunda fuente de verdad de la misma cadena: el día que el prefijo cambie, la
 *    vidriera se muda y todos los links pegados en estados de Instagram quedan muertos **sin que
 *    nada se ponga rojo**, porque el 404 lo ve el comprador, no nosotros.
 * 2. **`resolveModelName`** — es la decisión de si el nombre salió del catálogo o del título del
 *    dueño. `stock-list.ts` dice, con todas las letras, que *"la lista y la ficha no pueden
 *    discrepar"*, y este mapeo es exactamente donde discreparían: una copia local que se olvide
 *    del caso `display_name` en blanco vuelve a imprimir el `iPhone 14 Pro 256 Grafito 256
 *    Grafito` que midió W5 de `accept-s4.sh`, esta vez en un estado que ven cien personas.
 *
 * Los dos son módulos puros (`routes.ts` no importa nada; `model-name.ts` importa un tipo) y el
 * import cruzado ya es práctica del repo: `_lib/tenants/storefront-cache.ts` importa
 * `(storefront)/_lib/cache-tags` desde 2026-08. No hay medición que lo desaconseje: el único
 * riesgo real sería arrastrar `server-only` o `next/cache` al bundle de un test, y ninguno de los
 * dos lo hace.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Campos prohibidos
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `StockListUnit` no tiene `imei`, `costUsdCents`, `margin` ni `internalNotes`, así que no hay
 * nada que filtrar acá. La otra mitad la pone la query (`./queries.ts`), que **no los selecciona**:
 * lo que no se pide no está en el payload RSC ni en un `JSON.stringify` de mañana.
 */

import {
  applyFx,
  fxRateFromArsCents,
  isPublicStatus,
  type Condition,
  type FxRate,
  type FxRoundingMode,
  type ListingStatus,
  type StockListInput,
  type StockListUnit,
} from '@istock/domain';
import { resolveModelName } from '../../../(storefront)/_lib/model-name';
import { listingPath } from '../../../(storefront)/_lib/routes';

/**
 * Lo poco que la lista necesita de un listing. Es **exactamente** el `select` de `./queries.ts`
 * y no una fila entera: el tipo más chico posible es la defensa que no se olvida.
 */
export interface StockListRow {
  /** Slug de la **ficha**, no del tenant. Es el último segmento del link. */
  readonly slug: string;
  /** Texto libre del dueño. Fallback del nombre; nunca es nombre de catálogo. */
  readonly title: string;
  /** `catalog_models.display_name`, `null` cuando la fila no tiene modelo (accesorios, lotes). */
  readonly modelDisplayName: string | null;
  readonly storageGb: number | null;
  readonly color: string | null;
  readonly condition: Condition;
  readonly priceUsdCents: number;
  readonly status: ListingStatus;
}

/** El TC guardado del tenant, tal como sale de `fx_settings`. */
export interface StockListFxSettings {
  readonly arsCentsPerUsd: number;
  readonly rounding: FxRoundingMode;
}

/** El TC ya validado por el dominio. Existir es la garantía de que `applyFx` no va a tirar por él. */
export interface ResolvedFx {
  readonly rate: FxRate;
  readonly rounding: FxRoundingMode;
}

/**
 * `fx_settings` → TC usable, o `null`.
 *
 * `null` significa **"la lista sale sólo en dólares"**, y son dos causas distintas que la pantalla
 * junta a propósito: el tenant no tiene fila de TC, o el número guardado no es aplicable (un cero
 * que se coló). En las dos, publicar pesos calculados con un TC inventado por nosotros sería peor
 * que no publicarlos: **el ARS lo dice el dueño y si no lo dijo, no lo decimos por él** (mismo
 * criterio que `fxContext` en la vidriera y que `freezeFx` en la venta).
 *
 * Lo que **nunca** hace es sacar un equipo de la lista: sin TC, el renglón sale igual con su USD.
 */
export function resolveFx(settings: StockListFxSettings | null): ResolvedFx | null {
  if (settings === null) return null;
  try {
    return { rate: fxRateFromArsCents(settings.arsCentsPerUsd), rounding: settings.rounding };
  } catch {
    // El `Error` del dominio cita el input crudo. No se propaga ni se loguea desde un módulo puro:
    // quien lo llama decide (la página lo cuenta en pantalla, sin números).
    return null;
  }
}

/**
 * `https://nortecel.maat.work` + `iphone-14-pro-256-grafito` → la URL **absoluta** de la ficha.
 *
 * Absoluta porque `buildStockListEntry` la exige absoluta, y la exige por un motivo que no es de
 * validación: un `/p/algo` pegado en un estado de Instagram no es un link, es texto. La base la
 * arma `storefrontUrlForSlug()` (`_lib/env.ts`), que en desarrollo apunta a `localhost` y en
 * producción a `{slug}.maat.work` — por eso entra por parámetro y no se hardcodea el dominio.
 *
 * El `/+$` no es paranoia decorativa: `${base}${listingPath(slug)}` con una base terminada en `/`
 * produce `//p/...`, que resuelve a **otro host** para el navegador.
 */
export function listingUrl(storefrontBaseUrl: string, listingSlug: string): string {
  return `${storefrontBaseUrl.replace(/\/+$/u, '')}${listingPath(listingSlug)}`;
}

/**
 * ARS de un renglón, o `null`.
 *
 * `applyFx` sólo puede tirar acá con un precio negativo o astronómico, o sea con una fila rota.
 * En ese caso el renglón sale **sin pesos** en vez de no salir: perder el ARS de un equipo es un
 * dato menos; perder el equipo es un equipo que el dueño creyó haber publicado y nadie vio.
 */
function arsFor(priceUsdCents: number, fx: ResolvedFx | null): number | null {
  if (fx === null) return null;
  try {
    return applyFx(priceUsdCents, fx.rate, fx.rounding);
  } catch {
    return null;
  }
}

/**
 * Fila → unidad de la lista.
 *
 * **Tira si el estado no es público**, y eso es lo contrario de descartar en silencio. La query
 * ya filtra por `PUBLIC_STATUSES`, así que llegar acá con un `draft` significa que el `where` se
 * rompió: publicar el resto y omitir ese equipo dejaría al dueño con una lista que parece
 * completa. Es un estado imposible y se trata como tal — ruidoso, no silencioso.
 */
export function toStockListUnit(
  row: StockListRow,
  storefrontBaseUrl: string,
  fx: ResolvedFx | null,
): StockListUnit {
  if (!isPublicStatus(row.status)) {
    throw new Error(
      `la lista para estados recibió el equipo "${row.slug}" en estado "${row.status}", que no es ` +
        'público. La query filtra por PUBLIC_STATUSES: si esto pasó, el filtro está roto.',
    );
  }

  return {
    // `nameSource` y `modelDisplayName` salen de la MISMA decisión y en el mismo objeto: un
    // `nameSource: 'catalog'` escrito a mano al lado de un `?? title` compila y miente.
    ...resolveModelName(row),
    storageGb: row.storageGb,
    color: row.color,
    condition: row.condition,
    priceUsdCents: row.priceUsdCents,
    priceArsCents: arsFor(row.priceUsdCents, fx),
    status: row.status,
    url: listingUrl(storefrontBaseUrl, row.slug),
  };
}

export interface BuildStockListInputArgs {
  /** Nombre comercial del tenant. Va en el encabezado de cada bloque. */
  readonly businessName: string;
  /** Slug del tenant. El dominio arma el host del encabezado con él. */
  readonly slug: string;
  /** `https://{slug}.maat.work` en producción; `http://{slug}.localhost:3000` en desarrollo. */
  readonly storefrontBaseUrl: string;
  readonly rows: readonly StockListRow[];
  readonly fx: ResolvedFx | null;
  /**
   * Marca de frescura del encabezado. Se inyecta porque `@istock/domain` tiene `Date.now()`
   * prohibido, y **una sola** para toda la lista: dos bloques fechados distinto es un bug visible.
   */
  readonly now?: Date;
  readonly maxBlockChars?: number;
}

/**
 * El input completo de `buildStockList`. Mapea **todas** las filas, en el orden en que llegan.
 *
 * No filtra, no ordena y no deduplica: el orden lo eligió la query (disponibles primero) y
 * `buildStockList` lo preserva a propósito. Cualquier `filter` acá sería un equipo que el dueño
 * cargó, publicó y no aparece en el texto que pega — el peor fallo de esta pantalla.
 */
export function buildStockListInput(args: BuildStockListInputArgs): StockListInput {
  return {
    businessName: args.businessName,
    slug: args.slug,
    units: args.rows.map((row) => toStockListUnit(row, args.storefrontBaseUrl, args.fx)),
    ...(args.now === undefined ? {} : { now: args.now }),
    ...(args.maxBlockChars === undefined ? {} : { maxBlockChars: args.maxBlockChars }),
  };
}
