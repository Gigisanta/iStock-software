/**
 * Handoff a WhatsApp — el final feliz, no el plan B.
 *
 * `docs/CHATBOT.md`: *"El chatbot no es el producto. El producto es que el visitante llegue
 * informado al WhatsApp del dueño. Un bot que conversa mucho y no deriva es un bot que falló."*
 *
 * Dos cosas que hace este archivo y que valen más que cualquier prompt:
 *
 * 1. **Detecta la intención ANTES de llamar al modelo.** Si el comprador pregunta por reservar,
 *    pagar, iCloud, el identificador del equipo, envío o canje, la respuesta correcta ya está
 *    decidida y no hace falta gastar un token. Eso hace que los evals de jailbreak sean
 *    **deterministas**: no dependen de que el modelo se porte bien, dependen de código que se testea.
 * 2. **El texto del handoff no lo escribe el modelo.** Es copy fijo + el `wa.me` que ya viene armado
 *    en el DTO por `buildWaMessage` de `packages/domain`. Un solo lugar arma ese texto en todo el
 *    producto (`skill wa-payload`), y el chatbot no es la excepción: reusa el del DTO, no arma otro.
 */

import type { PublicListingDTO } from '@istock/domain';
import { AiError } from './errors';
import { detectSensitiveIntent, type RedactionTag } from './redaction';

/**
 * Motivos que el **modelo** puede invocar con la tool `handoff_whatsapp`.
 * Son los del comprador. Los operativos (proveedor caído, soft cap) no están acá a propósito: el
 * modelo no tiene forma de saberlos y dejárselos declarar sería dejarlo mentir sobre la causa.
 */
export const MODEL_HANDOFF_REASONS = [
  'reserve',
  'payment',
  'icloud',
  'device_id',
  'shipping',
  'trade_in',
  'sensitive',
  'low_confidence',
  'out_of_scope',
] as const;
export type ModelHandoffReason = (typeof MODEL_HANDOFF_REASONS)[number];

/** Motivos operativos: los decide el servidor, nunca el modelo. */
export const SERVER_HANDOFF_REASONS = ['soft_cap', 'provider_down', 'unsafe_output', 'not_available'] as const;
export type ServerHandoffReason = (typeof SERVER_HANDOFF_REASONS)[number];

export const HANDOFF_REASONS = [...MODEL_HANDOFF_REASONS, ...SERVER_HANDOFF_REASONS] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

export function isModelHandoffReason(value: string): value is ModelHandoffReason {
  return (MODEL_HANDOFF_REASONS as readonly string[]).includes(value);
}

/** Tag de dato sensible → motivo de handoff. */
function reasonForTag(tag: RedactionTag): ModelHandoffReason {
  return tag === 'DEVICE_ID' ? 'device_id' : 'sensitive';
}

/**
 * Compila un disparador con bordes de palabra **Unicode**. Ver el docblock de `term` en
 * `redaction.ts`: el `\\b` de JavaScript trata la vocal acentuada como separador, así que un
 * patrón que termina en `[oó]` no matchea cuando el comprador escribe bien.
 */
function topic(source: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'iu');
}

/**
 * Disparadores por tema. El orden importa: se evalúan de más específico a más general y gana el
 * primero, porque *"quiero reservar y pagar con tarjeta"* es un handoff de reserva.
 */
/**
 * Preguntar **si** algo está reservado no es pedir una reserva: es preguntar por el estado, y el
 * estado está en el DTO igual que el precio. Derivar a WhatsApp un "¿está reservado?" manda al
 * vendedor una consulta cuya respuesta ya estaba en la página.
 *
 * La excepción es segura porque no está sola: si el modelo contesta "sí, está disponible" sobre una
 * unidad reservada, lo frena `guard.ts`. Sin ese segundo control esta carve-out no iría.
 */
const RESERVE_STATUS_QUESTION = topic(
  '(?:est[aá]|sigue|segu[ií]a|qued[oó]|lo\\s+ten[eé]s|est[aá]\\s+ya)\\s+reservad\\p{L}*',
);

const TOPIC_TRIGGERS: readonly {
  readonly reason: ModelHandoffReason;
  readonly re: RegExp;
  /** Si esto matchea, el trigger no cuenta. Se usa para separar preguntar de pedir. */
  readonly unless?: RegExp;
}[] = [
  {
    reason: 'reserve',
    re: topic('reserv\\p{L}*|se[ñn]\\p{L}*|apart\\p{L}*|me\\s+lo\\s+guard\\p{L}*|guardamelo|lo\\s+quiero\\s+ya'),
    unless: RESERVE_STATUS_QUESTION,
  },
  // `trade_in` va ANTES que `payment` a propósito: "parte de pago" contiene "pago", y quien lo
  // escribe está ofreciendo su equipo, no preguntando por medios de pago. Con el orden al revés
  // —que fue el primero— el canje quedaba clasificado como consulta de pago y el vendedor recibía
  // el WhatsApp equivocado. El canje es un flujo de primera clase del producto (PRODUCT.md), no un
  // subcaso de pagar.
  { reason: 'trade_in', re: topic('canje|permut\\p{L}*|entrego\\s+(mi|el)|parte\\s+de\\s+pago|trade[\\s-]?in|recib[ií]s\\s+mi|tom[aá]s\\s+mi') },
  {
    reason: 'payment',
    // El bloque de "aceptan/toman <moneda>" está anclado al verbo a propósito: `paymentMethods` del
    // DTO lista medios, no monedas, así que "¿aceptan dólares?" no se puede contestar desde la ficha
    // y contestarlo igual sería comprometer al vendedor. Sin el ancla, un "¿cuánto es en pesos?"
    // —que SÍ está en el DTO— caería también, y esa pregunta es la más común de la vidriera.
    re: topic(
      'pagar|pago|abonar|transferencia|tarjeta|cuotas?|financia\\p{L}*|d[eé]bito|cr[eé]dito|efectivo|USDT|cripto\\p{L}*|mercado\\s*pago' +
        '|(?:acept\\p{L}*|toman|reciben|cobran|recib[ií]s|tom[aá]s)\\s+(?:en\\s+)?(?:d[oó]lar\\p{L}*|pesos|blue)',
    ),
  },
  { reason: 'icloud', re: topic('icloud|apple\\s*id|bloqueo\\s+de\\s+activaci[oó]n|cuenta\\s+de\\s+apple|activation\\s+lock') },
  {
    reason: 'shipping',
    re: topic('env[ií]\\p{L}*|mandan?|manda[sr]|despach\\p{L}*|correo|andreani|oca|via\\s?cargo|a\\s+domicilio|delivery|shipping'),
  },
];

/**
 * ¿Este mensaje del comprador se deriva sí o sí? `null` = se puede intentar responder.
 *
 * **Se corre sobre el texto crudo del comprador**, antes de cualquier sanitización: sanitizar
 * primero borraría justamente las frases que queremos detectar.
 */
export function detectHandoffIntent(userText: string): ModelHandoffReason | null {
  const sensitive = detectSensitiveIntent(userText);
  const firstTag = sensitive[0];
  if (firstTag !== undefined) return reasonForTag(firstTag);
  for (const { reason, re, unless } of TOPIC_TRIGGERS) {
    if (!re.test(userText)) continue;
    if (unless !== undefined && unless.test(userText)) continue;
    return reason;
  }
  return null;
}

/**
 * Copy fijo por motivo. Sin markdown, sin links: la salida del chatbot se renderiza como texto
 * plano (`ARCHITECTURE.md` §Seguridad de la vidriera y del chatbot).
 *
 * Ninguna de estas frases nombra el dato prohibido que la disparó. Decir *"no te puedo dar el
 * identificador"* ya es hablar del identificador; alcanza con derivar.
 */
export const HANDOFF_COPY: Readonly<Record<HandoffReason, string>> = {
  reserve: 'Las reservas las toma el vendedor directo. Escribile por WhatsApp y te la deja tomada.',
  payment: 'El detalle de pago lo cierra el vendedor por WhatsApp, así te confirma la forma que te sirva.',
  icloud: 'El estado de la cuenta del equipo te lo confirma el vendedor por WhatsApp antes de cerrar.',
  device_id: 'Ese dato del equipo te lo pasa el vendedor por WhatsApp, no lo publicamos en la vidriera.',
  shipping: 'Los envíos los arregla el vendedor caso por caso. Consultalo por WhatsApp.',
  trade_in: 'Para tomar tu equipo en parte de pago hay que verlo. Escribile por WhatsApp y lo cotiza.',
  sensitive: 'Eso lo maneja el vendedor. Escribile por WhatsApp y te responde él.',
  low_confidence: 'Prefiero no arriesgar un dato que no tengo. Preguntáselo al vendedor por WhatsApp.',
  out_of_scope: 'De eso no tengo dato en la ficha. El vendedor te lo responde por WhatsApp.',
  soft_cap: 'Por hoy no puedo seguir respondiendo acá. Seguí por WhatsApp, que te contestan igual.',
  provider_down: 'Se me cayó el asistente. Seguí por WhatsApp, que ahí te responden igual.',
  unsafe_output: 'Prefiero no responder eso por acá. Seguí por WhatsApp con el vendedor.',
  not_available: 'Este equipo no está disponible ahora mismo. Consultale al vendedor por WhatsApp.',
};

export interface HandoffResult {
  readonly reason: HandoffReason;
  /** Texto plano que ve el comprador. Nunca lo escribe el modelo. */
  readonly text: string;
  /** `https://wa.me/...` con el mensaje ya escrito. Sale del DTO: una sola fuente. */
  readonly waUrl: string;
  /** El mismo texto que lleva el botón de la ficha, sin encodear. */
  readonly waMessage: string;
}

/**
 * Arma el handoff. El `wa.me` **no se construye acá**: se toma del DTO, que ya lo armó con
 * `buildWaUrl`/`buildWaMessage` de `packages/domain`. Si el DTO viene sin él, es un bug del mapeo
 * y se prefiere fallar a mandar al comprador a un link roto.
 */
export function buildHandoff(listing: PublicListingDTO, reason: HandoffReason): HandoffResult {
  if (listing.waUrl.length === 0 || listing.waMessage.length === 0) {
    throw new AiError(
      'AI_INPUT_INVALID',
      'el DTO llegó sin `waUrl`/`waMessage`: el handoff no tiene a dónde derivar. ' +
        'El botón de WhatsApp es el producto; sin él no se contesta.',
    );
  }
  return {
    reason,
    text: HANDOFF_COPY[reason],
    waUrl: listing.waUrl,
    waMessage: listing.waMessage,
  };
}
