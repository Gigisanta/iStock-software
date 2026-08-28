/**
 * Precios por millón de tokens, para poder **medir** el costo del chatbot en vez de estimarlo.
 *
 * ## Esto no contradice "los IDs de modelo van por env"
 * La regla es que el código no puede **elegir** un modelo. Esta tabla no elige: traduce un ID que
 * ya vino de la env a su precio publicado. Un ID que no esté acá no rompe nada — devuelve `null` y
 * el reporte de costo dice "sin precio conocido", que es más honesto que inventar una tarifa.
 *
 * Fuente: `docs/research/llm-pricing.md` `[R3]`, consultado el 2026-08-27, páginas oficiales de
 * pricing de Gemini API y de Groq. Los precios de LLM se mueven; el que actualiza esta tabla
 * actualiza también la fecha de arriba y el número de `docs/CHATBOT.md`.
 *
 * **Ojo con dos trampas ya documentadas en R3:** el sucesor del primario *triplica* el costo
 * (thinking encendido y no apagable), y el reemplazo del fallback es un modelo de razonamiento que
 * factura los reasoning tokens como output. Los números de acá son de tarifa, no de consumo real:
 * el consumo real lo mide `pnpm --filter @istock/ai eval`.
 */

export interface TokenPrice {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
}

/** USD por millón de tokens. Clave = el string exacto de la API. */
export const PRICE_PER_MTOK: Readonly<Record<string, TokenPrice>> = {
  'gemini-2.5-flash-lite': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  'gemini-3.1-flash-lite': { inputPerMTok: 0.25, outputPerMTok: 1.5 },
  'gemini-3.5-flash-lite': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  'openai/gpt-oss-20b': { inputPerMTok: 0.075, outputPerMTok: 0.3 },
  'openai/gpt-oss-120b': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
};

export function priceFor(modelId: string): TokenPrice | null {
  return PRICE_PER_MTOK[modelId] ?? null;
}

/**
 * USD por 1000 mensajes, dado el consumo **medido** de tokens promedio.
 * `null` si no conocemos la tarifa del modelo: ausencia de medición no es cero.
 */
export function costPerThousandMessages(modelId: string, avgTokensIn: number, avgTokensOut: number): number | null {
  const price = priceFor(modelId);
  if (price === null) return null;
  const perMessage = (avgTokensIn / 1_000_000) * price.inputPerMTok + (avgTokensOut / 1_000_000) * price.outputPerMTok;
  return perMessage * 1000;
}
