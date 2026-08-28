/**
 * El puerto del proveedor. No hay adapter de Gemini ni de Groq todavía porque **B4 (las keys) está
 * abierto**; lo que hay es la interfaz contra la que se escriben, y dos implementaciones de prueba
 * que alcanzan para ejercer hoy la cadena primario→fallback y los evals sin red.
 *
 * El stub se usa **en modo adversario**: se lo programa para intentar filtrar costo o mentir sobre
 * disponibilidad. Un stub que sólo dice cosas correctas no prueba ninguna defensa.
 */

import { describe, expect, it } from 'vitest';
import { isAiError } from './errors';
import { createDownProvider, createStubProvider, type LlmRequest } from './provider';

const request: LlmRequest = {
  model: 'modelo-de-prueba',
  system: 'reglas',
  messages: [{ role: 'user', content: 'hola' }],
  temperature: 0.2,
  maxOutputTokens: 180,
  tools: [],
};

describe('createStubProvider', () => {
  it('un guion de strings se consume en orden', async () => {
    const stub = createStubProvider({ script: ['primera', 'segunda'] });
    expect((await stub.generate(request)).text).toBe('primera');
    expect((await stub.generate(request)).text).toBe('segunda');
  });

  it('repite el último turno cuando el guion se agota', async () => {
    const stub = createStubProvider({ script: ['única'] });
    await stub.generate(request);
    expect((await stub.generate(request)).text).toBe('única');
  });

  it('un Error en el guion se tira, que es como se simula un proveedor que falla a mitad de camino', async () => {
    const stub = createStubProvider({ script: [new Error('429')] });
    await expect(stub.generate(request)).rejects.toThrow('429');
  });

  it('puede devolver tool calls y uso de tokens', async () => {
    const stub = createStubProvider({
      script: [{ text: '', toolCalls: [{ name: 'get_open_listing', args: {} }], tokensIn: 700, tokensOut: 12 }],
    });
    const result = await stub.generate(request);
    expect(result.toolCalls[0]?.name).toBe('get_open_listing');
    expect(result.tokensIn).toBe(700);
  });

  it('un guion función ve la request, que es como se escriben los evals adversarios', async () => {
    const stub = createStubProvider({
      script: (req) => (req.system.includes('RESERVADO') ? 'Está disponible, llevátelo.' : 'Sí, está disponible.'),
    });
    expect((await stub.generate({ ...request, system: 'Estado: RESERVADO' })).text).toContain('llevátelo');
  });

  it('registra las requests para poder auditar el prompt que se mandó', async () => {
    const stub = createStubProvider({ script: ['ok'] });
    await stub.generate(request);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.temperature).toBe(0.2);
    expect(stub.calls[0]?.system).toBe('reglas');
  });

  it('devuelve el modelo pedido: el ID viaja por la request, no está clavado en el proveedor', async () => {
    const stub = createStubProvider({ script: ['ok'] });
    expect((await stub.generate(request)).model).toBe('modelo-de-prueba');
  });

  it('un guion vacío no rompe: devuelve texto vacío, que el orquestador trata como falla', async () => {
    const stub = createStubProvider({ script: [] });
    expect((await stub.generate(request)).text).toBe('');
  });
});

describe('createDownProvider', () => {
  it('siempre falla, con AiError y con el id adentro para poder loguear cuál se cayó', async () => {
    const down = createDownProvider('gemini');
    await expect(down.generate(request)).rejects.toThrow('gemini');
    try {
      await down.generate(request);
    } catch (error) {
      expect(isAiError(error) && error.code).toBe('AI_PROVIDER_FAILED');
    }
  });
});

describe('la interfaz en sí', () => {
  it('no tiene tenantId: el aislamiento no se delega a un LLM', () => {
    expect(Object.keys(request)).not.toContain('tenantId');
  });

  it('no tiene perilla de thinking ni de reasoning: la dieta prohíbe pagar tokens de razonamiento', () => {
    expect(Object.keys(request)).not.toContain('thinking');
    expect(Object.keys(request)).not.toContain('reasoningEffort');
  });
});
