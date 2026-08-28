/**
 * `pnpm --filter @istock/ai eval` — el runner.
 *
 * Corre el corpus, imprime el consumo **medido** y sale distinto de cero si algo falla. No toca la
 * red, no necesita credenciales y no levanta ningún puerto: es un gate que puede correr en CI hoy,
 * con B4 abierto.
 *
 * El número que imprime al final es el que va a `docs/CHATBOT.md`. Lo escribe `docs-keeper`, no este
 * paquete: `docs/**` tiene otro dueño (`CLAUDE.md` §4).
 *
 * ## Además de imprimir, EMITE
 * Con la eval en verde, reescribe el bloque de costo medido de `README.md` entre marcadores. Ese
 * bloque estaba transcripto a mano y envejeció: el gate ahora es `pnpm eval && git diff
 * --exit-code`, sin ningún lint que tenga que volver a correr la eval para leer seis números.
 *
 * Escribe **sólo en verde**: los números de una eval en rojo no significan nada, y el `exit 1`
 * corta el `&&` antes del diff.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEval, runFallbackDrill, evalEnv, type CaseOutcome } from './harness';
import {
  renderCostSection,
  renderDietSection,
  replaceCostSection,
  replaceDietSection,
} from './report-md';

const README = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'README.md');

function money(value: number | null): string {
  return value === null ? 'sin tarifa conocida' : `USD ${value.toFixed(4)}`;
}

function printFailures(title: string, failed: readonly CaseOutcome[]): void {
  if (failed.length === 0) return;
  process.stdout.write(`\n${title}\n`);
  for (const outcome of failed) {
    process.stdout.write(`  ✗ ${outcome.id} [${outcome.shape}]\n`);
    for (const failure of outcome.failures) process.stdout.write(`      ${failure}\n`);
    // `answer: null` = el caso explotó y `runCase` lo pintó rojo en vez de voltear el runner. No hay
    // salida que mostrar, y escribir `""` haría pasar por "contestó vacío" a algo que no contestó.
    const salida = outcome.answer === null ? '(sin respuesta: el caso explotó)' : JSON.stringify(outcome.answer.text.slice(0, 160));
    process.stdout.write(`      salida: ${salida}\n`);
  }
}

async function main(): Promise<void> {
  const env = evalEnv();
  const report = await runEval(env);
  const drills = await runFallbackDrill(env);
  const drillsFailed = drills.filter((drill) => !drill.ok);

  const out = process.stdout;
  out.write('\n@istock/ai — eval offline (driver stub, sin red, sin credenciales)\n');
  out.write(`  primario: ${report.primaryModel}   fallback: ${report.fallbackModel}\n\n`);
  out.write(`  casos:            ${report.passed}/${report.total} verdes\n`);
  out.write(`  preguntas reales: ${report.realQuestions}\n`);
  out.write(`  drills fallback:  ${drills.length - drillsFailed.length}/${drills.length} verdes\n\n`);

  const billedPct = report.total === 0 ? 0 : Math.round((report.reachedModel / report.total) * 100);
  out.write(`  turnos que llegan al modelo: ${report.reachedModel}/${report.total} (${billedPct}%)\n`);
  out.write(`  el resto se deriva antes de llamar al proveedor y cuesta CERO.\n`);
  out.write(`  de los que llegan, ${report.withToolResult} pagan un prompt con resultado de tool adentro.\n\n`);
  out.write(`  tokens IN   p50 ${report.tokensIn.p50}  p95 ${report.tokensIn.p95}  max ${report.tokensIn.max}  (techo ${env.maxInputTokens})\n`);
  // Los dos caminos, separados: mezclados, el promedio esconde justo el que aprieta contra el techo.
  out.write(`    sin tool  p95 ${report.tokensInWithoutTool.p95}  max ${report.tokensInWithoutTool.max}\n`);
  // El margen contra el techo NO es salud: la escalera lo mantiene en ≥ 0 sola. La salud es cuánto
  // tuvo que tirar para llegar ahí, y eso se imprime abajo.
  out.write(`    con tool  p95 ${report.tokensInWithTool.p95}  max ${report.tokensInWithTool.max}  ← el camino real\n`);
  out.write(`  tokens OUT  p50 ${report.tokensOut.p50}  p95 ${report.tokensOut.p95}  max ${report.tokensOut.max}  (techo ${env.maxOutputTokens})\n\n`);
  // La cota de la dieta (máximo por turno) y la FACTURA (suma por turno) son dos preguntas
  // distintas: un turno con tool manda dos prompts y paga los dos.
  out.write(`  entrada FACTURADA por turno (suma, no máximo): avg ${report.billedTokensIn.avg}  p95 ${report.billedTokensIn.p95}  max ${report.billedTokensIn.max}\n`);
  const deg = report.degradation;
  out.write(`  degradación: ${deg.intact}/${deg.withPrompt} prompts armados sin tirar nada\n`);
  out.write(`    medios de pago ${deg.withPaymentMethodsDropped} · historial ${deg.withTurnsDropped} · chunks ${deg.withChunksDropped} · descripción ${deg.withDescriptionDropped}\n`);
  if (deg.worst !== null) {
    const w = deg.worst;
    out.write(
      `    peor turno: ${w.id} [${w.shape}] ${w.promptTokens} tokens — ${w.paymentMethodsDropped} medios, ` +
        `${w.turnsDropped} turnos, ${w.chunksDropped} chunks, descripción ${w.descriptionDropped ? 'fuera' : 'entera'}\n`,
    );
  }
  out.write('\n');
  out.write(`  costo /1000 mensajes facturados: ${money(report.costPerThousandBilled)}\n`);
  out.write(`  costo /1000 mensajes de vidriera: ${money(report.costPerThousandBlended)}  ← el número real\n`);

  printFailures('CASOS EN ROJO', report.failed);
  printFailures('DRILLS DE FALLBACK EN ROJO', drillsFailed);

  if (report.failed.length > 0 || drillsFailed.length > 0) {
    out.write('\nEVAL EN ROJO. El chatbot no sale así.\n');
    process.exitCode = 1;
    return;
  }
  const readme = readFileSync(README, 'utf8');
  // Dos bloques, una corrida, un solo `EvalReport`: la tabla de la dieta y el bloque de costo no
  // pueden discrepar porque salen del mismo objeto. Se escriben juntos o no se escribe ninguno.
  const updated = replaceDietSection(
    replaceCostSection(readme, renderCostSection(report, env)),
    renderDietSection(report, env),
  );
  if (updated !== readme) {
    writeFileSync(README, updated);
    out.write('\nREADME.md · bloques generados (costo medido + dieta) actualizados.\n');
  }

  out.write('\nEVAL VERDE.\n');
}

await main();
