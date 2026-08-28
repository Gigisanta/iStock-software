/**
 * La dieta como constantes y como aserción. Los números están fijados **a propósito**: son los de
 * `CLAUDE.md` §Dieta y `docs/CHATBOT.md`, y bajarlos o subirlos es una decisión de producto que
 * tiene que romper un test, no pasar en un refactor.
 */

import { describe, expect, it } from 'vitest';
import {
  CACHE_TTL_MS,
  MAX_CATALOG_CHUNKS,
  MAX_HISTORY_TURNS,
  MAX_INPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  MAX_SEARCH_RESULTS,
  TEMPERATURE,
  assertWithinBudget,
  measurePrompt,
} from './budget';
import { isAiError } from './errors';
import { MESSAGE_OVERHEAD_TOKENS, countTokens } from './tokens';

describe('constantes de la dieta', () => {
  it('son exactamente las que dice la constitución', () => {
    expect(MAX_INPUT_TOKENS).toBe(1200);
    expect(MAX_OUTPUT_TOKENS).toBe(180);
    expect(TEMPERATURE).toBe(0.2);
    expect(CACHE_TTL_MS).toBe(60_000);
    expect(MAX_HISTORY_TURNS).toBe(4);
    expect(MAX_CATALOG_CHUNKS).toBe(3);
    expect(MAX_SEARCH_RESULTS).toBe(5);
  });
});

describe('measurePrompt', () => {
  it('informa, no tira', () => {
    const report = measurePrompt('x'.repeat(100_000), [{ role: 'user', content: 'hola' }]);
    expect(report.withinBudget).toBe(false);
    expect(report.tokensIn).toBeGreaterThan(MAX_INPUT_TOKENS);
  });

  it('cuenta el system además de los mensajes', () => {
    const soloMensajes = measurePrompt('', [{ role: 'user', content: 'hola' }]).tokensIn;
    const conSystem = measurePrompt('reglas del asistente', [{ role: 'user', content: 'hola' }]).tokensIn;
    expect(conSystem).toBeGreaterThan(soloMensajes);
  });

  it('suma el schema de las tools al total facturable, no lo esconde', () => {
    const sinTools = measurePrompt('sys', [{ role: 'user', content: 'hola' }], MAX_INPUT_TOKENS, 0);
    const conTools = measurePrompt('sys', [{ role: 'user', content: 'hola' }], MAX_INPUT_TOKENS, 60);
    expect(conTools.tokensIn).toBe(sinTools.tokensIn + 60);
    expect(conTools.toolTokens).toBe(60);
  });

  /**
   * Un system vacío **no** cuesta cero: cuesta el sobre del mensaje más el rol, que es lo que factura
   * el proveedor aunque el contenido esté vacío. Este test decía `toBe(0)` y afirmaba lo contrario,
   * que es la misma clase de optimismo que contar la dieta sin el schema de las tools.
   */
  it('un mensaje vacío igual cuesta su sobre: el proveedor factura el envoltorio', () => {
    const empty = measurePrompt('', [], MAX_INPUT_TOKENS);
    expect(empty.tokensIn).toBeGreaterThan(0);
    expect(empty.tokensIn).toBe(MESSAGE_OVERHEAD_TOKENS + countTokens('system'));
  });

  it('el techo es inclusivo: justo en el límite entra', () => {
    const cost = measurePrompt('', [], MAX_INPUT_TOKENS).tokensIn;
    expect(measurePrompt('', [], cost).withinBudget).toBe(true);
    expect(measurePrompt('', [], cost - 1).withinBudget).toBe(false);
  });

  it('respeta un límite más bajo pasado por parámetro', () => {
    expect(measurePrompt('unas cuantas palabras acá', [], 3).withinBudget).toBe(false);
  });
});

describe('assertWithinBudget', () => {
  it('deja pasar lo que entra', () => {
    expect(() => assertWithinBudget(measurePrompt('corto', [{ role: 'user', content: 'hola' }]))).not.toThrow();
  });

  it('tira AI_BUDGET_EXCEEDED con los dos números en el mensaje', () => {
    try {
      assertWithinBudget(measurePrompt('x'.repeat(100_000), []));
      expect.unreachable('tenía que tirar');
    } catch (error) {
      expect(isAiError(error)).toBe(true);
      if (!isAiError(error)) return;
      expect(error.code).toBe('AI_BUDGET_EXCEEDED');
      expect(error.message).toContain(String(MAX_INPUT_TOKENS));
    }
  });
});
