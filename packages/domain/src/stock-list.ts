/**
 * Lista de stock para estados de Instagram / difusión de WhatsApp — slice S9.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Qué reemplaza
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * El dueño tiene 15–200 equipos y todas las noches escribe a mano, en Excel o en el teclado del
 * teléfono, la lista que pega en un estado. Esta función arma ese texto a partir del mismo stock
 * que ya publica la vidriera, así que la lista y la ficha **no pueden discrepar**: los precios se
 * formatean con `formatUsd`/`formatArs`, las mismas de la pantalla, y el nombre se arma con
 * `describeListingName`, la misma de `buildWaMessage`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El link va a la FICHA, no a `wa.me` — decisión del LEAD, no reabrir
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * El embudo del producto es `estado → ficha → botón de WhatsApp` (`CLAUDE.md` §1: *"el visitante
 * llega informado"*). Un `wa.me` pegado en el estado saltea la ficha y le entrega al vendedor un
 * WhatsApp de alguien que no vio las 3 fotos, ni la batería, ni el punto de retiro — o sea
 * exactamente el WhatsApp que el producto vino a evitar.
 *
 * La URL absoluta de cada ficha **entra por parámetro** (`StockListUnit.url`) y este paquete no
 * sabe cómo se construye. El prefijo `/p` está declarado en
 * `apps/web/app/(storefront)/_lib/routes.ts` como propio de `apps/web` —una ruta no es una
 * validación— y una segunda copia acá sería una segunda fuente de verdad de la misma cadena.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Campos prohibidos: la prohibición es de TIPOS, no de disciplina
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `CLAUDE.md` §2: `imei`, `cost_usd`, `margin`, `internal_notes` (y `supplier`, y `enacomResult`,
 * y `tenantId`) **no pueden cruzar a un texto público**. Igual que `WaListing` en `wa.ts`, el
 * remedio no es acordarse de no escribirlos: es que `StockListUnit` **no los tiene**. Un mapeo que
 * intente pasarlos no compila, y olvidarse de excluirlos es imposible porque no hay nada que
 * excluir. Este texto se pega en un estado que ven cien personas y se reenvía sin control: es el
 * peor lugar del producto para una fuga, y por eso el tipo es una allowlist cerrada.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Registro de condición: `usado excelente`, NO `usado A`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `CLAUDE.md` §1 fija **dos** mapas a propósito y los dos son correctos: `conditionLabel` habla
 * como la ficha (`usado excelente`) y `waConditionLabel` como un reseller en un privado
 * (`usado A`). Acá se usa `conditionLabel`, y el criterio es **quién lee**:
 *
 * 1. **Esta lista la lee un comprador final**, en un estado de Instagram, entre fotos de amigos.
 *    `usado A` es jerga de mostrador: para el que no la tiene no significa "excelente", significa
 *    nada — o peor, "clase A" de algo que no sabe qué escala es.
 * 2. **Cada renglón termina en un link a la ficha, y la ficha dice `usado excelente`.** Si el
 *    estado dijera `usado A` y la ficha `usado excelente`, la persona que hace el click ve dos
 *    palabras distintas para lo mismo y no tiene cómo saber que son lo mismo. El mensaje de
 *    WhatsApp puede permitirse el otro registro porque no lleva link: nadie lo compara con nada.
 * 3. El destinatario define el registro, no el canal. Que el texto se pegue *en* WhatsApp (una
 *    difusión) no lo convierte en una conversación entre resellers.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Pureza
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Determinista y sin I/O. `Date.now()` está prohibido en este paquete: si querés fecha en el
 * encabezado, `now` entra por parámetro. Sin `now`, no hay renglón de fecha — nunca una fecha
 * inventada.
 */

import { DomainError } from './errors';
import { assertNonNegativeCents, formatArs, formatUsd } from './money';
import { isBlank } from './text';
import { conditionLabel, type Condition, type PublicStatus } from './types';
import { describeListingName, storefrontHost, type NameSource } from './wa';

/**
 * Presupuesto de caracteres por bloque, por default.
 *
 * ── Por qué no 4096 ─────────────────────────────────────────────────────────────────────────────
 * 4096 es el **techo duro** de un mensaje de WhatsApp (`WA_MESSAGE_MAX_CHARS`), no un objetivo:
 * pasarlo no degrada nada, corta el mensaje. Pero usarlo de default rompe los dos usos reales:
 *
 * 1. **El estado de Instagram no tiene límite de caracteres, tiene límite de pantalla.** El texto
 *    se ve una vez, en un 1080×1920, mientras la persona tiene el dedo apoyado para pasar. Lo que
 *    entra legible son ~15 renglones cortos; a partir de ahí Instagram achica la tipografía y el
 *    estado deja de leerse en el teléfono, que es el único lugar donde se lee.
 * 2. **El bloque no se pega solo.** El dueño le agrega arriba su propia línea ("Todo con garantía,
 *    envíos a todo el país"). Un bloque medido exactamente contra el techo se pasa del techo el
 *    día que se usa como se pensó.
 *
 * ── Por qué 1000 ────────────────────────────────────────────────────────────────────────────────
 * Una unidad ocupa ~115 caracteres (dos renglones: nombre + condición + precios, y el link).
 * 1000 da ~8 unidades por bloque ≈ 16 renglones más el encabezado: entra legible en un estado y
 * queda a 4× de distancia del techo de WhatsApp, o sea con lugar de sobra para el agregado del
 * dueño. Es un **default**, no una constante de negocio: quien publique sólo por difusión le pasa
 * 3500 y listo. La regla que sí es dura —una unidad nunca se parte y nunca se descarta— no depende
 * de este número.
 */
export const DEFAULT_BLOCK_BUDGET_CHARS = 1000;

/**
 * Techo duro de un mensaje de WhatsApp. Se exporta como **documentación ejecutable**: el default
 * de arriba se testea contra este número, así que si alguien sube el default por encima del techo
 * el test lo dice. Esta función no lo impone —un caller puede apuntar a otro canal— pero nadie
 * debería tener que buscar el 4096 en un blog.
 */
export const WA_MESSAGE_MAX_CHARS = 4096;

/**
 * Argentina es UTC−3 **todo el año**: no observa horario de verano desde 2009.
 *
 * El offset es explícito y no se lee del runtime a propósito. `Date#getDate()` usa la zona horaria
 * del proceso, y el proceso corre en Vercel, o sea en UTC: un estado armado a las 21:30 de
 * Cipolletti saldría fechado **mañana**, y las 21:30 es exactamente cuando se arma el estado. Un
 * encabezado que dice "Stock al 29/08" un 28 a la noche no es un detalle cosmético: es la única
 * marca de frescura que lleva la lista.
 */
export const ARGENTINA_UTC_OFFSET_MINUTES = -180;

/**
 * Techo del nombre del negocio. Un nombre más largo que esto no es un nombre, es datos rotos, y
 * como el encabezado se repite en **cada** bloque, un valor patológico convierte la lista entera
 * en un bloque por unidad sin que nadie entienda por qué. Se corta acá, con error, en vez de
 * truncar en silencio: truncar el nombre del negocio del dueño es peor que fallar.
 */
export const BUSINESS_NAME_MAX_CHARS = 120;

/**
 * Una unidad de la lista. **Allowlist cerrada**: es todo lo que el texto puede saber del listing.
 *
 * Espeja `WaListing` (`wa.ts`) con dos campos más —`priceArsCents` y `url`— y por el mismo motivo
 * de fondo: los campos sensibles no están *filtrados*, están **ausentes del tipo**. `imei`,
 * `cost_usd`, `margin`, `internal_notes`, `supplier` y `tenantId` no se pueden ni escribir acá.
 */
export interface StockListUnit {
  /** Procedencia de `modelDisplayName`. Sin default: es decisión del mapeo. Ver `NAME_SOURCES`. */
  readonly nameSource: NameSource;
  /**
   * `iPhone 14 Pro` si `nameSource === 'catalog'`; `iPhone 14 Pro 256 Grafito` si es `'free_text'`
   * (el título del dueño, que en la práctica ya trae storage y color adentro).
   */
  readonly modelDisplayName: string;
  readonly storageGb: number | null;
  readonly color: string | null;
  readonly condition: Condition;
  readonly priceUsdCents: number;
  /**
   * ARS **ya calculado** por el caller con `applyFx`, el TC del tenant y su modo de redondeo.
   * Esta función no hace FX: el TC lo setea el dueño y no hay API de dólar en el hot path
   * (`CLAUDE.md` §1). `null` = el tenant no publica ARS, y entonces el renglón sale sólo en USD.
   */
  readonly priceArsCents: number | null;
  readonly status: PublicStatus;
  /**
   * URL **absoluta** de la ficha, tal como la arma `apps/web`. Se imprime tal cual: recortarle el
   * esquema o normalizarla acá es arriesgar un link muerto en un estado, que es un renglón de
   * stock perdido sin aviso.
   */
  readonly url: string;
}

/** Un bloque listo para pegar en **un** estado o **un** mensaje. */
export interface StockListBlock {
  /** 1-based, el mismo número que imprime el encabezado. */
  readonly index: number;
  /** Cantidad total de bloques, el mismo del encabezado. */
  readonly total: number;
  /** El texto completo, encabezado incluido. */
  readonly text: string;
  /** Cuántas unidades entraron acá. Nunca 0 mientras haya unidades. */
  readonly unitCount: number;
  /**
   * `true` si el bloque quedó por encima del presupuesto. Sólo puede pasar con **una** unidad
   * adentro: una unidad sola que no entra igual se emite. Ver `buildStockList`.
   */
  readonly overBudget: boolean;
}

/** El resultado completo. */
export interface StockList {
  readonly blocks: readonly StockListBlock[];
  /**
   * Unidades emitidas. **Invariante testeado:** siempre igual a `input.units.length`, y siempre
   * igual a la suma de los `unitCount` de los bloques. Perder stock en silencio es el peor fallo
   * posible de esta función y este número es lo que lo hace verificable desde afuera.
   */
  readonly unitCount: number;
}

export interface StockListInput {
  /** Nombre comercial, tal como lo escribió el dueño. Va en el encabezado de cada bloque. */
  readonly businessName: string;
  /** Slug del tenant. Se valida y de él sale el host que muestra el encabezado. */
  readonly slug: string;
  readonly units: readonly StockListUnit[];
  /** Default `DEFAULT_BLOCK_BUDGET_CHARS`. Entero positivo. */
  readonly maxBlockChars?: number;
  /**
   * Fecha del encabezado. **Inyectada**: sin ella no hay renglón de fecha. `Date.now()` está
   * prohibido en este paquete.
   */
  readonly now?: Date;
  /** Default `ARGENTINA_UTC_OFFSET_MINUTES`. Sólo se usa si viene `now`. */
  readonly utcOffsetMinutes?: number;
}

/** Separador entre encabezado y cuerpo, y entre unidades. Un renglón en blanco. */
const GAP = '\n\n';

/**
 * Marca del estado, **al principio del renglón y en mayúsculas**.
 *
 * Va adelante y no al final por el modo en que se lee un estado: de un vistazo, saltando de la
 * primera palabra al precio. Una marca al final del renglón es una marca que el que sólo mira el
 * precio no ve, y el resultado es un WhatsApp por un equipo que ya tiene seña — la venta duplicada
 * que `buildWaMessage` se cuida de no provocar. Misma disciplina: nunca mostrar como disponible
 * algo que no lo está.
 *
 * `available` no lleva marca: es el caso normal y el ruido se paga en caracteres.
 */
function statusMark(status: PublicStatus): string | null {
  switch (status) {
    case 'available':
      return null;
    case 'reserved':
      return 'RESERVADO';
    case 'sold':
      return 'VENDIDO';
    default: {
      const never: never = status;
      throw new DomainError('LISTING_INVALID', `estado público desconocido: ${String(never)}`);
    }
  }
}

/** Colapsa todo el whitespace a un espacio simple. Ver `assertPasteSafe`. */
function collapse(text: string): string {
  return text.trim().replace(/\s+/gu, ' ');
}

/**
 * El texto de **una** unidad: dos renglones, el segundo es el link.
 *
 * ```
 * RESERVADO · iPhone 14 Pro 256 Grafito · usado excelente · USD 620 · $ 868.000
 * https://nortecel.maat.work/p/iphone-14-pro-256-grafito
 * ```
 *
 * Es la **unidad indivisible** del armado: `buildStockList` mueve entradas enteras entre bloques y
 * nunca las corta. Se exporta para que la vidriera y el panel puedan mostrar el renglón exacto que
 * se va a pegar (previsualización) sin recalcularlo distinto.
 */
export function buildStockListEntry(unit: StockListUnit): string {
  // `describeListingName` valida que el nombre no esté en blanco y resuelve el
  // `256 Grafito 256 Grafito` de los títulos de texto libre. No se reimplementa acá.
  const name = describeListingName(unit);

  assertNonNegativeCents(unit.priceUsdCents, 'el precio en USD de la lista de stock');
  const prices = [formatUsd(unit.priceUsdCents)];
  if (unit.priceArsCents !== null) {
    assertNonNegativeCents(unit.priceArsCents, 'el precio en ARS de la lista de stock');
    prices.push(formatArs(unit.priceArsCents));
  }

  // ── El link es el renglón que factura ────────────────────────────────────────────────────────
  // Una entrada sin link es un equipo publicado sin manera de llegar a la ficha: el embudo entero
  // (`estado → ficha → WhatsApp`) queda cortado en el primer paso y el dueño no se entera hasta
  // que no le escribe nadie. Se exige absoluta porque un `/p/algo` pegado en un estado no es un
  // link, es texto. `http://` se acepta además de `https://` porque los e2e y el `next start` del
  // gate corren sobre `{slug}.127.0.0.1.nip.io:3100`.
  const url = unit.url.trim();
  if (isBlank(unit.url) || !/^https?:\/\/\S+$/u.test(url)) {
    throw new DomainError(
      'LISTING_INVALID',
      `la URL de la ficha tiene que ser absoluta y sin espacios, recibí: "${unit.url}". ` +
        'La arma `apps/web`; este paquete no conoce el prefijo de la ruta.',
    );
  }

  const head = [name, conditionLabel(unit.condition), ...prices].join(' · ');
  const mark = statusMark(unit.status);
  return `${mark === null ? head : `${mark} · ${head}`}\n${url}`;
}

/**
 * `Nortecel · nortecel.maat.work · 2/3` (+ `Stock al 28/08` si vino `now`).
 *
 * La numeración aparece **sólo con más de un bloque**: `1/1` es ruido, y son caracteres que le
 * saca a un equipo. Con dos o más es obligatoria — la persona los pega de a uno y el orden es lo
 * único que hace que la lista se lea como una lista.
 */
function buildHeader(businessName: string, host: string, index: number, total: number, dateText: string | null): string {
  const parts = [businessName, host];
  if (total > 1) parts.push(`${String(index)}/${String(total)}`);
  const line = parts.join(' · ');
  return dateText === null ? line : `${line}\nStock al ${dateText}`;
}

/** `28/08`, en hora de Argentina. Sin año: un estado dura 24 horas. */
function formatDayMonth(now: Date, utcOffsetMinutes: number): string {
  const shifted = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

/** Largo del bloque si se lo arma con estas entradas y un encabezado de `headerChars`. */
function blockLength(headerChars: number, entryLengths: readonly number[]): number {
  const body = entryLengths.reduce((sum, length) => sum + length, 0) + Math.max(entryLengths.length - 1, 0) * GAP.length;
  return headerChars + GAP.length + body;
}

/**
 * Reparte las entradas en bloques, **en orden**, reservando `headerChars` para el encabezado.
 *
 * Dos reglas duras, y son la razón de que esto sea greedy y no un empaquetado óptimo:
 * - **Una unidad nunca se parte.** Se mueven entradas enteras.
 * - **Una unidad nunca se descarta.** Si sola no entra en el presupuesto, abre su propio bloque y
 *   sale igual, marcada `overBudget`. Perder un equipo en silencio es el peor fallo posible acá:
 *   el dueño publica 15 y vende 14 sin enterarse nunca de cuál faltó.
 *
 * Greedy además preserva el orden que eligió el caller (destacados primero, por ejemplo), que un
 * empaquetado óptimo destruiría para ahorrar caracteres que a nadie le importan.
 */
function packEntries(entryLengths: readonly number[], headerChars: number, budget: number): number[][] {
  const blocks: number[][] = [];
  let current: number[] = [];

  entryLengths.forEach((length, position) => {
    if (current.length === 0) {
      current.push(position);
      return;
    }
    const candidate = [...current.map((index) => entryLengths[index] ?? 0), length];
    if (blockLength(headerChars, candidate) <= budget) {
      current.push(position);
      return;
    }
    blocks.push(current);
    current = [position];
  });

  if (current.length > 0) blocks.push(current);
  return blocks;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DomainError('LISTING_INVALID', `${label} tiene que ser un entero positivo, recibí: ${String(value)}`);
  }
}

/**
 * Arma la lista completa, en bloques listos para pegar.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué bloques y no un solo texto
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 200 equipos no entran ni en un estado ni en un mensaje de WhatsApp (techo real: 4096). Devolver
 * un blob y que el caller lo corte es garantizar que lo corte por el medio de un equipo, o peor,
 * por el medio de un link. El corte es una decisión del dominio porque **la unidad indivisible es
 * del dominio**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El encabezado y el total: punto fijo, no adivinanza
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * El encabezado dice `1/3`, así que su largo depende de cuántos bloques haya... que depende de
 * cuánto ocupe el encabezado. Es circular, y la salida fácil —estimar y no volver a mirar— produce
 * el único bug imperdonable de esta función: un encabezado que dice `1/3` cuando hay cuatro
 * bloques, o sea el dueño pegando tres y quedándose con uno sin publicar.
 *
 * Se resuelve iterando a **punto fijo**: se empaqueta suponiendo `T` bloques, y si salen `A ≠ T`
 * se vuelve a empaquetar con `T = A`. Converge, y se puede argumentar: `A(T)` no decrece con `T`
 * (más dígitos en el encabezado → menos lugar para unidades → más bloques), la sucesión arranca en
 * `T = 1 ≤ A(1)` y crece, y está acotada por `units.length` (peor caso, una unidad por bloque). En
 * la práctica son dos vueltas: el largo del encabezado sólo cambia cuando el total cambia de
 * cantidad de dígitos.
 *
 * Se reserva el encabezado **más largo** de la tanda (el del bloque `T`, que tiene el índice de más
 * dígitos) para todos los bloques. Sobra-estima por uno o dos caracteres en los primeros bloques
 * cuando hay 10 o más, y esa es la dirección segura del error.
 *
 * El encabezado que se imprime lleva **siempre el total real**, aun en el caso imposible de que la
 * iteración no convergiera: antes un bloque dos caracteres más largo que un encabezado que miente.
 */
export function buildStockList(input: StockListInput): StockList {
  const host = storefrontHost(input.slug);

  // El nombre del negocio es texto libre del dueño y acá se pega dentro de un texto estructurado.
  // Colapsar el whitespace no es cosmética: un `\n` en el nombre parte el encabezado en dos y deja
  // al que lo lee sin saber cuál de los dos renglones es el negocio — y un nombre que contenga
  // algo como "\n1/1 · otro.maat.work" forjaría un encabezado entero. El texto que sale de acá lo
  // lee una persona, no un LLM, así que la defensa que corresponde es estructural (whitespace y
  // largo), no la de `sanitizeForPrompt`.
  const businessName = collapse(input.businessName);
  if (businessName.length === 0) {
    throw new DomainError(
      'LISTING_INVALID',
      'el nombre del negocio está vacío o en blanco: el encabezado quedaría con un hueco donde va ' +
        'de quién es el stock.',
    );
  }
  if (businessName.length > BUSINESS_NAME_MAX_CHARS) {
    throw new DomainError(
      'LISTING_INVALID',
      `el nombre del negocio supera ${String(BUSINESS_NAME_MAX_CHARS)} caracteres ` +
        `(${String(businessName.length)}): el encabezado se repite en cada bloque.`,
    );
  }

  const budget = input.maxBlockChars ?? DEFAULT_BLOCK_BUDGET_CHARS;
  assertPositiveInteger(budget, 'el presupuesto de caracteres por bloque');

  const offset = input.utcOffsetMinutes ?? ARGENTINA_UTC_OFFSET_MINUTES;
  if (!Number.isSafeInteger(offset) || Math.abs(offset) > 14 * 60) {
    throw new DomainError('LISTING_INVALID', `offset de zona horaria inválido: ${String(offset)}`);
  }
  let dateText: string | null = null;
  if (input.now !== undefined) {
    if (Number.isNaN(input.now.getTime())) {
      throw new DomainError('LISTING_INVALID', '`now` es una fecha inválida (`Invalid Date`)');
    }
    dateText = formatDayMonth(input.now, offset);
  }

  // Se arman todas las entradas primero: si una unidad es inválida, la lista entera falla antes de
  // emitir nada. Media lista publicada es peor que ninguna — el dueño no sabría cuál falta.
  const entries = input.units.map((unit) => buildStockListEntry(unit));
  if (entries.length === 0) {
    // Cero unidades, cero bloques. No se emite un encabezado solo: un estado que anuncia un
    // negocio y no lista nada es peor que no publicar.
    return { blocks: [], unitCount: 0 };
  }
  const entryLengths = entries.map((entry) => entry.length);

  let assumedTotal = 1;
  let packed = packEntries(entryLengths, buildHeader(businessName, host, 1, 1, dateText).length, budget);
  for (let round = 0; round < entries.length + 1 && packed.length !== assumedTotal; round += 1) {
    assumedTotal = packed.length;
    const widestHeader = buildHeader(businessName, host, assumedTotal, assumedTotal, dateText).length;
    packed = packEntries(entryLengths, widestHeader, budget);
  }

  const total = packed.length;
  const blocks = packed.map((positions, blockIndex) => {
    const index = blockIndex + 1;
    const header = buildHeader(businessName, host, index, total, dateText);
    const text = `${header}${GAP}${positions.map((position) => entries[position] ?? '').join(GAP)}`;
    return {
      index,
      total,
      text,
      unitCount: positions.length,
      overBudget: text.length > budget,
    };
  });

  return { blocks, unitCount: blocks.reduce((sum, block) => sum + block.unitCount, 0) };
}
