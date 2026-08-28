/**
 * La segunda allowlist del producto (la primera es `publicListingDTO` en `packages/domain`).
 *
 * La prueba que vale acá no es que aparezcan los campos buenos: es que **no aparezca nada más**.
 * Por eso el test que cuenta es el que le mete propiedades prohibidas al objeto que entra y afirma
 * que no sobreviven al render — un `spread` agregado sin pensar rompe ahí.
 */

import { describe, expect, it } from 'vitest';
import { UNTRUSTED_CLOSE, UNTRUSTED_OPEN, sanitizeForPrompt, type PublicListingDTO } from '@istock/domain';
import {
  AVAILABILITY_TEXT,
  DESCRIPTION_TOKEN_BUDGET,
  listingPromptView,
  renderListingBlock,
  renderListingDigest,
} from './listing-view';
import { bloatedListingFixture, injectedListingFixture, listingFixture, reservedListingFixture } from './fixtures/listing';
import { countTokens } from './tokens';

describe('listingPromptView', () => {
  it('lleva los datos de la ficha pública mínima', () => {
    const view = listingPromptView(listingFixture());
    expect(view.name).toBe('iPhone 14 Pro 256 Grafito');
    expect(view.storageGb).toBe(256);
    expect(view.batteryPct).toBe(89);
    expect(view.screenOriginal).toBe(true);
    expect(view.priceUsdFormatted).toContain('620');
    expect(view.priceArsFormatted.length).toBeGreaterThan(0);
    expect(view.photoCount).toBe(3);
  });

  it('es una allowlist: lo que se cuele en el DTO no pasa a la vista', () => {
    const contaminado = {
      ...listingFixture(),
      costUsd: 48_000,
      margin: 14_000,
      imei: '351234567890123',
      internalNotes: 'lo trajo el mayorista de Chile',
      tenantId: 'tenant-ajeno',
    } as unknown as PublicListingDTO;

    const rendered = renderListingBlock(listingPromptView(contaminado));
    for (const leak of ['48000', '48.000', '14000', '351234567890123', 'mayorista', 'tenant-ajeno']) {
      expect(rendered, `se filtró ${leak}`).not.toContain(leak);
    }
  });

  it('no lleva identificadores internos ni URLs de fotos: no hay nada que el modelo pueda repetir', () => {
    const rendered = renderListingBlock(listingPromptView(listingFixture()));
    expect(rendered).not.toMatch(/https?:\/\//u);
    expect(rendered).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/iu);
    expect(rendered).not.toContain('img.maat.work');
  });

  it('la descripción del dueño entra sanitizada y delimitada', () => {
    const view = listingPromptView(injectedListingFixture());
    const description = view.description ?? '';
    expect(description.startsWith(UNTRUSTED_OPEN)).toBe(true);
    expect(description.endsWith(UNTRUSTED_CLOSE)).toBe(true);
    expect(description).not.toContain('<|im_start|>');
    expect(description).not.toContain('https://phishing.example');
  });

  /**
   * El techo real es el presupuesto **más los delimitadores**, y el margen se mide en vez de
   * escribirse: `sanitizeForPrompt('')` devuelve el envoltorio vacío, así que su costo es
   * exactamente lo que la delimitación agrega. Un `+ 20` puesto a ojo —que es lo que decía acá—
   * empieza a mentir el día que `packages/domain` cambia una palabra del delimitador, y miente en
   * la dirección peligrosa: dejando pasar más tokens de los que se creen.
   */
  it('la descripción entra en su presupuesto de tokens aunque el dueño escriba una novela', () => {
    const wrapperTokens = countTokens(sanitizeForPrompt(''));
    const view = listingPromptView(bloatedListingFixture());
    expect(countTokens(view.description ?? '')).toBeLessThanOrEqual(DESCRIPTION_TOKEN_BUDGET + wrapperTokens);
  });

  it('una descripción vacía es null y no una línea vacía que igual se paga', () => {
    expect(listingPromptView(listingFixture({ description: '   ' })).description).toBeNull();
    expect(listingPromptView(listingFixture({ description: null })).description).toBeNull();
  });

  it('corta puntos de retiro y medios de pago: la ficha no puede inflar el prompt por acumulación', () => {
    const view = listingPromptView(listingFixture());
    expect(view.pickup.length).toBeLessThanOrEqual(3);
    expect(view.paymentMethods.length).toBeLessThanOrEqual(6);
  });
});

describe('AVAILABILITY_TEXT', () => {
  it('reserved y sold empiezan por la negación, antes que cualquier otra cosa', () => {
    expect(AVAILABILITY_TEXT.reserved).toMatch(/^RESERVADO/u);
    expect(AVAILABILITY_TEXT.reserved).toContain('NO está disponible');
    expect(AVAILABILITY_TEXT.sold).toContain('NO está disponible');
  });

  it('available no promete stock: invita a consultar', () => {
    expect(AVAILABILITY_TEXT.available).toContain('DISPONIBLE');
  });
});

describe('renderListingBlock', () => {
  it('una ficha reservada se renderiza como no disponible (E8)', () => {
    const rendered = renderListingBlock(listingPromptView(reservedListingFixture()));
    expect(rendered).toContain('RESERVADO');
    expect(rendered).toContain('NO está disponible');
  });

  it('declara que la ficha es la única fuente de verdad', () => {
    expect(renderListingBlock(listingPromptView(listingFixture()))).toContain('única fuente de verdad');
  });

  it('no es JSON: una línea por dato, porque las llaves cuestan tokens y no dicen nada', () => {
    const rendered = renderListingBlock(listingPromptView(listingFixture()));
    expect(rendered).not.toContain('{');
    expect(rendered.split('\n').length).toBeGreaterThan(8);
  });

  it('el ARS se declara informativo, como exige la ficha pública', () => {
    expect(renderListingBlock(listingPromptView(listingFixture()))).toContain('informativo');
  });

  it('los campos ausentes no dejan líneas colgadas', () => {
    const rendered = renderListingBlock({
      ...listingPromptView(listingFixture()),
      color: null,
      warrantyText: null,
      description: null,
    });
    expect(rendered).not.toContain('Color:');
    expect(rendered).not.toContain('Garantía:');
    expect(rendered).not.toContain('Descripción del vendedor');
  });
});

describe('renderListingDigest', () => {
  it('es una línea, no una segunda copia de la ficha', () => {
    const digest = renderListingDigest(listingPromptView(listingFixture()));
    const block = renderListingBlock(listingPromptView(listingFixture()));
    expect(countTokens(digest)).toBeLessThan(countTokens(block) / 2);
  });

  it('igual dice el estado: la tool no puede ser la vía por la que se pierde el "reservado"', () => {
    expect(renderListingDigest(listingPromptView(reservedListingFixture()))).toContain('RESERVADO');
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La instrucción de `reserved` no puede habilitar un aviso que no existe
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El copy viejo decía *"se puede avisar si se libera"*. No prometía nada —habilitaba—, y por eso
 * ningún guard de salida lo veía: esa línea no sale, entra. El resto del producto ya sacó la
 * promesa (`(storefront)/_lib/status.ts` dice que no hay lista de espera; `domain/src/wa.ts` cambió
 * el mensaje a *"Sé que está reservado: si se cae, lo compro yo"*), y este archivo era la última
 * boca que decía lo viejo.
 *
 * Las tres afirmaciones de abajo son la parte que el eval no puede cubrir sola: con el proveedor
 * stubbeado la respuesta está guionada, así que cambiar el prompt no mueve ninguna respuesta. Lo
 * observable sin red es lo que se le manda al modelo, y eso es lo que se audita — acá para el
 * fragmento, y en `evals/harness.ts` para el system entero de los 174 casos.
 */
describe('AVAILABILITY_TEXT.reserved, después de sacar la promesa de aviso', () => {
  const reservedText = AVAILABILITY_TEXT.reserved;

  it('no habilita ofrecer un aviso', () => {
    expect(reservedText).not.toMatch(/(?:se\s+puede|pod[eé]s|podemos)\s+avis/iu);
    expect(reservedText).not.toMatch(/se\s+avisa/iu);
  });

  it('prohíbe explícitamente avisar y anotar: en negativo, para que el modelo no improvise', () => {
    expect(reservedText).toMatch(/NO ofrezcas avisar/u);
    expect(reservedText).toMatch(/no hay lista de espera/iu);
  });

  it('ofrece la alternativa verdadera y accionable: decírselo al vendedor ahora', () => {
    expect(reservedText).toMatch(/vendedor ahora/iu);
  });

  it('sigue empezando por la negación: lo primero que el modelo lee es que NO está disponible', () => {
    expect(reservedText.startsWith('RESERVADO')).toBe(true);
    expect(reservedText).toMatch(/NO está disponible/u);
  });

  it('la ficha renderizada de una unidad reservada arrastra la instrucción entera', () => {
    const rendered = renderListingBlock(listingPromptView(reservedListingFixture()));
    expect(rendered).toContain('no hay lista de espera');
    expect(rendered).not.toMatch(/se\s+puede\s+avis/iu);
  });
});
