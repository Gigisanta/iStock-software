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
