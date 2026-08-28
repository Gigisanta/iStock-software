/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El fallback del nombre, testeado DONDE VIVE EL MAPEO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `packages/domain` ya prueba que `describeListing` no repite storage ni color cuando le dicen
 * `nameSource: 'free_text'`. Eso es la mitad de abajo del bug. La mitad de arriba —**quién decide
 * cuál de los dos es**— vive acá, en el read model de la vidriera, y es la que falló en producción:
 * el 2026-08-28 W5 imprimió, de un browser real,
 *
 *     Hola, vi el iPhone 14 Pro 256 Grafito 256 Grafito (usado A) a USD 620 en … y lo quiero.
 *
 * porque `toSource` mandaba el título libre del dueño como si fuera el `display_name` limpio del
 * catálogo. Un test que sólo viva en dominio deja ese camino sin cubrir para siempre: el dominio
 * hace lo correcto con el discriminante que le pasan, y el defecto era el discriminante.
 *
 * Por eso `resolveModelName` es una función aparte y pura: `listings.ts` importa `server-only`,
 * `next/cache` y `@istock/db`, así que no se puede instanciar desde Vitest. La alternativa —afirmar
 * sobre el texto del archivo— diría que la línea está escrita, no que el mensaje sale bien. Acá el
 * test arma el DTO de verdad y lee el `waMessage` que le llegaría al dueño por WhatsApp.
 *
 * El guard de que `listings.ts` sigue usando esta función (y no vuelve a escribir el literal a
 * mano para callar al compilador) está en `ficha.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { fxRateFromArsCents, publicListingDTO, type PublicListingSource } from '@istock/domain';
import { resolveModelName } from './model-name';

/** El string de `CLAUDE.md` §1, byte a byte. No se compone: se pega. */
const CANONICO =
  'Hola, vi el iPhone 14 Pro 256 Grafito (usado A) a USD 620 en nortecel.maat.work y lo quiero.';

/**
 * La fila del equipo de referencia, con el `title` tal cual lo escribe un reseller —que **ya trae
 * storage y color adentro**, porque así es como lo escribe— y el resto del contexto del tenant.
 * `modelDisplayName`/`nameSource` los pone cada caso, que es lo que este archivo prueba.
 */
function source(row: { modelDisplayName: string | null; title?: string }): PublicListingSource {
  const title = row.title ?? 'iPhone 14 Pro 256 Grafito';
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'iphone-14-pro-256-grafito-ab12',
    tenantSlug: 'nortecel',
    tenantWaPhone: '5492994123456',
    title,
    ...resolveModelName({ modelDisplayName: row.modelDisplayName, title }),
    storageGb: 256,
    color: 'Grafito',
    condition: 'used_excellent',
    batteryPct: 89,
    screenOriginal: true,
    icloudStatusText: 'Libre de iCloud',
    warrantyText: '3 meses',
    provenanceText: 'Compra a particular',
    description: null,
    priceUsdCents: 62_000,
    fxRate: fxRateFromArsCents(148_750),
    fxRounding: 'ceil_1000',
    status: 'available',
    photos: [],
    pickupPoints: [{ name: 'Cipolletti centro', address: 'Fernández Oro 123', hours: 'Lun a Vie 10 a 18' }],
    paymentMethods: ['Efectivo', 'Transferencia'],
    acceptsTradeIn: true,
  };
}

/** El mensaje que el visitante manda de verdad, pasando por el único camino de datos de la vista. */
function mensaje(row: { modelDisplayName: string | null; title?: string }): string {
  return publicListingDTO(source(row) as PublicListingSource & Record<string, unknown>).waMessage;
}

describe('resolveModelName — quién es el nombre del equipo', () => {
  it('M-N1 — con `catalog_model` el nombre es el del catálogo y la procedencia es `catalog`', () => {
    expect(resolveModelName({ modelDisplayName: 'iPhone 14 Pro', title: 'iPhone 14 Pro 256 Grafito' })).toEqual({
      nameSource: 'catalog',
      modelDisplayName: 'iPhone 14 Pro',
    });
  });

  it('M-N2 — sin `catalog_model` el nombre es el título del dueño y la procedencia es `free_text`', () => {
    // `catalog_model_id` es nullable **y** `on delete set null`: este camino no es teórico. Pasa
    // cuando el dueño carga sin elegir modelo, y le pasa de golpe a todos los listings de un modelo
    // el día que ese modelo se borra del catálogo.
    expect(resolveModelName({ modelDisplayName: null, title: 'iPhone 14 Pro 256 Grafito' })).toEqual({
      nameSource: 'free_text',
      modelDisplayName: 'iPhone 14 Pro 256 Grafito',
    });
  });

  it('M-N3 — un `display_name` vacío o en blanco cuenta como ausente, no como nombre', () => {
    // `catalog_models.display_name` es `text not null` **sin CHECK de longitud**: `''` es un valor
    // representable en la base. Con el mapeo ingenuo (`?? title`) un `''` no dispara el `??`, así
    // que el equipo se nombraría con la cadena vacía y el mensaje empezaría con un espacio.
    for (const vacio of ['', '   ', '\t\n']) {
      expect(resolveModelName({ modelDisplayName: vacio, title: 'iPhone 14 Pro 256 Grafito' })).toEqual({
        nameSource: 'free_text',
        modelDisplayName: 'iPhone 14 Pro 256 Grafito',
      });
    }
  });

  it('M-N4 — el título nunca viaja como si fuera nombre de catálogo', () => {
    // La propiedad, escrita como propiedad y no como caso: si el nombre elegido **es** el título,
    // la procedencia tiene que ser `free_text`. Es exactamente lo que el bug violaba.
    for (const displayName of [null, '', 'iPhone 14 Pro']) {
      const resolved = resolveModelName({ modelDisplayName: displayName, title: 'iPhone 14 Pro 256 Grafito' });
      if (resolved.modelDisplayName === 'iPhone 14 Pro 256 Grafito') {
        expect(resolved.nameSource).toBe('free_text');
      } else {
        expect(resolved.nameSource).toBe('catalog');
      }
    }
  });
});

describe('el mensaje de WhatsApp que sale del read model', () => {
  it('M-N5 — con catálogo: el string de CLAUDE.md §1, byte a byte', () => {
    expect(mensaje({ modelDisplayName: 'iPhone 14 Pro' })).toBe(CANONICO);
  });

  it('M-N6 — sin catálogo: el MISMO string. No repite storage ni color', () => {
    // La regresión medida por W5 el 2026-08-28. Los dos caminos tienen que converger en el mismo
    // byte: el reseller no tiene por qué saber si el equipo tenía `catalog_model` cargado.
    const salida = mensaje({ modelDisplayName: null });
    expect(salida).toBe(CANONICO);
    expect(salida).not.toContain('256 Grafito 256 Grafito');
  });

  it('M-N7 — sin catálogo y con título pelado, el mensaje sigue nombrando el equipo entero', () => {
    // No alcanza con "no appendear nunca": un título sin storage ni color dejaría el mensaje
    // ambiguo para el dueño que tiene tres iPhone 14 Pro, y el mensaje no lleva la URL de la ficha.
    expect(mensaje({ modelDisplayName: null, title: 'iPhone 14 Pro' })).toBe(CANONICO);
  });

  it('M-N8 — el `display_name` vacío no deja un mensaje que empiece con un espacio', () => {
    expect(mensaje({ modelDisplayName: '   ' })).toBe(CANONICO);
  });
});
