/**
 * Proyección de la ficha abierta **para el prompt**.
 *
 * ## Es una segunda allowlist, encima de la del DTO
 * `publicListingDTO` ya decide qué puede ver un comprador. Esta capa decide, además, qué de eso
 * vale un token. No son la misma pregunta: `waUrl`, `photos[].card` y `fxRateUsed` son públicos y
 * están bien en la ficha HTML, pero adentro del prompt son ~120 tokens de URLs que el modelo no
 * puede usar para nada y que encima lo tientan a escribir links —y la salida del chatbot se
 * renderiza como texto plano, sin links (`ARCHITECTURE.md` §Seguridad).
 *
 * Igual que en el DTO: **se arma campo por campo, sin `spread`**. Si mañana el DTO gana un campo,
 * acá no aparece hasta que alguien lo agregue a propósito.
 *
 * ## `reserved` no es un adorno
 * El estado se renderiza como una frase explícita y negativa, no como un enum que el modelo tenga
 * que interpretar. E8 del `TEST_MATRIX.md` es exactamente esto: que la ficha ya no diga
 * "disponible" bajo `reserved` no dice nada de lo que va a contestar el chat, que es **otro
 * renderizador del mismo estado**.
 */

import { PROMPT_MAX_DESCRIPTION_LENGTH, sanitizeForPrompt, type PublicListingDTO, type PublicStatus } from '@istock/domain';
import { truncateToTokens } from './tokens';

/** Cuánto del texto libre del dueño entra al prompt, en tokens de nuestro contador. */
export const DESCRIPTION_TOKEN_BUDGET = 140;
const MAX_PICKUP_POINTS = 3;
const MAX_PAYMENT_METHODS = 6;

/**
 * Frase de disponibilidad por estado. Es texto, no enum, y en `reserved` y `sold` **empieza por la
 * negación**: el modelo tiene que leer "no está disponible" antes que cualquier otra cosa.
 *
 * ## `reserved` decía *"se puede avisar si se libera"*, y era mentira
 * No existe ningún mecanismo que avise a nadie: no hay lista de espera, la vidriera no guarda dato
 * del visitante y no tiene DB propia. Era una promesa a un desconocido que nadie podía cumplir, y
 * el que quedaba mal era el reseller.
 *
 * `apps/web/app/(storefront)/_lib/status.ts` y `packages/domain/src/wa.ts` ya se corrigieron: la
 * ficha dice que no hay lista de espera y el mensaje de WhatsApp declara la compra
 * (*"Sé que está reservado: si se cae, lo compro yo"*). Este archivo era **la última boca del
 * producto que decía lo viejo**, y la peor: el visitante leía en la ficha que no hay lista de
 * espera, le preguntaba al chat, y el chat le ofrecía el aviso igual. Un chatbot que promete suena
 * más creíble que un cartel, así que el bug era peor acá que donde empezó.
 *
 * Lo que queda es verdad y es accionable: está reservado, una reserva a veces se cae, y **quien
 * igual lo quiere se lo dice al vendedor ahora**. Ninguna acción futura nuestra.
 *
 * La instrucción no viaja sola: `guardAnswer` descarta la respuesta si el modelo ofrece un aviso
 * igual. El prompt es la capa que se negocia; el guard es el `if`.
 */
export const AVAILABILITY_TEXT: Readonly<Record<PublicStatus, string>> = {
  available: 'DISPONIBLE (se puede consultar por WhatsApp)',
  reserved:
    'RESERVADO — lo reservó otra persona, NO está disponible. No lo ofrezcas como disponible. ' +
    'NO ofrezcas avisar ni anotar a nadie: no hay lista de espera. ' +
    'Quien igual lo quiera, que se lo diga al vendedor ahora.',
  sold: 'VENDIDO — NO está disponible ni se puede reservar.',
};

export interface ListingPromptView {
  readonly name: string;
  readonly storageGb: number | null;
  readonly color: string | null;
  readonly conditionLabel: string;
  readonly batteryPct: number | null;
  readonly screenOriginal: boolean | null;
  readonly icloudStatusText: string | null;
  readonly warrantyText: string | null;
  readonly provenanceText: string | null;
  readonly priceUsdFormatted: string;
  readonly priceArsFormatted: string;
  readonly availability: string;
  readonly status: PublicStatus;
  readonly pickup: readonly { readonly name: string; readonly hours: string }[];
  readonly paymentMethods: readonly string[];
  readonly acceptsTradeIn: boolean;
  readonly photoCount: number;
  /** Ya sanitizada y delimitada por `sanitizeForPrompt`. `null` si el dueño no escribió nada. */
  readonly description: string | null;
}

function blankToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** DTO → vista del prompt. Allowlist explícita, sin `spread`, sin `omit`. */
export function listingPromptView(listing: PublicListingDTO): ListingPromptView {
  const rawDescription = blankToNull(listing.description);
  return {
    name: listing.title.trim().replace(/\s+/gu, ' '),
    storageGb: listing.storageGb,
    color: blankToNull(listing.color),
    conditionLabel: listing.conditionLabel,
    batteryPct: listing.batteryPct,
    screenOriginal: listing.screenOriginal,
    icloudStatusText: blankToNull(listing.icloudStatusText),
    warrantyText: blankToNull(listing.warrantyText),
    provenanceText: blankToNull(listing.provenanceText),
    priceUsdFormatted: listing.priceUsd.formatted,
    priceArsFormatted: listing.priceArs.formatted,
    availability: AVAILABILITY_TEXT[listing.status],
    status: listing.status,
    pickup: listing.pickup.slice(0, MAX_PICKUP_POINTS).map((point) => ({ name: point.name, hours: point.hours })),
    paymentMethods: listing.paymentMethods.slice(0, MAX_PAYMENT_METHODS),
    acceptsTradeIn: listing.acceptsTradeIn,
    photoCount: listing.photos.length,
    description:
      rawDescription === null
        ? null
        : sanitizeForPrompt(truncateToTokens(rawDescription, DESCRIPTION_TOKEN_BUDGET), {
            maxLength: PROMPT_MAX_DESCRIPTION_LENGTH,
          }),
  };
}

function line(label: string, value: string | null): string | null {
  return value === null ? null : `${label}: ${value}`;
}

/**
 * Render compacto. Una línea por dato, sin JSON: las llaves y comillas de un JSON de 18 campos
 * cuestan ~40 tokens que no dicen nada.
 */
export function renderListingBlock(view: ListingPromptView): string {
  const lines: (string | null)[] = [
    `FICHA ABIERTA (única fuente de verdad; si algo no está acá, no lo sabés)`,
    line('Equipo', view.name),
    line('Almacenamiento', view.storageGb === null ? null : `${view.storageGb} GB`),
    line('Color', view.color),
    line('Condición', view.conditionLabel),
    line('Batería', view.batteryPct === null ? null : `${view.batteryPct}%`),
    line('Pantalla', view.screenOriginal === null ? null : view.screenOriginal ? 'original' : 'no original'),
    line('iCloud', view.icloudStatusText),
    line('Garantía', view.warrantyText),
    line('Procedencia', view.provenanceText),
    line('Precio', `${view.priceUsdFormatted} (referencia ${view.priceArsFormatted}, informativo)`),
    line('Estado', view.availability),
    line('Fotos publicadas', String(view.photoCount)),
    line('Canje', view.acceptsTradeIn ? 'sí, a cotizar por WhatsApp' : 'no'),
    line(
      'Retiro',
      view.pickup.length === 0 ? null : view.pickup.map((point) => `${point.name} (${point.hours})`).join(' · '),
    ),
    line('Medios de pago', view.paymentMethods.length === 0 ? null : view.paymentMethods.join(', ')),
  ];
  const body = lines.filter((entry): entry is string => entry !== null).join('\n');
  return view.description === null ? body : `${body}\nDescripción del vendedor:\n${view.description}`;
}

/**
 * Resumen de una línea. Es lo que devuelve la tool `get_open_listing`.
 *
 * **No devuelve la ficha entera y eso es deliberado:** la ficha ya está en el system del mismo
 * turno. Contestar la tool con una segunda copia serían ~250 tokens duplicados dentro de una dieta
 * de 1200 — la tool existe para que el modelo tenga a dónde ir cuando duda, no para volver a mandar
 * lo que ya mandamos.
 */
export function renderListingDigest(view: ListingPromptView): string {
  const bits = [
    view.name,
    view.storageGb === null ? null : `${view.storageGb} GB`,
    view.color,
    view.conditionLabel,
    view.priceUsdFormatted,
    view.batteryPct === null ? null : `batería ${view.batteryPct}%`,
    view.availability,
  ].filter((bit): bit is string => bit !== null && bit.length > 0);
  return bits.join(' · ');
}
