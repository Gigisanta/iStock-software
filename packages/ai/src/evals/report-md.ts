/**
 * La sección de costo del README, **generada** a partir del reporte de la eval.
 *
 * ## Por qué existe este archivo
 * El bloque "Costo medido" del README estaba transcripto a mano y envejeció sin avisar: decía
 * `124/168` y `USD 0.079` de una corrida vieja del corpus, y de ahí salió un `USD 0,094/mes`
 * reportado como si fuera medición. El defecto no fue de quien lo copió: fue tener **dos fuentes
 * para un mismo número**, donde la segunda es siempre la vieja.
 *
 * La alternativa que se descartó fue un lint que corriera la eval para comparar seis números: un
 * gate de 30 segundos que sólo lee es un gate que se aprende a saltear. Acá la eval **emite** la
 * sección y el gate es `pnpm eval && git diff --exit-code`, que no corre nada de más.
 *
 * ## Requisito: determinismo
 * Esto sólo funciona porque la eval es determinista — driver stub, sin red, sin reloj, sin azar.
 * Verificado corriendo `pnpm eval` dos veces y diffeando la salida. El día que la eval dependa de
 * algo variable, este archivo miente y el gate empieza a fallar sin motivo.
 *
 * Los IDs de modelo van impresos en el bloque a propósito: el costo depende de la tarifa, así que
 * un diff espurio (otro modelo en la env) se explica solo al mirarlo.
 */

import type { AiEnv } from '../env';
import { SOFT_CAP_MESSAGES_PER_TENANT_PER_DAY } from '../entitlement';
import type { EvalReport } from './harness';

/** Marcadores del bloque generado. Lo de adentro lo pisa `pnpm eval`; lo de afuera se escribe a mano. */
export const COST_BLOCK_START = '<!-- eval:costo-medido:inicio · lo genera `pnpm --filter @istock/ai eval`, no lo edites a mano -->';
export const COST_BLOCK_END = '<!-- eval:costo-medido:fin -->';

/**
 * Marcadores de la **tabla de la dieta**, generada por el mismo motivo y en la misma corrida.
 *
 * La tabla estaba escrita a mano y decía `p95 1049` mientras el bloque generado, doce líneas más
 * abajo, decía `1078`: 29 tokens de diferencia entre el número **escrito** y el número **medido**,
 * en el mismo archivo. Es el defecto que este módulo ya había arreglado una vez, sobreviviendo en
 * la tabla de al lado — un número a mano al lado de uno generado vuelve a divergir, siempre, y el
 * que queda viejo es el de a mano.
 */
export const DIET_BLOCK_START = '<!-- eval:dieta:inicio · lo genera `pnpm --filter @istock/ai eval`, no lo edites a mano -->';
export const DIET_BLOCK_END = '<!-- eval:dieta:fin -->';

/** Días de un mes, para pasar de costo por mensaje a costo por tenant al tope del cap. */
const DAYS_PER_MONTH = 30;

/** `1.234` → `1,234`. El README escribe los números en prosa con coma decimal. */
function comma(text: string): string {
  return text.replace('.', ',');
}

export function renderCostSection(report: EvalReport, env: AiEnv): string {
  const billedPct = report.total === 0 ? 0 : Math.round((report.reachedModel / report.total) * 100);
  const blended = report.costPerThousandBlended;
  const billed = report.costPerThousandBilled;

  const lines: string[] = [
    COST_BLOCK_START,
    '',
    '```',
    `primario: ${env.primaryModel}   fallback: ${env.fallbackModel}`,
    `casos: ${report.passed}/${report.total} verdes   preguntas reales: ${report.realQuestions}`,
    '',
    `turnos que llegan al modelo: ${report.reachedModel}/${report.total} (${billedPct}%)   ← el resto se deriva antes y cuesta CERO`,
    `de esos, con resultado de tool adentro del prompt: ${report.withToolResult}`,
    `tokens IN   p50 ${report.tokensIn.p50}  p95 ${report.tokensIn.p95}  max ${report.tokensIn.max}  (techo ${env.maxInputTokens})`,
    `   sin tool  p95 ${report.tokensInWithoutTool.p95}  max ${report.tokensInWithoutTool.max}`,
    `   con tool  p95 ${report.tokensInWithTool.p95}  max ${report.tokensInWithTool.max}   ← el camino que el producto toma de verdad`,
    `tokens OUT  p50 ${report.tokensOut.p50}  p95 ${report.tokensOut.p95}  max ${report.tokensOut.max}  (techo ${env.maxOutputTokens})`,
    '',
    `entrada FACTURADA por turno (suma de las llamadas atendidas): avg ${report.billedTokensIn.avg}  p95 ${report.billedTokensIn.p95}  max ${report.billedTokensIn.max}`,
    `   ↑ la base del costo. NO es \`tokens IN\`, que es el máximo por turno y sirve para auditar la dieta.`,
    `degradación: ${report.degradation.intact}/${report.degradation.withPrompt} prompts armados sin tirar nada` +
      ` · medios de pago ${report.degradation.withPaymentMethodsDropped}` +
      ` · historial ${report.degradation.withTurnsDropped}` +
      ` · chunks ${report.degradation.withChunksDropped}` +
      ` · descripción ${report.degradation.withDescriptionDropped}`,
    '',
    `costo /1000 mensajes facturados:  ${billed === null ? 'sin tarifa conocida' : `USD ${billed.toFixed(4)}`}`,
    `costo /1000 mensajes de vidriera: ${blended === null ? 'sin tarifa conocida' : `USD ${blended.toFixed(4)}`}   ← el número real`,
    '```',
    '',
  ];

  if (blended === null) {
    lines.push(
      'No conocemos la tarifa del modelo primario configurado, así que no hay costo por mensaje.',
      'Ausencia de medición no es cero: se agrega el precio a `src/pricing.ts` y se vuelve a correr.',
    );
  } else {
    const perMessage = blended / 1000;
    const atCap = perMessage * SOFT_CAP_MESSAGES_PER_TENANT_PER_DAY * DAYS_PER_MONTH;
    lines.push(
      '| | |',
      '|---|---|',
      `| costo por mensaje de vidriera | USD ${comma(perMessage.toFixed(8))} |`,
      `| un tenant al tope del soft cap | ${SOFT_CAP_MESSAGES_PER_TENANT_PER_DAY} msg/día × ${DAYS_PER_MONTH} días × USD ${comma(perMessage.toFixed(8))} = **USD ${comma(atCap.toFixed(4))}/mes** |`,
    );
  }

  lines.push('', COST_BLOCK_END);
  return lines.join('\n');
}

/**
 * La tabla de la dieta. Los techos son constantes de `budget.ts` vía `env`; las columnas "medido"
 * salen del mismo `EvalReport` que el bloque de costo, así que no pueden divergir de él.
 *
 * ## Por qué son DOS columnas y no una
 * Porque un turno con tool paga el prompt dos veces y la segunda lleva el digest adentro: es el
 * prompt más largo del ciclo. Hasta el 2026-08-28 el corpus no tenía ninguna llamada a tool, así
 * que la única columna publicada era la del camino corto — el techo del caso que el producto casi
 * no toma, publicado como si fuera el techo. Un p95 solo, mezclando los dos, sería peor todavía:
 * esconde justo el que aprieta.
 *
 * ## Por qué el "margen contra el techo" dejó de ser el número de salud (2026-08-28)
 * Porque desde que hay escalera de degradación, **el margen es ≥ 0 por construcción**: la dieta
 * recorta hasta entrar o tira `AI_BUDGET_EXCEEDED`, así que un `max` de exactamente 1200 no dice
 * "justo justo entró", dice "entró después de tirar cosas". Publicar el margen como salud sería
 * publicar una tautología, y peor: una tranquilizadora, porque el día que la ficha crezca el margen
 * va a seguir dando 0 mientras por debajo se muere el historial entero.
 *
 * El número que sí informa es **cuánto tuvo que tirar**, y por eso el bloque publica la
 * degradación y el peor turno con nombre y apellido. Se genera, como todo lo demás acá: escrito a
 * mano sería el próximo `1049` de este archivo.
 */
export function renderDietSection(report: EvalReport, env: AiEnv): string {
  const deg = report.degradation;
  const worst = deg.worst;
  return [
    DIET_BLOCK_START,
    '',
    '| | techo | medido p95, sin tool | medido p95, con tool |',
    '|---|---|---|---|',
    `| entrada | **${env.maxInputTokens}** tokens | ${report.tokensInWithoutTool.p95} | ${report.tokensInWithTool.p95} |`,
    `| salida | **${env.maxOutputTokens}** tokens | ${report.tokensOut.p95} | ${report.tokensOut.p95} |`,
    `| temperature | ${env.temperature} | fijo, no configurable | ídem |`,
    '| thinking / reasoning | cero | el puerto ni siquiera expone la perilla | ídem |',
    '',
    `Turnos con tool en el corpus: **${report.toolCases} casos** × 2 formas de conversación, ` +
      `${report.withToolResult} de ellos con el resultado adentro del prompt medido. ` +
      `El peor caso con tool mide **${report.tokensInWithTool.max} tokens** contra el techo de ` +
      `${env.maxInputTokens}.`,
    '',
    `**El margen contra el techo no es la métrica de salud: la escalera de degradación lo mantiene ` +
      `en ≥ 0 sola.** La métrica es cuánto hubo que tirar para llegar ahí: **${deg.intact} de ` +
      `${deg.withPrompt}** prompts armados entraron sin recortar nada. Los que sí recortaron: ` +
      `${deg.withPaymentMethodsDropped} perdieron medios de pago, ${deg.withTurnsDropped} historial, ` +
      `${deg.withChunksDropped} chunks, ${deg.withDescriptionDropped} la descripción.`,
    '',
    worst === null
      ? 'Ningún turno del corpus necesitó degradar.'
      : `Peor turno medido: **\`${worst.id}\`** (${worst.shape}), ${worst.promptTokens} tokens tras tirar ` +
        `${worst.paymentMethodsDropped} medios de pago, ${worst.turnsDropped} turnos de historial y ` +
        `${worst.chunksDropped} chunks; la descripción ${worst.descriptionDropped ? 'no entró' : 'entró entera'}. ` +
        'Es la ficha del **plan Negocio** (3 puntos de retiro, 6 medios de pago, descripción al tope): ' +
        'no es una ficha patológica, es la que el plan de USD 35 vende. Los 3 puntos de retiro ' +
        'sobreviven a la degradación por diseño — son el dato por el que ese tenant paga.',
    '',
    DIET_BLOCK_END,
  ].join('\n');
}

/**
 * Los límites del bloque en el markdown, marcadores incluidos. Tira si no están: un README sin
 * ellos es un README que volvió a transcribirse a mano, y eso es lo que este módulo vino a evitar.
 */
function blockBounds(
  markdown: string,
  startMark: string,
  endMark: string,
  what: string,
): { readonly start: number; readonly end: number } {
  const start = markdown.indexOf(startMark);
  const end = markdown.indexOf(endMark);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `README.md no tiene los marcadores del bloque de ${what}. Sin ellos la eval no puede emitir ` +
        'la sección y los números vuelven a copiarse a mano, que es como envejecieron la última ' +
        `vez. Marcadores: ${startMark} / ${endMark}.`,
    );
  }
  return { start, end: end + endMark.length };
}

/** Pisa el bloque entre marcadores. */
function replaceBlock(markdown: string, startMark: string, endMark: string, section: string, what: string): string {
  const bounds = blockBounds(markdown, startMark, endMark, what);
  return markdown.slice(0, bounds.start) + section + markdown.slice(bounds.end);
}

/**
 * Devuelve el bloque **tal como está hoy en el README**, marcadores incluidos.
 *
 * Existe para que el gate pueda afirmar sobre el bloque y no sobre el archivo entero. La primera
 * versión comparaba los dos README completos con `Object.is`, y cuando alguien adulteraba una fila
 * de la tabla el fallo imprimía dos strings de 7 KB truncados en el mismo prefijo:
 *
 * ```
 * AssertionError: expected '# `@istock/ai`\n\nEl chatbot de la vi…' to be '# `@istock/ai`\n\nEl chatbot de la vi…'
 * ```
 *
 * O sea: encendía sin poder nombrar la causa, que es medio gate. Comparando **este** recorte —y
 * línea por línea— el diff apunta a la fila que se movió. Comparte `blockBounds` con
 * `replaceBlock` a propósito: si el extractor y el reemplazador encontraran el bloque de dos
 * formas distintas, el gate estaría auditando un texto que la eval nunca escribe.
 */
function extractBlock(markdown: string, startMark: string, endMark: string, what: string): string {
  const bounds = blockBounds(markdown, startMark, endMark, what);
  return markdown.slice(bounds.start, bounds.end);
}

export function replaceCostSection(markdown: string, section: string): string {
  return replaceBlock(markdown, COST_BLOCK_START, COST_BLOCK_END, section, 'costo medido');
}

export function replaceDietSection(markdown: string, section: string): string {
  return replaceBlock(markdown, DIET_BLOCK_START, DIET_BLOCK_END, section, 'la dieta');
}

export function extractCostSection(markdown: string): string {
  return extractBlock(markdown, COST_BLOCK_START, COST_BLOCK_END, 'costo medido');
}

export function extractDietSection(markdown: string): string {
  return extractBlock(markdown, DIET_BLOCK_START, DIET_BLOCK_END, 'la dieta');
}
