/**
 * Botón de WhatsApp — skill `wa-payload`.
 *
 * "El botón de WhatsApp **es el producto**. Un texto mal armado rompe el único momento que factura."
 *
 * Texto canónico (`CLAUDE.md` §1):
 * ```
 * Hola, vi el iPhone 14 Pro 256 Grafito (usado A) a USD 620 en nortecel.maat.work y lo quiero.
 * ```
 * Plantilla:
 * ```
 * Hola, vi el {modelo} {storage} {color} ({condición}) a USD {precio} en {slug}.maat.work y lo quiero.
 * ```
 *
 * Reglas que se cumplen acá y en ningún otro lado:
 * - **Un solo** `wa.me` por ficha. Nadie arma este texto a mano en un componente.
 * - Prohibido en el texto: IMEI, costo, margen, notas internas, proveedor. El input de esta función
 *   **no tiene** esos campos: la prohibición es de tipos, no de disciplina.
 * - El precio se formatea con `formatUsd`, la misma función que usa la pantalla. Discrepancia = bug.
 * - `reserved` cambia el copy: nunca prometemos disponibilidad que el DTO no respalda. Lo que sí
 *   hace es **declarar la compra en presente** — ver `buildWaMessage`.
 */

import { DomainError } from './errors';
import { formatUsd } from './money';
import { assertSlug } from './slug';
import { isBlank } from './text';
import { waConditionLabel, type Condition, type PublicStatus } from './types';

export const STOREFRONT_DOMAIN = 'maat.work';

/**
 * De dónde salió `modelDisplayName`. **Obligatorio y sin default, a propósito.**
 *
 * `modelDisplayName` significaba dos cosas según quién lo llenara y por eso el bug era invisible:
 * el `display_name` limpio del `catalog_model` (`iPhone 14 Pro`), o —cuando `catalog_model_id` es
 * `null`, que es un camino de producción: el dueño carga sin elegir modelo, o se borra el modelo y
 * el `on delete set null` tira a todos sus listings al fallback— el `title` de texto libre del
 * dueño, que en la práctica **ya trae storage y color adentro** (`iPhone 14 Pro 256 Grafito`).
 * Appendearlos de nuevo produjo, medido en producción por W5 de `accept-s4.sh`:
 * `Hola, vi el iPhone 14 Pro 256 Grafito 256 Grafito (usado A) ...`.
 *
 * Un campo opcional con default sería el mismo bug con más pasos: el mapeo se lo puede volver a
 * olvidar y el compilador no diría nada. Este es requerido: olvidarlo **no compila**.
 */
export const NAME_SOURCES = ['catalog', 'free_text'] as const;
export type NameSource = (typeof NAME_SOURCES)[number];

/** Lo mínimo (y lo único) que el mensaje puede conocer del listing. */
export interface WaListing {
  /** Procedencia de `modelDisplayName`. Sin default: es una decisión del mapeo, no de esta función. */
  readonly nameSource: NameSource;
  /**
   * `iPhone 14 Pro` si `nameSource === 'catalog'` (nombre limpio del `catalog_model`).
   * `iPhone 14 Pro 256 Grafito` si `nameSource === 'free_text'` (título del dueño, tal cual lo
   * escribió, con lo que sea que haya metido adentro).
   */
  readonly modelDisplayName: string;
  /** `256`. `null` en lotes/accesorios sin almacenamiento. */
  readonly storageGb: number | null;
  /** `Grafito`. `null` si no aplica. */
  readonly color: string | null;
  readonly condition: Condition;
  readonly priceUsdCents: number;
  readonly status: PublicStatus;
}

/** `nortecel` → `nortecel.maat.work`. */
export function storefrontHost(slug: string): string {
  assertSlug(slug);
  return `${slug}.${STOREFRONT_DOMAIN}`;
}

export function storefrontUrl(slug: string): string {
  return `https://${storefrontHost(slug)}`;
}

/**
 * Plegado para **comparar**, nunca para mostrar: minúsculas, sin acentos.
 * `Púrpura` → `purpura`, `GRAFITO` → `grafito`.
 */
function foldForMatch(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Tokens alfanuméricos del nombre plegado. Separa por cualquier cosa que no sea letra o dígito,
 * así `iPhone 14 Pro - 256 GB / Grafito` y `iPhone 14 Pro 256 Grafito` tokenizan igual.
 *
 * Tokenizar (y no hacer `includes` de substring) es lo que hace que `Moto G64` **no** cuente como
 * "tiene 64 GB": `g64` es un token solo, no el número suelto.
 */
function tokenize(text: string): readonly string[] {
  return foldForMatch(text)
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0);
}

/** `gb`/`g` → 1 · `tb`/`t` → 1024 · cualquier otra cosa → `null`. */
function storageUnitFactor(token: string | undefined): number | null {
  switch (token) {
    case 'g':
    case 'gb':
      return 1;
    case 't':
    case 'tb':
      return 1024;
    default:
      return null;
  }
}

/**
 * ¿El nombre ya dice el almacenamiento? Cuenta `256`, `256GB`, `256 gb`, y `1TB` / `1 TB` para
 * 1024 GB, que es como el dueño lo escribe cuando lo escribe.
 */
function nameHasStorage(name: string, storageGb: number): boolean {
  const tokens = tokenize(name);
  return tokens.some((token, index) => {
    const match = /^(\d+)(g|gb|t|tb)?$/u.exec(token);
    if (match === null) return false;
    const amount = Number(match[1]);
    const factor = storageUnitFactor(match[2]) ?? storageUnitFactor(tokens[index + 1]) ?? 1;
    return amount * factor === storageGb;
  });
}

/** ¿`needle` aparece como secuencia **contigua** de tokens dentro de `haystack`? */
function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return true;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) return true;
  }
  return false;
}

/**
 * ¿El nombre ya dice el color? `Azul Sierra` cuenta sólo si están las dos palabras y seguidas:
 * un título que dice `Azul` no es un `Azul Sierra`, y el reseller distingue.
 */
function nameHasColor(name: string, color: string): boolean {
  return containsSequence(tokenize(name), tokenize(color));
}

/**
 * ¿Se appendean storage y color sin mirar el nombre?
 * `catalog` sí: el nombre viene limpio del catálogo y nunca los trae.
 * `free_text` no: hay que fijarse antes, porque el dueño ya los pudo haber escrito.
 */
function appendsUnconditionally(source: NameSource): boolean {
  switch (source) {
    case 'catalog':
      return true;
    case 'free_text':
      return false;
    default: {
      const never: never = source;
      throw new DomainError(
        'LISTING_INVALID',
        `procedencia del nombre desconocida: ${String(never)} (esperaba "catalog" o "free_text")`,
      );
    }
  }
}

/**
 * Lo que hace falta para armar el **nombre** de un equipo, y nada más.
 *
 * Existe como tipo propio porque el nombre se arma en dos lugares con dos registros de condición
 * distintos —el mensaje de WhatsApp (`usado A`) y la lista para estados (`usado excelente`,
 * ver `stock-list.ts`)— y la parte que **no** cambia entre los dos es exactamente ésta. Es un
 * `Pick` de `WaListing` y no un tipo nuevo para que no puedan divergir.
 */
export type ListingNameParts = Pick<WaListing, 'nameSource' | 'modelDisplayName' | 'storageGb' | 'color'>;

/**
 * `iPhone 14 Pro 256 Grafito` — el nombre **sin** la condición. Sin campos sensibles, por
 * construcción: el tipo no los tiene.
 *
 * Con `nameSource: 'free_text'` cada atributo se appendea **sólo si no está ya en el nombre**,
 * comparando normalizado (minúsculas, sin acentos, por tokens). No alcanza con no appendear nunca:
 * un título pelado `iPhone 14 Pro` dejaría el mensaje ambiguo para el reseller que tiene tres, y
 * el mensaje no lleva la URL de la ficha, sólo el host.
 *
 * **Un solo lugar donde se resuelve el `256 Grafito 256 Grafito`.** Lo llaman `describeListing`
 * (WhatsApp) y `buildStockListEntry` (lista para estados). Un segundo implementador de esta regla
 * es un segundo lugar donde el bug de W5 puede volver.
 */
export function describeListingName(listing: ListingNameParts): string {
  // ── El agujero donde va el producto ──────────────────────────────────────────────────────────
  // `modelDisplayName` sale, por los dos caminos, de una columna `text not null` **sin CHECK**
  // (`catalog_models.display_name` o `listings.title`): `''` y `'   '` son valores representables
  // en la base. La vidriera ya cae de un `display_name` en blanco al `title`, pero si los dos están
  // en blanco el fallback no tiene a dónde caer y el mensaje sale así:
  //   `Hola, vi el  256 Grafito (usado A) a USD 620 en nortecel.maat.work y lo quiero.`
  // Un mensaje con un hueco donde va el equipo, mandado al WhatsApp de un cliente real. El botón
  // de WhatsApp **es** el producto (`CLAUDE.md` §1, gate de aceptación no negociable): un texto sin
  // el equipo adentro no es un texto degradado, es un texto roto, y se prefiere no emitir nada.
  //
  // El chequeo vive acá y no sólo en `publicListingDTO` porque `describeListing`, `buildWaMessage`,
  // `buildWaUrl` y `buildStockList` son **exports públicos de `@istock/domain`**: cualquier caller
  // puede construir un `WaListing` a mano sin pasar por el DTO, y el tipo no se lo impide
  // (`modelDisplayName` es `string`, y `''` es un `string`). Los cuatro pasan por esta función, así
  // que este es el punto más bajo del camino y el único que no se puede saltear. La lista para
  // estados hereda la defensa gratis, y ahí el agujero sería peor: un renglón sin equipo, con
  // precio y link, pegado en un estado que ven cien personas.
  //
  // Vacío = `isBlank` = `trim().length === 0`, el **mismo** criterio que usa `resolveModelName`
  // aguas arriba en la vidriera. Ver `text.ts`.
  if (isBlank(listing.modelDisplayName)) {
    throw new DomainError(
      'LISTING_INVALID',
      'el nombre del equipo (`modelDisplayName`) está vacío o en blanco: el mensaje de WhatsApp ' +
        'quedaría con un agujero donde va el producto. Un nombre en blanco es un nombre ausente.',
    );
  }
  const always = appendsUnconditionally(listing.nameSource);
  // Espacios colapsados sólo en la salida: `iphone 14   pro` escrito a mano no llega así a WhatsApp.
  const name = listing.modelDisplayName.trim().replace(/\s+/gu, ' ');
  const color = listing.color !== null && listing.color.trim().length > 0 ? listing.color.trim() : null;

  const parts = [name];
  if (listing.storageGb !== null && (always || !nameHasStorage(name, listing.storageGb))) {
    parts.push(String(listing.storageGb));
  }
  if (color !== null && (always || !nameHasColor(name, color))) parts.push(color);
  return parts.join(' ');
}

/**
 * `iPhone 14 Pro 256 Grafito (usado A)` — el nombre más la condición **en registro de reseller**.
 *
 * El paréntesis usa `waConditionLabel` porque este string entra al mensaje de WhatsApp, que es un
 * contrato byte a byte de `CLAUDE.md` §1. La lista para estados usa el otro mapa, a propósito y
 * también por §1: ver el docblock de `stock-list.ts`.
 */
export function describeListing(listing: WaListing): string {
  return `${describeListingName(listing)} (${waConditionLabel(listing.condition)})`;
}

/**
 * Texto exacto del mensaje. **Sin** URL-encoding: eso lo hace `buildWaUrl`.
 * El copy depende del estado público del listing.
 *
 * ── `reserved`: la intención va primero, el aviso es consecuencia ────────────────────────────────
 *
 * Hasta S6 este mensaje terminaba en *«Dice que está reservado, ¿me avisás si se libera?»*, y eso
 * dejó de cerrar el día que la vidriera arregló su mitad: el único botón de la ficha reservada dice
 * **«Lo quiero igual — escribir por WhatsApp»** (`apps/web/app/(storefront)/_lib/status.ts`). El
 * visitante apretaba con una intención y mandaba otra. Del lado del vendedor no llegaba un
 * comprador: llegaba un favor para más adelante, que se archiva.
 *
 * El defecto **no** es el de la vidriera. Acá el aviso se lo pide el visitante al vendedor, que sí
 * puede cumplirlo: no es una promesa nuestra. Lo que rompe es `CLAUDE.md` §1 — la ficha tiene **UN**
 * `wa.me` y el texto que abre es el que cierra la operación. Un mensaje que arranca pidiendo un
 * favor futuro arranca perdido, y arranca perdido en el peor momento: mientras la reserva sigue
 * viva y todavía se puede caer.
 *
 * Lo que se sostiene, y por qué:
 * - **Primer renglón afirmativo.** `quiero el ...` antes que cualquier mención al estado. El
 *   vendedor tiene que leer que hay alguien que quiere ese equipo, no alguien preguntando.
 * - **El estado se reconoce, no se pregunta.** `Sé que está reservado` evita la venta duplicada y
 *   le dice al vendedor que este es el segundo en la fila, no un cliente confundido por el badge.
 * - **El aviso queda como consecuencia:** `si se cae, lo compro yo`. No se pide nada; se declara qué
 *   pasa si la seña no entra. El vendedor deduce solo que tiene a quién llamar.
 * - **Registro de reseller intacto** (`usado A`, no `usado excelente`): `CLAUDE.md` §1, ratificado.
 *   Son dos mapas a propósito — la ficha le habla a un comprador, este texto a un reseller.
 * - **Cero datos de la reserva.** Ni quién señó, ni hasta cuándo. `WaListing` no los tiene: la
 *   prohibición es de tipos. Que la ficha diga que está reservado es todo lo que un visitante
 *   anónimo puede saber.
 *
 * `available` **no se toca**: ese string está fijado literalmente en `CLAUDE.md` §1.
 */
export function buildWaMessage(listing: WaListing, slug: string): string {
  const host = storefrontHost(slug);
  const what = describeListing(listing);
  const price = formatUsd(listing.priceUsdCents);

  switch (listing.status) {
    case 'available':
      return `Hola, vi el ${what} a ${price} en ${host} y lo quiero.`;
    case 'reserved':
      return `Hola, quiero el ${what} a ${price} que vi en ${host}. Sé que está reservado: si se cae, lo compro yo.`;
    case 'sold':
      return `Hola, vi el ${what} en ${host} y dice que está vendido. ¿Te queda alguno parecido?`;
    default: {
      const never: never = listing.status;
      throw new DomainError('LISTING_INVALID', `estado público desconocido: ${String(never)}`);
    }
  }
}

/**
 * Teléfono en E.164 **sin** `+` ni espacios: `5492994xxxxxx`.
 * Se valida al guardarlo (Zod, borde) y también acá: un link roto no se ve hasta que se pierde
 * la venta.
 */
export function normalizeWaPhone(input: string): string {
  const digits = input.replace(/[\s()+-]/gu, '');
  if (!/^[1-9]\d{7,14}$/u.test(digits)) {
    throw new DomainError(
      'WA_PHONE_INVALID',
      `teléfono inválido: "${input}" (E.164 sin "+", 8–15 dígitos, sin cero inicial)`,
    );
  }
  return digits;
}

/**
 * `https://wa.me/{phoneE164}?text={encoded}`.
 * `encodeURIComponent` sobre el texto completo: acentos y espacios sobreviven del lado de WhatsApp.
 */
export function buildWaUrl(listing: WaListing, slug: string, phone: string): string {
  const phoneE164 = normalizeWaPhone(phone);
  const text = buildWaMessage(listing, slug);
  return `https://wa.me/${phoneE164}?text=${encodeURIComponent(text)}`;
}
