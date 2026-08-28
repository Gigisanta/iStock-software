/**
 * Las tres tools. Ni una más.
 *
 * `docs/CHATBOT.md` §Tools: `get_open_listing`, `search_listings`, `handoff_whatsapp`.
 * `tools.test.ts` afirma que son **exactamente** esas tres: agregar una cuarta rompe el test antes
 * de romper la factura.
 *
 * ## `tenant_id` no es argumento de ninguna tool
 * `ARCHITECTURE.md` §Seguridad, textual. El tenant se inyecta server-side cuando se construye el
 * `SearchPort`, y por eso el puerto recibe `query` y `limit` y nada más. Un modelo al que se le
 * puede pasar un `tenantId` es un modelo al que se le puede *pedir* que pase otro, y el aislamiento
 * entre tenants dejaría de depender de RLS para depender de un prompt.
 *
 * ## Las tools no escriben
 * Ninguna muta nada. No hay reservar, no hay marcar vendido, no hay tomar datos del comprador.
 * Reservar y pagar son **handoff obligatorio**, no una tool.
 */

import { z } from 'zod';
import { isPubliclyVisible, sanitizeDescription, sanitizeForPrompt, type PublicListingDTO, type PublicStatus } from '@istock/domain';
import { MAX_SEARCH_RESULTS } from './budget';
import { AiError } from './errors';
import { AVAILABILITY_TEXT, NAME_MAX_LENGTH, SELLER_BLOCK_MAX_LENGTH, listingPromptView, renderListingDigest } from './listing-view';
import { MODEL_HANDOFF_REASONS, type ModelHandoffReason } from './handoff';
import type { LlmToolCall, LlmToolSpec } from './provider';
import { countTokens } from './tokens';

export const TOOL_NAMES = ['get_open_listing', 'search_listings', 'handoff_whatsapp'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Campos mínimos de un resultado de búsqueda. No hay DTO completo acá: son 5 filas, no 5 fichas. */
export interface SearchHit {
  readonly slug: string;
  readonly title: string;
  readonly priceUsdFormatted: string;
  readonly status: PublicStatus;
}

/**
 * Puerto de búsqueda. **Se construye con el tenant ya atado**: por eso no hay `tenantId` en la
 * firma. El `limit` llega igual desde acá para que el techo de 5 no dependa de que el
 * implementador se acuerde.
 */
export interface SearchPort {
  search(query: string, limit: number): Promise<readonly SearchHit[]>;
}

export const toolSchemas = {
  get_open_listing: z.strictObject({}),
  search_listings: z.strictObject({
    query: z.string().trim().min(2).max(80),
  }),
  handoff_whatsapp: z.strictObject({
    reason: z.enum(MODEL_HANDOFF_REASONS),
  }),
} as const;

/**
 * Specs que van adentro del prompt.
 *
 * **Las descripciones están escritas al hueso y eso no es prolijidad: es presupuesto.** El schema
 * de las tools viaja serializado en cada request y se factura como input igual que el system
 * (`budget.ts`, `toolTokens`). Con las descripciones de manual que tenía la primera versión, las
 * tres tools medían ~376 tokens de un techo de 1200 — un tercio de la dieta gastado en explicarle
 * al modelo tres funciones que ya están explicadas en el system. El andamiaje JSON solo
 * (`name`/`parameters`/`additionalProperties`) ya cuesta ~200 y ése es el piso real de tener tools;
 * lo que se podía recortar era la prosa, y se recortó.
 *
 * `search_listings` **no lleva `limit` en el schema**: el techo de 5 lo pone el servidor, no el
 * modelo. Un parámetro que el modelo puede subir no es un techo, es una sugerencia — y encima se
 * paga en tokens cada turno para tener menos garantías.
 */
export const TOOL_SPECS: readonly LlmToolSpec[] = [
  {
    name: 'get_open_listing',
    description: 'Datos de la ficha abierta.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'search_listings',
    description: 'Otros equipos de esta tienda. Devuelve hasta 5.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Qué busca, en pocas palabras.' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'handoff_whatsapp',
    description: 'Deriva al vendedor y corta.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: MODEL_HANDOFF_REASONS.join('|') },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
];

/**
 * Andamiaje por tool que el proveedor factura además del texto: el nombre de la función, los tipos,
 * las llaves del schema y el separador del bloque. 20 es el valor que usa la contabilidad publicada
 * de las APIs compatibles con OpenAI (12–16 en la práctica), redondeado para arriba.
 */
const TOOL_SCHEMA_OVERHEAD_TOKENS = 20;
/** Andamiaje del bloque de tools en sí, una sola vez. */
const TOOLS_BLOCK_OVERHEAD_TOKENS = 16;

/**
 * Lo que **cuesta** declarar las tres tools, para que la dieta lo cuente (`budget.ts`).
 *
 * Se mide sobre una forma de declaración compacta y **no sobre `JSON.stringify(TOOL_SPECS)`**, y la
 * diferencia importa: el JSON literal mide 317 tokens con nuestro contador contra ~120 reales,
 * porque es casi todo `":{,}` y el estimador cobra la puntuación cara a propósito. Contar el JSON
 * habría metido ~200 tokens fantasma en un techo de 1200 y el precio no lo habría pagado el
 * proveedor: lo habría pagado el comprador, en chunks y en historial recortados para hacerle lugar
 * a algo que no existe. Ninguno de los dos proveedores manda ese JSON tal cual, además — Gemini
 * arma un `FunctionDeclaration` y Groq rinde el schema a su propio formato.
 *
 * El andamiaje sí se cobra, sumado aparte y redondeado para arriba, así el número sigue siendo un
 * techo. Cuando B4 aterrice, esto se contrasta contra el `usage` real que reporta cada proveedor.
 */
export function toolBudgetTokens(specs: readonly LlmToolSpec[] = TOOL_SPECS): number {
  const declaration = specs
    .map((spec) => {
      const params = Object.entries(spec.parameters.properties)
        .map(([name, prop]) => `${name}:${prop.type} ${prop.description}`)
        .join(' ');
      return `${spec.name}(${params}) ${spec.description}`;
    })
    .join('\n');
  return countTokens(declaration) + specs.length * TOOL_SCHEMA_OVERHEAD_TOKENS + TOOLS_BLOCK_OVERHEAD_TOKENS;
}

export type ToolOutcome =
  | { readonly kind: 'data'; readonly name: ToolName; readonly content: string }
  | { readonly kind: 'handoff'; readonly reason: ModelHandoffReason };

export interface ToolRuntime {
  readonly specs: readonly LlmToolSpec[];
  run(call: LlmToolCall): Promise<ToolOutcome>;
}

function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}

/**
 * `available` → texto neutro; `reserved`/`sold` → la frase negativa completa.
 *
 * **El `title` es texto libre del dueño y sale sanitizado**, igual que en `listing-view.ts`. Acá el
 * caso es incluso peor que en la ficha abierta: son títulos de equipos que el visitante **no
 * abrió**, así que la superficie es todo el stock publicado del tenant y no una fila elegida.
 * `slug` no se emite —el modelo no puede armar links y la salida se renderiza en texto plano—.
 */
function hitLine(hit: SearchHit): string {
  const state = hit.status === 'available' ? 'disponible' : AVAILABILITY_TEXT[hit.status];
  const title = sanitizeDescription(hit.title, { maxLength: NAME_MAX_LENGTH }).replace(/\s+/gu, ' ').trim();
  return `${title.length === 0 ? '(sin nombre)' : title} — ${hit.priceUsdFormatted} — ${state}`;
}

export interface ToolRuntimeDeps {
  readonly listing: PublicListingDTO;
  /** Ausente = `search_listings` responde "no hay búsqueda disponible" en vez de romper. */
  readonly search?: SearchPort | undefined;
}

/**
 * Ejecuta una tool call del modelo. **Valida con Zod antes de tocar nada**: los argumentos vienen
 * de un LLM, que es la definición de borde no confiable, y `strictObject` hace que un argumento de
 * más (por ejemplo un `tenantId` que el modelo se inventó) sea un error y no un campo ignorado.
 */
export function createToolRuntime(deps: ToolRuntimeDeps): ToolRuntime {
  return {
    specs: TOOL_SPECS,
    async run(call: LlmToolCall): Promise<ToolOutcome> {
      if (!isToolName(call.name)) {
        throw new AiError(
          'AI_INPUT_INVALID',
          `tool desconocida: "${call.name}". Las únicas son ${TOOL_NAMES.join(', ')}.`,
        );
      }
      switch (call.name) {
        case 'get_open_listing': {
          toolSchemas.get_open_listing.parse(call.args ?? {});
          return { kind: 'data', name: 'get_open_listing', content: renderListingDigest(listingPromptView(deps.listing)) };
        }
        case 'search_listings': {
          const { query } = toolSchemas.search_listings.parse(call.args);
          if (deps.search === undefined) {
            return { kind: 'data', name: 'search_listings', content: 'No hay búsqueda disponible en esta vidriera.' };
          }
          const hits = await deps.search.search(query, MAX_SEARCH_RESULTS);
          // Doble techo a propósito: el puerto recibe el límite y el resultado se vuelve a cortar.
          // Un puerto que devuelve 40 filas no puede inflar el prompt del turno siguiente.
          const usable = hits.filter((hit) => isPubliclyVisible(hit.status)).slice(0, MAX_SEARCH_RESULTS);
          // Un envoltorio para las cinco filas, no uno por fila: la misma decisión de costo que
          // toma `renderListingBlock`, por el mismo motivo (30 tokens cada `sanitizeForPrompt`).
          const content =
            usable.length === 0
              ? 'No hay otros equipos publicados que coincidan.'
              : sanitizeForPrompt(usable.map(hitLine).join('\n'), { maxLength: SELLER_BLOCK_MAX_LENGTH });
          return { kind: 'data', name: 'search_listings', content };
        }
        case 'handoff_whatsapp': {
          const { reason } = toolSchemas.handoff_whatsapp.parse(call.args);
          return { kind: 'handoff', reason };
        }
        default: {
          const never: never = call.name;
          throw new AiError('AI_INPUT_INVALID', `tool no contemplada: ${String(never)}`);
        }
      }
    },
  };
}
