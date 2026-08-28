/**
 * El puerto del proveedor, y el stub que lo ejerce sin red.
 *
 * ## Por qué hay un `interface` propio y no el SDK directo
 * **B4 (keys de Gemini y de Groq) es un bloqueo humano abierto.** Un diseño atado hoy a la forma de
 * un SDK que todavía no podemos ejercer es un diseño validado por nadie. Con este puerto, la dieta,
 * la cadena primario→fallback, el guard de salida y los evals se escriben y se testean **hoy**; el
 * día que B4 aterrice, cablear el Vercel AI SDK (`CLAUDE.md` §3) detrás de esta interfaz es una
 * slice chica y aislada, y ninguno de los tests de este paquete se entera.
 *
 * ## Lo que el puerto NO tiene, a propósito
 * - **No tiene `tenantId`.** El `tenant_id` no es argumento de ninguna tool ni de ninguna llamada:
 *   se inyecta server-side desde el host (`ARCHITECTURE.md` §Seguridad).
 * - **No tiene streaming.** Se puede agregar; hoy no hace falta y una API que nadie ejerce es una
 *   API que nadie mantiene.
 * - **No tiene `thinking` / `reasoning_effort`.** La dieta es *cero* thinking. Si el fallback lo
 *   necesita (el reemplazo de Groq es un modelo de razonamiento y factura los reasoning tokens como
 *   output, R3 §3), el adapter lo fija en su mínimo y no lo expone acá.
 */

import { AiError } from './errors';

/** Schema JSON mínimo de una tool. A mano y chico: cada campo se paga en tokens. */
export interface LlmToolParameters {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, { readonly type: string; readonly description: string }>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export interface LlmToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: LlmToolParameters;
}

export interface LlmMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface LlmToolCall {
  readonly name: string;
  /** Argumentos crudos. Se validan con Zod antes de ejecutar nada (`tools.ts`). */
  readonly args: unknown;
}

export interface LlmRequest {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly tools: readonly LlmToolSpec[];
  readonly signal?: AbortSignal | undefined;
}

export interface LlmResult {
  readonly text: string;
  readonly toolCalls: readonly LlmToolCall[];
  /** Tokens facturados. Si el proveedor no los reporta, el adapter estima con `countTokens`. */
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly model: string;
}

export interface LlmProvider {
  /** Identificador humano para logs y métricas. Nunca lleva la key adentro. */
  readonly id: string;
  generate(request: LlmRequest): Promise<LlmResult>;
}

/** Lo que un guion de stub puede devolver por turno. */
export type StubTurn = string | Partial<LlmResult> | Error;

export interface StubProviderOptions {
  readonly id?: string;
  /**
   * Guion. Si es un array se consume en orden y **se repite el último** cuando se agota, para que
   * un test que llama tres veces no tenga que escribir tres respuestas iguales.
   */
  readonly script: readonly StubTurn[] | ((request: LlmRequest) => StubTurn);
}

export interface StubProvider extends LlmProvider {
  /** Las requests que recibió, en orden. Los tests miran esto para auditar el prompt. */
  readonly calls: readonly LlmRequest[];
}

/**
 * Proveedor de mentira, determinista y sin red.
 *
 * En los evals se usa **en modo adversario**: se lo programa para intentar filtrar costo, decir
 * "disponible" sobre una unidad reservada o inventar un precio, y se afirma que el guard lo frena.
 * Un stub que sólo dice cosas correctas no prueba nada.
 */
export function createStubProvider(options: StubProviderOptions): StubProvider {
  const id = options.id ?? 'stub';
  const calls: LlmRequest[] = [];
  let index = 0;

  return {
    id,
    get calls() {
      return calls;
    },
    async generate(request: LlmRequest): Promise<LlmResult> {
      calls.push(request);
      const turn = Array.isArray(options.script)
        ? (options.script[Math.min(index++, options.script.length - 1)] ?? '')
        : (options.script as (req: LlmRequest) => StubTurn)(request);

      if (turn instanceof Error) throw turn;
      const partial: Partial<LlmResult> = typeof turn === 'string' ? { text: turn } : turn;
      return {
        text: partial.text ?? '',
        toolCalls: partial.toolCalls ?? [],
        tokensIn: partial.tokensIn ?? 0,
        tokensOut: partial.tokensOut ?? 0,
        model: partial.model ?? request.model,
      };
    },
  };
}

/** Proveedor que siempre falla. Es como se ejerce el camino del fallback, y del handoff final. */
export function createDownProvider(id: string, message = 'proveedor caído'): LlmProvider {
  return {
    id,
    generate(): Promise<LlmResult> {
      return Promise.reject(new AiError('AI_PROVIDER_FAILED', `${id}: ${message}`));
    },
  };
}
