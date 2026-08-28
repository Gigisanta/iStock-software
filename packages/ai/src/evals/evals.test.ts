/**
 * La eval, también como test — para que `pnpm --filter @istock/ai test` sea rojo si el prompt
 * afloja, sin depender de que alguien se acuerde de correr el runner.
 *
 * El runner (`run.ts`) existe igual y no es redundante: imprime el consumo medido, que es lo que
 * `docs-keeper` necesita para `docs/CHATBOT.md` y lo que un test no muestra.
 */

import { describe, expect, it } from 'vitest';
import { EVAL_CASES, REAL_QUESTION_COUNT, TOOL_CASE_COUNT } from './cases.eval';
import { evalEnv, runCase, runEval, runFallbackDrill } from './harness';
import {
  COST_BLOCK_END,
  COST_BLOCK_START,
  DIET_BLOCK_END,
  DIET_BLOCK_START,
  extractCostSection,
  extractDietSection,
  renderCostSection,
  renderDietSection,
  replaceCostSection,
  replaceDietSection,
} from './report-md';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS } from '../budget';
import { costPerThousandMessages } from '../pricing';

const env = evalEnv();

/** Cuántas veces aparece `needle` en `haystack`. Para contar marcadores, que tienen que ser únicos. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const MARCADOR_DUPLICADO =
  'el marcador del bloque generado no aparece exactamente una vez en README.md: con dos pares de ' +
  'marcadores la eval regenera el primero y el otro queda envejeciendo, que es la misma "dos ' +
  'fuentes para un número" que este bloque vino a evitar';

describe('corpus', () => {
  it('trae las 50 preguntas reales que pide la aceptación', () => {
    expect(REAL_QUESTION_COUNT).toBe(50);
  });

  it('trae jailbreaks de costo y de identificador, y el caso reserved', () => {
    const ids = EVAL_CASES.map((kase) => kase.id);
    expect(ids.filter((id) => id.startsWith('jc')).length).toBeGreaterThanOrEqual(3);
    expect(ids.filter((id) => id.startsWith('ji')).length).toBeGreaterThanOrEqual(3);
    expect(ids.filter((id) => id.startsWith('r')).length).toBeGreaterThanOrEqual(1);
  });

  /**
   * El corpus tenia CERO llamadas a tool hasta el 2026-08-28, asi que no ejercitaba el digest: el
   * `p95` publicado era el del prompt corto, o sea el techo del camino que el producto casi no
   * toma. El chatbot existe para llamar a `get_open_listing`.
   */
  it('trae turnos con tool, que son el camino que el producto toma de verdad', () => {
    expect(TOOL_CASE_COUNT).toBeGreaterThanOrEqual(10);
    const conTool = EVAL_CASES.filter((kase) => kase.toolCall !== undefined);
    expect(conTool.length).toBe(TOOL_CASE_COUNT);
    // Las tres tools, ejercidas desde el corpus y no solo desde `tools.test.ts`.
    for (const name of ['get_open_listing', 'search_listings', 'handoff_whatsapp']) {
      expect(conTool.filter((kase) => kase.toolCall?.name === name).length).toBeGreaterThanOrEqual(1);
    }
    // Y una tool call basura: los argumentos los escribe un LLM.
    expect(conTool.some((kase) => kase.expect.kind === 'handoff' && kase.expect.reason === 'low_confidence')).toBe(true);
  });

  it('no tiene ids repetidos', () => {
    const ids = EVAL_CASES.map((kase) => kase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('cada caso, uno por uno', () => {
  it.each(EVAL_CASES.map((kase) => ({ id: kase.id, kase })))('$id', async ({ kase }) => {
    const outcome = await runCase(kase, env);
    expect(outcome.failures).toEqual([]);
  });
});

describe('el corpus entero', () => {
  it('pasa en las dos formas de conversación', async () => {
    const report = await runEval(env);
    expect(report.failed.map((outcome) => `${outcome.id}: ${outcome.failures.join(' · ')}`)).toEqual([]);
    expect(report.passed).toBe(report.total);
  });

  it('mide la dieta: ni un solo turno se pasa de 1200 de entrada ni de 180 de salida', async () => {
    const report = await runEval(env);
    expect(report.tokensIn.max).toBeLessThanOrEqual(MAX_INPUT_TOKENS);
    expect(report.tokensOut.max).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
  });

  /**
   * El p95 con tool es el numero que aprieta. Publicarlo mezclado con el corto lo bajaria con
   * turnos que nunca pagaron el digest, que es exactamente la forma de maquillarlo.
   */
  it('mide el camino con tool por separado, y es MAS caro que el corto', async () => {
    const report = await runEval(env);
    expect(report.withToolResult).toBeGreaterThan(0);
    expect(report.withToolResult).toBeLessThan(report.reachedModel);
    expect(report.tokensInWithTool.p95).toBeGreaterThan(report.tokensInWithoutTool.p95);
    // El techo se asserta contra el camino caro, no contra el promedio.
    expect(report.tokensInWithTool.max).toBeLessThanOrEqual(MAX_INPUT_TOKENS);
  });

  it('deriva una parte de los turnos sin llegar al modelo, y eso abarata el promedio', async () => {
    const report = await runEval(env);
    expect(report.reachedModel).toBeLessThan(report.total);
    expect(report.costPerThousandBlended).not.toBeNull();
    expect(report.costPerThousandBilled).not.toBeNull();
    expect(report.costPerThousandBlended!).toBeLessThan(report.costPerThousandBilled!);
  });

  it('cuesta menos de USD 0,25 por 1000 mensajes', async () => {
    const report = await runEval(env);
    expect(report.costPerThousandBlended!).toBeLessThan(0.25);
  });
});

/**
 * ## El modo de falla que la eval no sabía reportar
 *
 * `runCase` prometía en su docblock que nunca tira, y no era cierto: `answerChat` estaba fuera de
 * todo `try`. Con el margen contra el techo apretado eso dejó de ser teórico — un
 * `AI_BUDGET_EXCEEDED` en la ronda de tool volteaba el runner entero, así que el único fallo que
 * esta eval existe para atrapar era el único que no sabía **reportar**: en vez de un caso rojo con
 * su motivo, un stack trace y cero información sobre los otros 205 casos.
 */
describe('un caso que explota es un caso rojo, no un runner muerto', () => {
  it('devuelve el veredicto en rojo con el código del error, en vez de propagar', async () => {
    // Un techo de 40 tokens hace imposible cualquier prompt: es el piso de `context.ts` disparando.
    const imposible = { ...env, maxInputTokens: 40 };
    const outcome = await runCase(EVAL_CASES[0]!, imposible);
    expect(outcome.ok).toBe(false);
    expect(outcome.failures.join(' ')).toContain('AI_BUDGET_EXCEEDED');
    // Y no inventa una respuesta que nunca existió.
    expect(outcome.answer).toBeNull();
  });

  it('el corpus entero sobrevive a una dieta imposible: 206 casos rojos, cero excepciones', async () => {
    const imposible = { ...env, maxInputTokens: 40 };
    const outcomes = await Promise.all(EVAL_CASES.map(async (kase) => runCase(kase, imposible)));
    expect(outcomes).toHaveLength(EVAL_CASES.length);
    // Alguno se deriva antes de armar prompt (handoff por intención) y sigue verde; lo que importa
    // es que ninguno haya tirado. Si esto se rompe, se rompe tirando.
    expect(outcomes.filter((outcome) => !outcome.ok).length).toBeGreaterThan(0);
  });
});

/**
 * `promptMustContain` es la única aserción del corpus que mira **la entrada** y no la salida. Hace
 * falta porque con el proveedor stubbeado la respuesta está guionada: la dieta podría tirar los 3
 * puntos de retiro del plan Negocio y los 206 casos seguirían verdes. Un eval que sólo mira la
 * salida no puede auditar lo que la degradación se llevó.
 */
describe('lo que la dieta tiene PROHIBIDO recortar', () => {
  it('los casos del plan Negocio exigen el tercer punto de retiro en el prompt', () => {
    const negocio = EVAL_CASES.filter((kase) => kase.listing === 'negocio');
    expect(negocio.length).toBeGreaterThanOrEqual(4);
    for (const kase of negocio) expect(kase.promptMustContain).toContain('General Roca');
  });

  it('y la aserción ENCIENDE: pedir algo que el prompt no dice pone el caso en rojo', async () => {
    // Control negativo. Sin esto, `promptMustContain` podría estar comparando contra vacío y todo
    // pasaría igual — que es la forma en la que un invariante nuevo nace inútil.
    const kase = EVAL_CASES.find((k) => k.listing === 'negocio' && k.toolCall !== undefined)!;
    const outcome = await runCase({ ...kase, promptMustContain: ['Bariloche'] }, env);
    expect(outcome.ok).toBe(false);
    expect(outcome.failures.join(' ')).toContain('Bariloche');
  });
});

/**
 * La degradación es el número de salud desde que hay escalera: el margen contra el techo lo
 * mantiene la escalera en `>= 0` sola, así que no informa nada.
 */
describe('la degradación se mide y se publica', () => {
  it('el peor turno del corpus es la ficha del plan Negocio, y gasta el escalón de medios de pago', async () => {
    const report = await runEval(env);
    const worst = report.degradation.worst;
    expect(worst).not.toBeNull();
    expect(worst!.id.startsWith('n')).toBe(true);
    expect(worst!.paymentMethodsDropped).toBeGreaterThan(0);
  });

  it('la descripción del dueño no se pierde en ningún turno del corpus', async () => {
    const report = await runEval(env);
    // Es el último escalón de la escalera. Si empieza a caerse, la dieta se quedó sin margen y el
    // chatbot dejó de poder contestar sobre lo que el dueño escribió.
    expect(report.degradation.withDescriptionDropped).toBe(0);
  });

  it('la mayoría de los turnos entra sin recortar nada: degradar es la excepción, no el default', async () => {
    const report = await runEval(env);
    expect(report.degradation.withPrompt).toBeGreaterThan(0);
    expect(report.degradation.intact / report.degradation.withPrompt).toBeGreaterThan(0.8);
  });
});

/**
 * ## C8: la cota de la dieta no es la factura
 *
 * `promptTokens` es el **máximo** de los prompts de un turno y así tiene que quedarse: es lo que se
 * audita contra los 1200. Pero la factura es la **suma**, y usar el máximo subfacturaba el turno
 * con tool 2,16× y el corpus ~11,8%.
 */
describe('el costo publicado sale de lo facturado, no de la cota de la dieta', () => {
  it('la entrada facturada promedio es MAYOR que la cota promedio: si no, alguien volvió al máximo', async () => {
    const report = await runEval(env);
    expect(report.billedTokensIn.avg).toBeGreaterThan(report.tokensIn.avg);
    // Y el máximo facturado supera el techo de la dieta sin que eso sea un fallo: son dos prompts.
    expect(report.billedTokensIn.max).toBeGreaterThan(MAX_INPUT_TOKENS);
  });

  it('el costo publicado se recalcula desde la entrada facturada', async () => {
    const report = await runEval(env);
    const desdeLaCota = costPerThousandMessages(env.primaryModel, report.tokensIn.avg, report.tokensOut.avg);
    expect(report.costPerThousandBilled).not.toBeNull();
    // Si estos dos coincidieran, el costo habría vuelto a salir del número equivocado.
    expect(report.costPerThousandBilled!).toBeGreaterThan(desdeLaCota!);
  });
});

describe('fallback', () => {
  it('contesta con el fallback cuando el primario cae, y deriva cuando caen los dos', async () => {
    const drills = await runFallbackDrill(env);
    expect(drills.filter((drill) => !drill.ok)).toEqual([]);
    expect(drills).toHaveLength(2);
  });
});

describe('la env de la eval', () => {
  it('fuerza el driver stub: la eval no puede convertirse en una llamada facturada', () => {
    expect(env.driver).toBe('stub');
  });

  it('toma los IDs de modelo de la env o de .env.example, nunca de una constante', () => {
    expect(env.primaryModel.length).toBeGreaterThan(0);
    expect(env.fallbackModel.length).toBeGreaterThan(0);
    expect(env.primaryModel).not.toBe(env.fallbackModel);
  });
});


/**
 * El bloque de costo del README lo **emite** la eval; no se transcribe. Antes se copiaba a mano y
 * envejeció en silencio (`124/168`, `USD 0.079`), y de ahí salió un costo mal reportado. El gate de
 * verdad es `pnpm eval && git diff --exit-code`; esto es el mismo invariante en 200 ms, para que el
 * defecto se vea en `pnpm test` y no recién en CI.
 */
describe('el bloque de costo del README se genera', () => {
  const README = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'README.md');

  it('el README tiene los marcadores y su contenido es exactamente el que emite la eval', async () => {
    const env = evalEnv();
    const readme = readFileSync(README, 'utf8');
    expect(readme).toContain(COST_BLOCK_START);
    expect(readme).toContain(COST_BLOCK_END);
    const emitido = renderCostSection(await runEval(env), env);
    // Fila por fila sobre el bloque EXTRAIDO, no el README entero: asi el diff nombra la linea que
    // se movio. Comparar los dos archivos con `toBe` imprimia dos strings de 7 KB truncados en el
    // mismo prefijo, o sea un gate que enciende sin poder decir por que.
    expect(
      extractCostSection(readme).split('\n'),
      'una fila del bloque de costo del README no coincide con lo que emite la eval; corre `pnpm --filter @istock/ai eval`',
    ).toEqual(emitido.split('\n'));
    // Segunda afirmacion, con su propio motivo. **No es `replaceCostSection(readme, emitido) ===
    // readme`**: eso es cierto por construccion apenas pasa la de arriba —`extractBlock` y
    // `replaceBlock` comparten `blockBounds`, asi que si el recorte coincide el reemplazo es la
    // identidad— y una asercion que no puede fallar es un adorno.
    //
    // Lo que si puede fallar, y es el modo real: alguien **duplica** el bloque. `blockBounds` usa
    // `indexOf`, se queda con el primer par de marcadores, la eval regenera ESE, y la segunda copia
    // envejece sin que nada la mire. O sea dos fuentes para un numero, que es exactamente el
    // defecto que este modulo vino a matar, reaparecido un nivel mas arriba.
    expect(occurrences(readme, COST_BLOCK_START), MARCADOR_DUPLICADO).toBe(1);
    expect(occurrences(readme, COST_BLOCK_END), MARCADOR_DUPLICADO).toBe(1);
  });

  it('emite los números derivados, no sólo la salida cruda: por mensaje y por tenant al tope', async () => {
    const env = evalEnv();
    const report = await runEval(env);
    const section = renderCostSection(report, env);
    const blended = report.costPerThousandBlended;
    expect(blended).not.toBeNull();
    // El costo por mensaje es el mezclado dividido 1000, y el mensual es ése × 40 × 30.
    expect(section).toContain((blended! / 1000).toFixed(8).replace('.', ','));
    expect(section).toContain(((blended! / 1000) * 40 * 30).toFixed(4).replace('.', ','));
  });

  it('es determinista: dos renders del mismo reporte son idénticos byte a byte', async () => {
    const env = evalEnv();
    const report = await runEval(env);
    expect(renderCostSection(report, env)).toBe(renderCostSection(report, env));
  });

  it('sin marcadores tira, en vez de dejar el README transcripto a mano', () => {
    expect(() => replaceCostSection('# README sin marcadores\n', 'x')).toThrowError(/marcadores/u);
  });

  it('reemplaza sólo lo de adentro y no toca el texto escrito a mano alrededor', () => {
    const doc = `antes\n${COST_BLOCK_START}\nviejo\n${COST_BLOCK_END}\ndespués`;
    const out = replaceCostSection(doc, `${COST_BLOCK_START}\nnuevo\n${COST_BLOCK_END}`);
    expect(out).toBe(`antes\n${COST_BLOCK_START}\nnuevo\n${COST_BLOCK_END}\ndespués`);
    expect(out).not.toContain('viejo');
  });
});

/**
 * Lo mismo para la **tabla de la dieta**, y por un defecto real: la tabla estaba a mano y decía
 * `p95 1049` mientras el bloque generado, doce líneas más abajo del mismo archivo, medía `1078`.
 * Veintinueve tokens de deriva entre el número escrito y el número medido — la misma clase de
 * defecto que el bloque de costo ya había arreglado, sobreviviendo en la tabla de al lado.
 *
 * Por eso el invariante no es "que los dos números coincidan" (eso se arregla una vez y vuelve a
 * divergir la próxima): es que **haya un solo lugar donde el número se escribe**. La tabla sale del
 * mismo `EvalReport` que el bloque de costo, en la misma corrida.
 */
describe('la tabla de la dieta del README se genera igual que el bloque de costo', () => {
  const README = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'README.md');

  it('el README tiene los marcadores y la tabla es exactamente la que emite la eval, fila por fila', async () => {
    const env = evalEnv();
    const readme = readFileSync(README, 'utf8');
    expect(readme).toContain(DIET_BLOCK_START);
    expect(readme).toContain(DIET_BLOCK_END);
    const emitida = renderDietSection(await runEval(env), env);
    // El caso que este gate tiene que saber contar: alguien revierte `1078` a `1049` en UNA fila.
    // Comparando lineas, el diff imprime esa fila; comparando los README enteros imprimia dos
    // strings truncados identicos a la vista, y habia que ir a leer el test para entenderlo.
    expect(
      extractDietSection(readme).split('\n'),
      'una fila de la tabla de la dieta del README no coincide con lo que emite la eval; corre `pnpm --filter @istock/ai eval`',
    ).toEqual(emitida.split('\n'));
    // Mismo motivo que en el bloque de costo: el `replace` de vuelta seria una identidad
    // garantizada. Lo que se afirma es que hay UN solo bloque, porque `indexOf` regenera el primero
    // y dejaria envejeciendo a cualquier copia de mas.
    expect(occurrences(readme, DIET_BLOCK_START), MARCADOR_DUPLICADO).toBe(1);
    expect(occurrences(readme, DIET_BLOCK_END), MARCADOR_DUPLICADO).toBe(1);
  });

  it('la tabla y el bloque de costo reportan los MISMOS p95, porque salen del mismo reporte', async () => {
    const env = evalEnv();
    const report = await runEval(env);
    const diet = renderDietSection(report, env);
    const cost = renderCostSection(report, env);
    expect(diet).toContain(`| ${report.tokensInWithoutTool.p95} | ${report.tokensInWithTool.p95} |`);
    expect(cost).toContain(`sin tool  p95 ${report.tokensInWithoutTool.p95}`);
    expect(cost).toContain(`con tool  p95 ${report.tokensInWithTool.p95}`);
    expect(diet).toContain(`| ${report.tokensOut.p95} | ${report.tokensOut.p95} |`);
    expect(cost).toContain(`p95 ${report.tokensOut.p95}`);
  });

  /**
   * El defecto que este cambio vino a arreglar, como asercion: un solo numero mezclado esconde el
   * camino que aprieta. La tabla tiene que poder distinguir los dos.
   *
   * **Lo que se publica como salud dejo de ser el margen (2026-08-28).** El margen contra el techo
   * es `>= 0` **por construccion** desde que hay escalera de degradacion: la dieta recorta hasta
   * entrar o tira. Publicarlo como si midiera holgura era publicar una tautologia tranquilizadora
   * — el dia que la ficha crezca va a seguir dando 0 mientras por debajo se muere el historial.
   * Lo que se publica ahora es **cuanto hubo que tirar**, y este test lo exige.
   */
  it('distingue los dos caminos y publica lo que la dieta tuvo que tirar, sin maquillarlo', async () => {
    const env = evalEnv();
    const report = await runEval(env);
    const diet = renderDietSection(report, env);
    expect(diet).toContain('sin tool');
    expect(diet).toContain('con tool');
    expect(diet).toContain(`**${report.tokensInWithTool.max} tokens**`);
    expect(diet).toContain(`**${report.degradation.intact} de ${report.degradation.withPrompt}**`);
    // El techo es 1200 y se queda en 1200. Si alguien lo sube para que el numero entre, esto se
    // cae. La dieta se decidio con motivo (`CLAUDE.md` §Dieta).
    expect(env.maxInputTokens).toBe(MAX_INPUT_TOKENS);
    expect(report.tokensInWithTool.max).toBeLessThanOrEqual(MAX_INPUT_TOKENS);
  });

  /**
   * El peor turno se publica **con nombre**, y el nombre importa: es el que hay que poder reabrir
   * cuando alguien pregunte por que la dieta recorto. Un bloque que dijera "algun turno recorto 6
   * medios de pago" no se puede investigar.
   */
  it('nombra el peor turno del corpus y coincide con el reporte, no con una frase escrita a mano', async () => {
    const env = evalEnv();
    const report = await runEval(env);
    const worst = report.degradation.worst;
    // Si esto es `null`, el corpus dejo de contener la ficha del plan Negocio y el peor caso
    // realista volvio a quedar afuera del numero publicado — que es exactamente lo que se arreglo.
    expect(worst).not.toBeNull();
    const diet = renderDietSection(report, env);
    expect(diet).toContain(`\`${worst?.id}\``);
    expect(diet).toContain(`${worst?.promptTokens} tokens tras tirar`);
    expect(diet).toContain(`${worst?.paymentMethodsDropped} medios de pago`);
  });

  it('los techos de la tabla son los de env, no literales: si se afloja la dieta, la tabla lo dice', async () => {
    const env = evalEnv();
    const diet = renderDietSection(await runEval(env), env);
    expect(diet).toContain(`**${env.maxInputTokens}** tokens`);
    expect(diet).toContain(`**${env.maxOutputTokens}** tokens`);
    expect(diet).toContain(`| ${env.temperature} |`);
  });

  it('no queda NINGUNA tabla de techos a mano afuera del bloque: una sola fuente para el número', () => {
    const readme = readFileSync(README, 'utf8');
    const start = readme.indexOf(DIET_BLOCK_START);
    const afuera =
      readme.slice(0, start) + readme.slice(readme.indexOf(DIET_BLOCK_END) + DIET_BLOCK_END.length);
    // El encabezado de la tabla es la firma: si aparece dos veces, hay una copia a mano al lado de
    // la generada, y la copia es siempre la que envejece.
    expect(afuera).not.toContain('medido p95, sin tool');
  });

  it('sin marcadores tira, en vez de dejar la tabla transcripta a mano', () => {
    expect(() => replaceDietSection('# README sin marcadores\n', 'x')).toThrowError(/marcadores/u);
  });
});
