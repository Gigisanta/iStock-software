/**
 * Tres tools y ni una más (`CLAUDE.md` §Tools expuestas al modelo). Lo que este archivo persigue no
 * es que funcionen: es que **no se les pueda pedir de más**. Los argumentos vienen de un LLM, que es
 * la definición de borde no confiable, y por eso el schema es estricto y el techo de 5 se aplica dos
 * veces.
 */

import { describe, expect, it } from 'vitest';
import { MAX_SEARCH_RESULTS } from './budget';
import { isAiError } from './errors';
import { TOOL_NAMES, TOOL_SPECS, createToolRuntime, toolBudgetTokens, toolSchemas, type SearchHit } from './tools';
import { listingFixture, reservedListingFixture } from './fixtures/listing';

function hits(count: number, status: SearchHit['status'] = 'available'): readonly SearchHit[] {
  return Array.from({ length: count }, (_u, i) => ({
    slug: `equipo-${i}`,
    title: `iPhone ${i}`,
    priceUsdFormatted: `USD ${500 + i}`,
    status,
  }));
}

const listing = listingFixture();

describe('la superficie expuesta al modelo', () => {
  it('son exactamente tres', () => {
    expect(TOOL_NAMES).toEqual(['get_open_listing', 'search_listings', 'handoff_whatsapp']);
    expect(TOOL_SPECS).toHaveLength(3);
  });

  it('ninguna escribe: el chatbot no muta stock ni reserva nada', () => {
    for (const spec of TOOL_SPECS) {
      expect(spec.name, spec.name).not.toMatch(/create|update|delete|reserve_|set_/u);
    }
  });

  it('ninguna recibe tenantId: el tenant lo ata el servidor al construir el puerto', () => {
    for (const spec of TOOL_SPECS) {
      expect(Object.keys(spec.parameters.properties), spec.name).not.toContain('tenantId');
    }
  });

  it('ninguna recibe un limit: un techo que el modelo puede subir no es un techo', () => {
    for (const spec of TOOL_SPECS) {
      expect(Object.keys(spec.parameters.properties), spec.name).not.toContain('limit');
    }
  });

  it('declarar las tres cuesta lo que dice toolBudgetTokens, y eso entra en la dieta', () => {
    const cost = toolBudgetTokens();
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(250);
  });
});

describe('schemas estrictos', () => {
  it('un argumento inventado es un error, no un campo ignorado', () => {
    expect(() => toolSchemas.search_listings.parse({ query: 'iphone', tenantId: 'otro' })).toThrow();
    expect(() => toolSchemas.get_open_listing.parse({ listingId: 'x' })).toThrow();
  });

  it('el motivo de handoff tiene que ser uno de los declarados', () => {
    expect(() => toolSchemas.handoff_whatsapp.parse({ reason: 'porque_si' })).toThrow();
    expect(toolSchemas.handoff_whatsapp.parse({ reason: 'reserve' })).toEqual({ reason: 'reserve' });
  });

  it('el motivo no puede ser uno operativo: el modelo no declara que se cayó el proveedor', () => {
    expect(() => toolSchemas.handoff_whatsapp.parse({ reason: 'provider_down' })).toThrow();
    expect(() => toolSchemas.handoff_whatsapp.parse({ reason: 'soft_cap' })).toThrow();
  });

  it('una query vacía o larguísima se rechaza', () => {
    expect(() => toolSchemas.search_listings.parse({ query: 'a' })).toThrow();
    expect(() => toolSchemas.search_listings.parse({ query: 'x'.repeat(200) })).toThrow();
  });
});

describe('createToolRuntime', () => {
  it('una tool desconocida se rechaza antes de tocar nada', async () => {
    const runtime = createToolRuntime({ listing });
    try {
      await runtime.run({ name: 'get_cost', args: {} });
      expect.unreachable('tenía que tirar');
    } catch (error) {
      expect(isAiError(error) && error.code).toBe('AI_INPUT_INVALID');
    }
  });

  it('get_open_listing devuelve un resumen, no una segunda copia de la ficha', async () => {
    const outcome = await createToolRuntime({ listing }).run({ name: 'get_open_listing', args: {} });
    expect(outcome.kind).toBe('data');
    if (outcome.kind !== 'data') return;
    expect(outcome.content).toContain('iPhone 14 Pro');
    expect(outcome.content.split('\n')).toHaveLength(1);
  });

  it('get_open_listing sobre una ficha reservada dice RESERVADO (E8)', async () => {
    const outcome = await createToolRuntime({ listing: reservedListingFixture() }).run({
      name: 'get_open_listing',
      args: {},
    });
    expect(outcome.kind === 'data' && outcome.content).toContain('RESERVADO');
  });

  it('get_open_listing no filtra costo, identificadores ni notas internas', async () => {
    const contaminado = { ...listing, costUsd: 48_000, imei: '351234567890123', internalNotes: 'del mayorista' };
    const outcome = await createToolRuntime({ listing: contaminado }).run({ name: 'get_open_listing', args: {} });
    const content = outcome.kind === 'data' ? outcome.content : '';
    expect(content).not.toContain('48000');
    expect(content).not.toContain('351234567890123');
    expect(content).not.toContain('mayorista');
  });

  it('search_listings corta en 5 aunque el puerto devuelva 40', async () => {
    const runtime = createToolRuntime({
      listing,
      search: { search: async () => hits(40) },
    });
    const outcome = await runtime.run({ name: 'search_listings', args: { query: 'iphone' } });
    expect(outcome.kind === 'data' && outcome.content.split('\n')).toHaveLength(MAX_SEARCH_RESULTS);
  });

  it('search_listings le pasa el techo al puerto, además de recortar después', async () => {
    let received = 0;
    const runtime = createToolRuntime({
      listing,
      search: {
        search: async (_q, limit) => {
          received = limit;
          return hits(2);
        },
      },
    });
    await runtime.run({ name: 'search_listings', args: { query: 'iphone' } });
    expect(received).toBe(MAX_SEARCH_RESULTS);
  });

  it('search_listings no oculta el estado: un reservado se lista como no disponible', async () => {
    const runtime = createToolRuntime({ listing, search: { search: async () => hits(1, 'reserved') } });
    const outcome = await runtime.run({ name: 'search_listings', args: { query: 'iphone' } });
    expect(outcome.kind === 'data' && outcome.content).toContain('NO está disponible');
  });

  it('sin puerto de búsqueda contesta que no hay, en vez de romper', async () => {
    const outcome = await createToolRuntime({ listing }).run({ name: 'search_listings', args: { query: 'iphone' } });
    expect(outcome.kind === 'data' && outcome.content).toContain('No hay búsqueda disponible');
  });

  it('sin resultados lo dice, y no inventa', async () => {
    const runtime = createToolRuntime({ listing, search: { search: async () => [] } });
    const outcome = await runtime.run({ name: 'search_listings', args: { query: 'nokia' } });
    expect(outcome.kind === 'data' && outcome.content).toContain('No hay otros equipos');
  });

  it('handoff_whatsapp devuelve un handoff con el motivo declarado', async () => {
    const outcome = await createToolRuntime({ listing }).run({ name: 'handoff_whatsapp', args: { reason: 'payment' } });
    expect(outcome).toEqual({ kind: 'handoff', reason: 'payment' });
  });

  it('argumentos inválidos tiran: el orquestador los trata como que el modelo se perdió', async () => {
    const runtime = createToolRuntime({ listing });
    await expect(runtime.run({ name: 'search_listings', args: {} })).rejects.toThrow();
    await expect(runtime.run({ name: 'handoff_whatsapp', args: { reason: 'inventado' } })).rejects.toThrow();
  });
});
