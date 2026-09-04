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
import { TOOL_RESULT_TOKEN_BUDGET, buildChatContext, type ChatContextInput } from './context';
import { createTtlCache } from './cache';
import { isAiError } from './errors';
import { MAX_PAYMENT_METHODS, listingPromptView, renderListingDigest, type ListingPromptView } from './listing-view';
import type { CatalogChunk } from './chunks';
import type { ChatTurn } from './turns';
import { UNTRUSTED_CLOSE, UNTRUSTED_OPEN } from '@istock/domain';
import { countTokens } from './tokens';
import {
  bloatedListingFixture,
  businessPlanListingFixture,
  injectedListingFixture,
  listingFixture,
  reservedListingFixture,
} from './fixtures/listing';

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
  // La ronda de tool es el turno MÁS LARGO del ciclo y no estaba en esta lista: el resultado
  // entraba por `turns` y quedaba tapado por el recorte de historial.
  ['ronda de tool, con historial', input({ turns: turns(4), toolResult: `[search_listings] ${'iPhone 15 Pro Max 512 Titanio — USD 1200 — disponible\n'.repeat(5)}` })],
  ['ronda de tool sobre ficha enorme', input({ listing: bloatedListingFixture(), turns: turns(20, 2000), toolResult: `[get_open_listing] ${'x '.repeat(400)}` })],
] as const).map(([name, value]) => ({ name, input: value }));

describe('la dieta de contexto es una aserción, no un objetivo', () => {
  it.each(WORST_CASES)(`entra en el techo: $name`, ({ input: contextInput }) => {
    const context = buildChatContext(contextInput);
    expect(context.budget.tokensIn).toBeLessThanOrEqual(MAX_INPUT_TOKENS);
    expect(context.budget.withinBudget).toBe(true);
  });

  /**
   * ## El resultado de la tool no es historial, y tratarlo como tal borraba el `RESERVADO`
   *
   * Entraba por `turns`, así que `trimTurns` lo (a) **re-sanitizaba**, borrándole los
   * delimitadores que `tools.ts` acababa de ponerle —`sanitizeDescription` quita tags y
   * `<<<DESCRIPCION_NO_CONFIABLE>>>` matchea la regla de tag—, y lo (b) **recortaba a 45 tokens**,
   * el presupuesto de un turno viejo. Medido sobre una ficha `reserved`, al modelo le llegaba
   * `RESERVADO —` y nada más; con el digest delimitado desaparecía entero. E8 se perdía en el
   * transporte y ningún test lo veía, porque todos miran `renderListingDigest`.
   */
  it('el resultado de la tool llega entero y con sus delimitadores intactos', () => {
    const digest = renderListingDigest(listingPromptView(reservedListingFixture()));
    const context = buildChatContext(input({ turns: turns(4), toolResult: `[get_open_listing] ${digest}` }));
    const toolTurn = context.messages.find((turn) => turn.content.startsWith('[get_open_listing]'));
    expect(toolTurn).toBeDefined();
    expect(toolTurn?.content).toContain(UNTRUSTED_OPEN);
    expect(toolTurn?.content).toContain(UNTRUSTED_CLOSE);
    expect(toolTurn?.content).toContain('NO está disponible');
    expect(context.budget.tokensIn).toBeLessThanOrEqual(MAX_INPUT_TOKENS);
  });

  it('y va después del historial y antes de la pregunta: es la respuesta a lo que el modelo pidió', () => {
    const context = buildChatContext(input({ turns: turns(2), toolResult: '[get_open_listing] iPhone 14 Pro' }));
    const indice = context.messages.findIndex((turn) => turn.content.startsWith('[get_open_listing]'));
    expect(indice).toBeGreaterThanOrEqual(0);
    expect(context.messages[context.messages.length - 1]?.role).toBe('user');
    expect(indice).toBe(context.messages.length - 2);
  });

  it('un resultado de tool absurdamente largo se corta, no rompe la dieta', () => {
    const context = buildChatContext(input({ toolResult: `[search_listings] ${'iPhone '.repeat(2000)}` }));
    const toolTurn = context.messages.find((turn) => turn.content.startsWith('[search_listings]'));
    // Sin esta línea el test pasaría en vacío el día que el turno de tool deje de existir.
    expect(toolTurn).toBeDefined();
    expect(countTokens(toolTurn?.content ?? '')).toBeLessThanOrEqual(TOOL_RESULT_TOKEN_BUDGET);
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

/**
 * ## El mensaje del piso decía un número que contradecía su propio motivo
 *
 * `AI_BUDGET_EXCEEDED` se tira cuando el mínimo **no entra**, y el mensaje imprimía
 * *"1173 tokens contra un techo de 1200"* — o sea, un número **adentro** del presupuesto mientras
 * abortaba por pasarse. El defecto era que el piso se re-armaba para el mensaje omitiendo el
 * resultado de la tool y reemplazando la consulta real por `'(consulta)'`: se reportaba un prompt
 * que nadie había intentado mandar. Quien leyera eso buscaría el bug en el contador de tokens, que
 * es el único lugar donde no estaba.
 *
 * Ahora el mensaje reporta **la última configuración efectivamente medida**, así que el número
 * reportado está por encima del techo **por construcción**. Este bloque lo falsifica: si alguien
 * vuelve a re-armar un piso de mentira para el mensaje, la primera aserción se cae sola.
 */
/**
 * ## El primer escalón de la escalera son los medios de pago, y está medido
 *
 * La ficha del plan Pro —3 puntos de retiro, 6 medios de pago, descripción al tope— es la que
 * el plan de USD 70 **vende**, no una punta rara de la distribución. Con historial cargado y una
 * ronda de tool, apretaba tanto contra los 1200 que la escalera se comía el historial entero y un
 * chunk, **en silencio**: el prompt seguía entrando, el costo no se movía, y lo único que bajaba
 * era la calidad de la respuesta.
 *
 * Medido antes de tocar nada: bloque de ficha 356 tokens, los 6 medios de pago 43, el 3er punto de
 * retiro 18, un turno realista de historial ~21. O sea que **los medios de pago valen dos turnos de
 * historial**, y hasta el 2026-08-28 la escalera no podía tocarlos porque la vista ya venía armada.
 *
 * ## Por qué los medios de pago sí y los puntos de retiro NO
 * Porque el criterio no es el tamaño, es **qué preguntas llegan al modelo**. Las 8 formulaciones de
 * "¿cómo puedo pagar?" del corpus derivan a WhatsApp **antes** de llamar al proveedor (pagar es
 * handoff obligatorio), así que esos 43 tokens no pueden contestar la única pregunta para la que
 * existen. Las de punto de retiro **sí** llegan al modelo, y el bloque le dice "si algo no está
 * acá, no lo sabés": un punto recortado no se vuelve silencio, se vuelve una **negación** — el
 * chatbot le dice que no hay local en General Roca al comprador que vive en General Roca. Eso es
 * información falsa sobre exactamente el feature que el plan cobra.
 */
describe('la escalera empieza por los medios de pago, no por el historial', () => {
  /**
   * Un solo chunk a propósito: con los tres, esta ficha **ya llega al techo gastando los 6 medios
   * de pago y un turno de historial**, así que no habría "primer escalón" que observar. Que ese sea
   * el estado normal de la ficha que el plan Pro vende es justamente el hallazgo.
   */
  const negocio = (): ChatContextInput =>
    input({ listing: businessPlanListingFixture(), turns: turns(4, 80), chunks: CHUNKS.slice(0, 1) });

  it('al techo de producción esta ficha YA está gastando medios de pago, y todavía no historial', () => {
    const context = buildChatContext(negocio());
    expect(context.trimmed.paymentMethodsDropped).toBeGreaterThan(0);
    expect(context.trimmed.turnsDropped).toBe(0);
    expect(context.trimmed.chunksDropped).toBe(0);
    expect(context.trimmed.descriptionDropped).toBe(false);
  });

  it('se van de a uno y por la cola: el primer medio de pago sobrevive al último', () => {
    const context = buildChatContext(negocio());
    expect(context.system).toContain('Efectivo');
    expect(context.system).not.toContain('Dólares billete');
  });

  /**
   * El invariante de ORDEN, barrido en vez de puntual: un solo techo elegido a dedo pasa por
   * casualidad. Si mañana alguien reordena la escalera, alguno de estos ocho techos lo delata.
   */
  it('ningún turno de historial se cae mientras quede un medio de pago para tirar', () => {
    const holgado = buildChatContext(negocio()).budget.tokensIn;
    for (const delta of [0, 4, 10, 20, 30, 45, 60, 90]) {
      const { trimmed } = buildChatContext(negocio(), { limit: holgado - delta });
      if (trimmed.turnsDropped > 0) {
        expect(trimmed.paymentMethodsDropped, `techo ${holgado - delta}`).toBe(MAX_PAYMENT_METHODS);
      }
      // Y los chunks nunca antes que el historial, que es el orden que ya estaba documentado.
      if (trimmed.chunksDropped > 0) expect(trimmed.turnsDropped, `techo ${holgado - delta}`).toBe(4);
    }
  });

  it('los 3 puntos de retiro sobreviven a la degradación máxima: son el feature que el plan cobra', () => {
    const context = buildChatContext(
      input({ listing: businessPlanListingFixture(), turns: turns(4, 80), chunks: [], catalogModelId: null }),
      { limit: floorTokens(businessPlanListingFixture({ description: null })) + 5 },
    );
    // Un punto de retiro recortado no es una omisión: el bloque dice "si algo no está acá, no lo
    // sabés", así que se convierte en una negación falsa al comprador de esa ciudad.
    expect(context.system).toContain('General Roca');
    expect(context.system).toContain('Cipolletti');
    expect(context.system).toContain('Neuquén');
  });
});

describe('el error del piso nombra la causa que lo disparó', () => {
  function floorError(contextInput: ChatContextInput, limit: number): { readonly limit: number; readonly message: string } {
    try {
      buildChatContext(contextInput, { limit });
      expect.unreachable('tenía que tirar');
    } catch (error) {
      if (!isAiError(error)) throw error;
      return { limit, message: error.message };
    }
  }

  it('el número que reporta está POR ENCIMA del techo, no por debajo', () => {
    const { message } = floorError(input({ turns: turns(4) }), 700);
    const medido = Number(/(\d+) tokens contra un techo de (\d+)/u.exec(message)?.[1] ?? '0');
    expect(medido).toBeGreaterThan(700);
  });

  it('cuenta el resultado de la tool cuando fue la tool la que no entró', () => {
    // El caso que el mensaje viejo NO sabía nombrar: el que rompe es el turno con digest adentro, y
    // el piso que se imprimía era el del turno sin digest — más chico, y por eso incoherente.
    const conTool = floorError(
      input({ turns: turns(4), toolResult: `[get_open_listing] ${'x '.repeat(400)}` }),
      700,
    );
    expect(conTool.message).toContain('el resultado de la tool');
    const sinTool = floorError(input({ turns: turns(4) }), 700);
    expect(sinTool.message).not.toContain('el resultado de la tool');
    const tokens = (message: string): number => Number(/(\d+) tokens contra/u.exec(message)?.[1] ?? '0');
    expect(tokens(conTool.message)).toBeGreaterThan(tokens(sinTool.message));
  });

  it('dice que el piso ya gastó TODOS los escalones, incluidos los medios de pago', () => {
    const { message } = floorError(input({ listing: businessPlanListingFixture() }), 700);
    expect(message).toContain('sin medios de pago');
    expect(message).toContain('sin chunks');
    expect(message).toContain('sin historial');
    // Y manda a arreglarlo donde se arregla: la ficha, no el techo.
    expect(message).toContain('listing-view');
    expect(message).not.toContain('subir el techo');
  });
});

/**
 * ## La escalera cobra, y hasta ahora cobraba en silencio
 *
 * El digest de `get_open_listing` no rompe el techo: **lo paga el historial**. En una ficha larga,
 * agregar la respuesta a la tool que el visitante acaba de disparar hace que el contexto pase de
 * cuatro turnos de historial a uno. El costo no sube ni un dólar —el prompt sigue entrando en
 * 1200— y ningún número se mueve; lo que baja es la calidad, y hasta el 2026-08-28 **ningún test
 * llamaba a eso por su nombre**.
 *
 * Es un bug de campo imposible de reproducir: el chatbot se olvida de lo que el comprador dijo dos
 * mensajes atrás, pero sólo cuando la ficha es larga y sólo después de una tool call.
 *
 * **Este test no dice que el orden esté mal.** Es probable que esté bien: el digest es la respuesta
 * a lo que el modelo acaba de pedir, y tirar un turno viejo para conservarla suena correcto. Lo que
 * afirma es que el intercambio existe, con el número puesto, para que **reordenar la escalera sin
 * querer se ponga en rojo** en vez de degradar la conversación en producción sin avisar.
 *
 * Los `N` de acá están **medidos**, no elegidos. Si el system crece y cambian, el número se
 * actualiza; lo que no puede cambiar sin discusión es la *forma*: el digest sobrevive entero, lo
 * paga el historial, y no lo pagan ni los chunks ni la descripción del dueño.
 */
describe('la escalera se paga en historial, y eso tiene que verse', () => {
  const listing = bloatedListingFixture();
  const historial = turns(4);
  const digest = renderListingDigest(listingPromptView(listing));
  const esHistorial = (turn: ChatTurn): boolean => turn.content.startsWith('Turno número');

  const sinTool = buildChatContext(input({ listing, turns: historial }));
  const conTool = buildChatContext(input({ listing, turns: historial, toolResult: `[get_open_listing] ${digest}` }));

  it('el digest sobrevive entero: es la respuesta a lo que el modelo acaba de pedir', () => {
    const toolTurn = conTool.messages.find((turn) => turn.content.startsWith('[get_open_listing]'));
    expect(toolTurn).toBeDefined();
    expect(toolTurn?.content).toContain(UNTRUSTED_OPEN);
    expect(countTokens(toolTurn?.content ?? '')).toBeLessThanOrEqual(TOOL_RESULT_TOKEN_BUDGET);
  });

  it('y lo paga el HISTORIAL: de 4 turnos quedan 1, donde sin la tool quedaban 3', () => {
    expect(sinTool.trimmed.turnsDropped).toBe(1);
    expect(sinTool.messages.filter(esHistorial)).toHaveLength(3);
    // El número de este cambio: el digest cuesta DOS turnos más de historial.
    expect(conTool.trimmed.turnsDropped).toBe(3);
    expect(conTool.messages.filter(esHistorial)).toHaveLength(1);
    expect(conTool.trimmed.turnsDropped - sinTool.trimmed.turnsDropped).toBe(2);
  });

  it('y no lo paga nadie más: los chunks y la descripción del dueño quedan enteros', () => {
    // Si alguien reordena la escalera y el digest empieza a costar chunks o la ficha, esto se cae.
    expect(conTool.trimmed.chunksDropped).toBe(0);
    expect(conTool.trimmed.descriptionDropped).toBe(false);
  });

  it('el precio NO aparece en la factura: el prompt sigue entrando, por eso pasaba desapercibido', () => {
    expect(conTool.budget.withinBudget).toBe(true);
    expect(conTool.budget.tokensIn).toBeLessThanOrEqual(MAX_INPUT_TOKENS);
  });

  it('no es un artefacto de la ficha inflada: pasa igual con la ficha `reserved` del corpus', () => {
    const reservada = reservedListingFixture();
    const conDigest = buildChatContext(
      input({
        listing: reservada,
        turns: historial,
        toolResult: `[get_open_listing] ${renderListingDigest(listingPromptView(reservada))}`,
      }),
    );
    expect(conDigest.trimmed.turnsDropped).toBeGreaterThan(
      buildChatContext(input({ listing: reservada, turns: historial })).trimmed.turnsDropped,
    );
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
