/**
 * Los últimos 4 turnos, recortados.
 *
 * El chatbot **no tiene memoria persistente** (`ARCHITECTURE.md` §Seguridad): el historial lo manda
 * el cliente en cada request, así que es **entrada no confiable igual que la descripción del
 * dueño** — con el agravante de que acá el atacante escribe el 100% del texto. Por eso cada turno
 * pasa por `sanitizeDescription` antes de volver al prompt: un `system:` inyectado en el turno 1
 * no puede convertirse en instrucción en el turno 3.
 */

import { sanitizeDescription } from '@istock/domain';
import { MAX_HISTORY_TURNS } from './budget';
import { truncateToTokens } from './tokens';

/** Presupuesto por turno del historial, en tokens de nuestro contador. */
export const TURN_TOKEN_BUDGET = 45;
/** Presupuesto del mensaje que el comprador acaba de escribir. Más generoso: es la pregunta. */
export const USER_MESSAGE_TOKEN_BUDGET = 120;

export const CHAT_ROLES = ['user', 'assistant'] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export interface ChatTurn {
  readonly role: ChatRole;
  readonly content: string;
}

/**
 * Últimos `max` turnos, sanitizados y recortados. Los turnos vacíos después de sanitizar se
 * descartan: ocupar 4 lugares con `[filtrado]` es peor que llevar 2 turnos reales.
 */
export function trimTurns(
  turns: readonly ChatTurn[],
  options?: { readonly max?: number; readonly tokenBudget?: number },
): readonly ChatTurn[] {
  const max = options?.max ?? MAX_HISTORY_TURNS;
  const tokenBudget = options?.tokenBudget ?? TURN_TOKEN_BUDGET;
  if (max <= 0) return [];
  const out: ChatTurn[] = [];
  for (const turn of turns.slice(-max)) {
    const content = truncateToTokens(sanitizeDescription(turn.content, { maxLength: 600 }), tokenBudget);
    if (content.length === 0) continue;
    out.push({ role: turn.role, content });
  }
  return out;
}

/**
 * El mensaje actual del comprador, listo para el prompt.
 *
 * Ojo con el orden: la detección de handoff (`detectHandoffIntent`) corre sobre el texto **crudo**,
 * antes de esto. Sanitizar primero borraría las frases que hay que detectar y el jailbreak pasaría
 * a la etapa siguiente convertido en `[filtrado]`, que es indistinguible de una pregunta inocente.
 */
export function normalizeUserMessage(text: string): string {
  return truncateToTokens(sanitizeDescription(text, { maxLength: 800 }), USER_MESSAGE_TOKEN_BUDGET);
}
