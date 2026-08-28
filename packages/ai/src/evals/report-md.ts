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
    `tokens IN   p50 ${report.tokensIn.p50}  p95 ${report.tokensIn.p95}  max ${report.tokensIn.max}  (techo ${env.maxInputTokens})`,
    `tokens OUT  p50 ${report.tokensOut.p50}  p95 ${report.tokensOut.p95}  max ${report.tokensOut.max}  (techo ${env.maxOutputTokens})`,
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
 * Pisa el bloque entre marcadores. Tira si los marcadores no están: un README sin ellos es un
 * README que volvió a transcribirse a mano, y eso es lo que este módulo vino a evitar.
 */
export function replaceCostSection(markdown: string, section: string): string {
  const start = markdown.indexOf(COST_BLOCK_START);
  const end = markdown.indexOf(COST_BLOCK_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      'README.md no tiene los marcadores del bloque de costo medido. Sin ellos la eval no puede ' +
        'emitir la sección y los números vuelven a copiarse a mano, que es como envejecieron la ' +
        'última vez. Marcadores: eval:costo-medido:inicio / :fin.',
    );
  }
  return markdown.slice(0, start) + section + markdown.slice(end + COST_BLOCK_END.length);
}
