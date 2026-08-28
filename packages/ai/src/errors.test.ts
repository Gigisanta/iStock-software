import { describe, expect, it } from 'vitest';
import { AI_ERROR_CODES, AiError, isAiError } from './errors';

describe('AiError', () => {
  it('lleva el código y es un Error de verdad', () => {
    const error = new AiError('AI_BUDGET_EXCEEDED', 'se pasó');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('AI_BUDGET_EXCEEDED');
    expect(error.message).toBe('se pasó');
    expect(error.name).toBe('AiError');
  });

  it('isAiError distingue de un Error común, que es lo que hace útil el catch selectivo', () => {
    expect(isAiError(new AiError('AI_PROVIDER_FAILED', 'x'))).toBe(true);
    expect(isAiError(new Error('x'))).toBe(false);
    expect(isAiError(null)).toBe(false);
    expect(isAiError('AI_PROVIDER_FAILED')).toBe(false);
  });

  it('los códigos son únicos', () => {
    expect(new Set(AI_ERROR_CODES).size).toBe(AI_ERROR_CODES.length);
  });
});
