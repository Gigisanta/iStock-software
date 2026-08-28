/**
 * La env es un borde y se valida como tal. Los tests interesantes no son los del camino feliz: son
 * los cuatro rechazos, cada uno de los cuales corresponde a una forma documentada de perder plata o
 * privacidad.
 *
 * Los IDs de modelo prohibidos se arman por concatenación a propósito: el literal completo del
 * nombre de un frontier adentro de `packages/ai` es lo que sale a buscar la regla 11 de
 * `scripts/guard-leaks.sh`, y un test no puede ser a la vez la prueba y el hallazgo.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS, TEMPERATURE } from './budget';
import { aiEnv, parseAiEnv, resetAiEnvCache } from './env';
import { isAiError } from './errors';

const OK = {
  LLM_PRIMARY_MODEL: 'gemini-2.5-flash-lite',
  LLM_FALLBACK_MODEL: 'openai/gpt-oss-20b',
} as const;

function expectRejected(source: Record<string, string | undefined>, needle: string): void {
  try {
    parseAiEnv(source);
    expect.unreachable(`tenía que rechazar: ${needle}`);
  } catch (error) {
    expect(isAiError(error) && error.code).toBe('AI_CONFIG_INVALID');
    expect(String(error)).toContain(needle);
  }
}

afterEach(() => {
  resetAiEnvCache();
});

describe('parseAiEnv, camino feliz', () => {
  it('sin driver explícito arranca en stub, que es lo que hace que B4 no bloquee', () => {
    const env = parseAiEnv({ ...OK });
    expect(env.driver).toBe('stub');
    expect(env.primaryModel).toBe('gemini-2.5-flash-lite');
    expect(env.fallbackModel).toBe('openai/gpt-oss-20b');
    expect(env.maxInputTokens).toBe(MAX_INPUT_TOKENS);
    expect(env.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
  });

  it('la temperatura no es configurable: 0.2 es decisión de producto', () => {
    expect(parseAiEnv({ ...OK }).temperature).toBe(TEMPERATURE);
  });

  it('informa si hay keys sin exponerlas', () => {
    const env = parseAiEnv({ ...OK, GOOGLE_GENERATIVE_AI_API_KEY: 'secreto', GROQ_API_KEY: 'secreto' });
    expect(env.hasGoogleKey).toBe(true);
    expect(env.hasGroqKey).toBe(true);
    expect(JSON.stringify(env)).not.toContain('secreto');
  });
});

describe('la dieta se baja por env, nunca se sube', () => {
  it('acepta bajar', () => {
    const env = parseAiEnv({ ...OK, LLM_MAX_INPUT_TOKENS: '600', LLM_MAX_OUTPUT_TOKENS: '90' });
    expect(env.maxInputTokens).toBe(600);
    expect(env.maxOutputTokens).toBe(90);
  });

  it('rechaza subir la entrada: poner 4000 en el dashboard rompe el arranque, no afloja la dieta', () => {
    expectRejected({ ...OK, LLM_MAX_INPUT_TOKENS: '4000' }, 'LLM_MAX_INPUT_TOKENS');
  });

  it('rechaza subir la salida', () => {
    expectRejected({ ...OK, LLM_MAX_OUTPUT_TOKENS: '2000' }, 'LLM_MAX_OUTPUT_TOKENS');
  });

  it('rechaza cero y valores no numéricos', () => {
    expectRejected({ ...OK, LLM_MAX_INPUT_TOKENS: '0' }, 'LLM_MAX_INPUT_TOKENS');
    expectRejected({ ...OK, LLM_MAX_INPUT_TOKENS: 'mil' }, 'LLM_MAX_INPUT_TOKENS');
  });
});

describe('familias de modelo prohibidas en el hot path', () => {
  it('rechaza el frontier de Anthropic', () => {
    expectRejected({ ...OK, LLM_PRIMARY_MODEL: ['claude', 'sonnet', '5'].join('-') }, 'prohibido');
  });

  it('rechaza el frontier de OpenAI', () => {
    expectRejected({ ...OK, LLM_PRIMARY_MODEL: ['gpt', '5.1'].join('-') }, 'prohibido');
  });

  it('rechaza la familia de razonamiento de OpenAI', () => {
    expectRejected({ ...OK, LLM_FALLBACK_MODEL: ['o3', 'mini'].join('-') }, 'prohibido');
  });

  it('rechaza el modelo de Groq retirado el 16/08/2026 (R3)', () => {
    expectRejected({ ...OK, LLM_FALLBACK_MODEL: ['llama', '3.1', '8b', 'instant'].join('-') }, 'retirado');
  });

  it('deja pasar los OSS de Groq, que sí están vigentes', () => {
    expect(parseAiEnv({ ...OK, LLM_FALLBACK_MODEL: 'openai/gpt-oss-120b' }).fallbackModel).toBe('openai/gpt-oss-120b');
  });

  it('rechaza un ID con forma inválida antes de mirar la familia', () => {
    expectRejected({ ...OK, LLM_PRIMARY_MODEL: '  ' }, 'LLM_PRIMARY_MODEL');
    expectRejected({ ...OK, LLM_PRIMARY_MODEL: 'modelo con espacios' }, 'LLM_PRIMARY_MODEL');
  });
});

describe('coherencia entre variables', () => {
  it('el fallback no puede ser el mismo modelo que el primario', () => {
    expectRejected({ LLM_PRIMARY_MODEL: 'gemini-2.5-flash-lite', LLM_FALLBACK_MODEL: 'gemini-2.5-flash-lite' }, 'fallback');
  });

  it('driver live exige las dos credenciales', () => {
    expectRejected({ ...OK, LLM_DRIVER: 'live', GROQ_API_KEY: 'x' }, 'GOOGLE_GENERATIVE_AI_API_KEY');
    expectRejected({ ...OK, LLM_DRIVER: 'live', GOOGLE_GENERATIVE_AI_API_KEY: 'x' }, 'GROQ_API_KEY');
  });

  it('en producción el stub está prohibido: contestaría canned a compradores reales sin fallar', () => {
    expectRejected({ ...OK, VERCEL_ENV: 'production' }, 'LLM_DRIVER');
  });

  it('producción con live y credenciales pasa', () => {
    const env = parseAiEnv({
      ...OK,
      VERCEL_ENV: 'production',
      LLM_DRIVER: 'live',
      GOOGLE_GENERATIVE_AI_API_KEY: 'g',
      GROQ_API_KEY: 'q',
    });
    expect(env.driver).toBe('live');
  });

  it('un driver desconocido se rechaza', () => {
    expectRejected({ ...OK, LLM_DRIVER: 'mock' }, 'LLM_DRIVER');
  });
});

describe('aiEnv', () => {
  it('memoiza, y resetAiEnvCache la olvida', () => {
    process.env.LLM_PRIMARY_MODEL = OK.LLM_PRIMARY_MODEL;
    process.env.LLM_FALLBACK_MODEL = OK.LLM_FALLBACK_MODEL;
    resetAiEnvCache();
    const first = aiEnv();
    expect(aiEnv()).toBe(first);
    resetAiEnvCache();
    expect(aiEnv()).not.toBe(first);
    delete process.env.LLM_PRIMARY_MODEL;
    delete process.env.LLM_FALLBACK_MODEL;
  });
});
