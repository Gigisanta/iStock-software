/**
 * La eval, también como test — para que `pnpm --filter @istock/ai test` sea rojo si el prompt
 * afloja, sin depender de que alguien se acuerde de correr el runner.
 *
 * El runner (`run.ts`) existe igual y no es redundante: imprime el consumo medido, que es lo que
 * `docs-keeper` necesita para `docs/CHATBOT.md` y lo que un test no muestra.
 */

import { describe, expect, it } from 'vitest';
import { EVAL_CASES, REAL_QUESTION_COUNT } from './cases.eval';
import { evalEnv, runCase, runEval, runFallbackDrill } from './harness';
import { COST_BLOCK_END, COST_BLOCK_START, renderCostSection, replaceCostSection } from './report-md';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS } from '../budget';

const env = evalEnv();

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
    expect(replaceCostSection(readme, renderCostSection(await runEval(env), env))).toBe(readme);
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
