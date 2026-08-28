/**
 * **La aserción de la dieta.** Es el test que el encargo pidió con nombre y apellido: no un
 * objetivo, un assert que se pone en rojo si el prompt armado se pasa de 1200.
 *
 * Está escrito para fallar por las tres vías por las que la dieta se rompe en la práctica:
 *
 * 1. **Por acumulación honesta** — el dueño escribe una descripción larga, el comprador manda un
 *    mensaje largo, hay 4 turnos e historial. Nadie hizo nada mal y el prompt se fue a 2000.
 * 2. **Por ataque** — alguien manda 20 turnos de 2000 caracteres para inflar el costo del tenant.
 * 3. **Por regresión de diseño** — alguien agrega un campo al bloque de ficha o una línea al system
 *    "que casi no ocupa". El margen se come de a poco.
 *
 * Y prueba que la degradación respeta el **orden documentado**: primero se van los turnos, después
 * los chunks, y la descripción del dueño última. Cortar el prompt por el medio sería más fácil y
 * dejaría al modelo contestando sobre media ficha.
 */

import { describe, expect, it } from 'vitest';
import { MAX_INPUT_TOKENS } from './budget';
import { buildChatContext, type ChatContextInput } from './context';
import { createTtlCache } from './cache';
import { isAiError } from './errors';
import type { ListingPromptView } from './listing-view';
import type { CatalogChunk } from './chunks';
import type { ChatTurn } from './turns';
import { bloatedListingFixture, injectedListingFixture, listingFixture, reservedListingFixture } from './fixtures/listing';

const MODEL_ID = 'cm_14pro';

const CHUNKS: readonly CatalogChunk[] = [
  { catalogModelId: MODEL_ID, text: 'El iPhone 14 Pro tiene pantalla de 6,1", Isla Dinámica y chip A16 Bionic.' },
  { catalogModelId: MODEL_ID, text: 'Cámara principal de 48 MP, grabación en ProRes y modo Cinemático a 4K.' },
  { catalogModelId: MODEL_ID, text: 'Resistencia IP68 y conector Lightning. Salió en septiembre de 2022.' },
  { catalogModelId: 'cm_13pro', text: 'Este chunk es de otro modelo y no tiene que entrar nunca.' },
];

function turns(count: number, size = 200): readonly ChatTurn[] {
  return Array.from({ length: count }, (_u, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `Turno número ${i} con texto de relleno del comprador. `.repeat(Math.ceil(size / 45)),
  }));
}

function input(overrides: Partial<ChatContextInput> = {}): ChatContextInput {
  return {
    listing: listingFixture(),
    storeName: 'Norte Celulares',
    catalogModelId: MODEL_ID,
    chunks: CHUNKS,
    turns: [],
    userMessage: '¿Está disponible el 14 Pro de 256?',
    ...overrides,
  };
}

/** Los peores casos que el sistema puede recibir sin que nadie haya hecho nada mal. */
const WORST_CASES: readonly { readonly name: string; readonly input: ChatContextInput }[] = ([
  ['ficha base, sin historial', input()],
  ['4 turnos de historial', input({ turns: turns(4) })],
  ['20 turnos (ataque de inflado)', input({ turns: turns(20, 2000) })],
  ['descripción enorme del dueño', input({ listing: bloatedListingFixture(), turns: turns(4) })],
  ['descripción con inyección', input({ listing: injectedListingFixture(), turns: turns(4) })],
  ['ficha reservada', input({ listing: reservedListingFixture(), turns: turns(4) })],
  ['mensaje larguísimo del comprador', input({ userMessage: '¿Y esto qué tal anda? '.repeat(400) })],
  ['todo junto', input({ listing: bloatedListingFixture(), turns: turns(20, 2000), userMessage: 'hola '.repeat(500) })],
] as const).map(([name, value]) => ({ name, input: value }));

describe('la dieta de contexto es una aserción, no un objetivo', () => {
  it.each(WORST_CASES)(`entra en el techo: $name`, ({ input: contextInput }) => {
    const context = buildChatContext(contextInput);
    expect(context.budget.tokensIn).toBeLessThanOrEqual(MAX_INPUT_TOKENS);
    expect(context.budget.withinBudget).toBe(true);
  });

  it('el total medido incluye el schema de las tools, que también se factura', () => {
    expect(buildChatContext(input()).budget.toolTokens).toBeGreaterThan(0);
  });

  it('respeta un techo más bajo pasado por env', () => {
    const context = buildChatContext(input({ turns: turns(4) }), { limit: 900 });
    expect(context.budget.tokensIn).toBeLessThanOrEqual(900);
  });

  it('deja margen: si el caso base ya raspa el techo, no queda lugar para una ficha real más larga', () => {
    expect(buildChatContext(input()).budget.tokensIn).toBeLessThan(MAX_INPUT_TOKENS * 0.85);
  });
});

describe('composición: entra eso y nada más', () => {
  const context = buildChatContext(input({ turns: turns(2) }));

  it('lleva el system, la ficha y los chunks del modelo', () => {
    expect(context.system).toContain('Sos el asistente de Norte Celulares');
    expect(context.system).toContain('FICHA ABIERTA');
    expect(context.system).toContain('Isla Dinámica');
  });

  it('nunca lleva chunks de otro modelo', () => {
    expect(context.system).not.toContain('otro modelo y no tiene que entrar');
  });

  it('el mensaje actual del comprador es el último turno', () => {
    expect(context.messages[context.messages.length - 1]?.role).toBe('user');
    expect(context.messages[context.messages.length - 1]?.content).toContain('14 Pro');
  });

  it('nunca lleva más de 4 turnos de historial más el actual', () => {
    expect(buildChatContext(input({ turns: turns(20) })).messages.length).toBeLessThanOrEqual(5);
  });

  it('un mensaje que queda vacío después de sanear igual viaja como turno', () => {
    const vacio = buildChatContext(input({ userMessage: '   ' }));
    expect(vacio.messages[vacio.messages.length - 1]?.content).toBe('(consulta)');
  });
});

/**
 * El piso real de esta ficha: sin historial, sin chunks y sin descripción. Se mide en vez de
 * escribirse a mano para que los tests de degradación sigan probando degradación el día que la
 * ficha cambie de tamaño, en vez de romperse por un número mágico desactualizado.
 */
function floorTokens(listing = listingFixture()): number {
  return buildChatContext(input({ listing, chunks: [], catalogModelId: null })).budget.tokensIn;
}

describe('degradación en el orden documentado', () => {
  it('con un techo apretado se van primero los turnos, no la ficha ni los chunks', () => {
    const holgado = buildChatContext(input({ turns: turns(4) })).budget.tokensIn;
    const context = buildChatContext(input({ turns: turns(4) }), { limit: holgado - 30 });
    expect(context.trimmed.turnsDropped).toBeGreaterThan(0);
    expect(context.trimmed.chunksDropped).toBe(0);
    expect(context.trimmed.descriptionDropped).toBe(false);
  });

  it('después de los turnos se van los chunks, y recién ahí la descripción', () => {
    // El techo se deriva del piso medido, no de un número mágico: si mañana la ficha crece, este
    // test tiene que seguir probando la degradación y no romperse por aritmética.
    const context = buildChatContext(input({ turns: turns(4) }), { limit: floorTokens() + 40 });
    expect(context.trimmed.turnsDropped).toBe(4);
    expect(context.trimmed.chunksDropped).toBeGreaterThan(0);
    expect(context.system).toContain('FICHA ABIERTA');
    expect(context.system).toContain('Precio');
  });

  it('la ficha y el precio sobreviven a la degradación máxima: son prioridad 2 y no se descartan', () => {
    const context = buildChatContext(input({ listing: bloatedListingFixture(), turns: turns(4) }), {
      // El piso se mide sobre la MISMA ficha sin descripción: es el único techo que obliga a
      // descartarla y deja ver si el precio y el estado sobrevivieron.
      limit: floorTokens(listingFixture({ description: null })) + 5,
    });
    expect(context.system).toContain('Precio');
    expect(context.system).toContain('Estado');
    expect(context.trimmed.descriptionDropped).toBe(true);
  });

  it('el estado RESERVADO sobrevive incluso al recorte más agresivo (E8)', () => {
    const context = buildChatContext(input({ listing: reservedListingFixture(), turns: turns(4) }), {
      limit: floorTokens(listingFixture({ status: 'reserved', description: null })) + 5,
    });
    expect(context.system).toContain('RESERVADO');
    expect(context.system).toContain('NO está disponible');
  });

  it('si ni el contexto mínimo entra, tira: no se manda un prompt achicado a ojo', () => {
    try {
      buildChatContext(input(), { limit: 50 });
      expect.unreachable('tenía que tirar');
    } catch (error) {
      expect(isAiError(error) && error.code).toBe('AI_BUDGET_EXCEEDED');
      expect(String(error)).toContain('listing-view');
    }
  });
});

describe('cache de la ficha', () => {
  it('usa el cache cuando se lo pasan y devuelve el mismo prompt', () => {
    const cache = createTtlCache<ListingPromptView>();
    const first = buildChatContext(input(), { listingCache: cache });
    const second = buildChatContext(input(), { listingCache: cache });
    expect(cache.size).toBe(1);
    expect(second.system).toBe(first.system);
  });

  it('sin cache el resultado es idéntico: el cache ahorra armado, no cambia el prompt', () => {
    const cache = createTtlCache<ListingPromptView>();
    expect(buildChatContext(input(), { listingCache: cache }).system).toBe(buildChatContext(input()).system);
  });
});
