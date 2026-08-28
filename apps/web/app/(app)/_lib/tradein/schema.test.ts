/**
 * El borde de aceptar un canje. Sin Postgres y sin sesión: es Zod puro sobre un `FormData`.
 *
 * Lo que se afirma acá no es "Zod funciona" —eso lo prueba Zod— sino las decisiones de este
 * producto que viven en el schema y que un refactor puede aflojar sin que nada más lo note:
 *
 *   · `offerUsd` es **obligatorio**: una unidad que entra por canje sin costo miente el margen para
 *     siempre y no hay pantalla que lo arregle después.
 *   · Los rangos son los `CHECK` de Postgres (`price_usd > 0`, `cost_usd >= 0`, batería 0–100), así
 *     que un dato malo se rechaza **antes** de que Postgres tenga que contestar con un mensaje que
 *     incluye la fila —y la fila de un canje tiene el nombre y el WhatsApp del visitante.
 *   · Sólo se leen las claves que el schema declara: lo que venga de más en el `FormData` no viaja.
 */
import { describe, expect, it } from 'vitest';
import { parseAcceptTradeinForm, type AcceptTradeinField } from './schema';

const LEAD_ID = '11111111-2222-4333-8444-555555555555';
const MODEL_ID = '99999999-8888-4777-8666-555555555555';

function form(over: Readonly<Record<string, string>> = {}): FormData {
  const base: Record<string, string> = {
    leadId: LEAD_ID,
    title: 'iPhone 13 128 Medianoche',
    catalogModelId: MODEL_ID,
    condition: 'used_excellent',
    storageGb: '128',
    color: 'Medianoche',
    batteryPct: '87',
    priceUsd: '560',
    offerUsd: '420',
    ...over,
  };
  const fd = new FormData();
  for (const [key, value] of Object.entries(base)) fd.set(key, value);
  return fd;
}

function errorDe(fd: FormData, field: AcceptTradeinField): string {
  const parsed = parseAcceptTradeinForm(fd);
  if (parsed.ok) throw new Error(`se esperaba un error en "${field}" y el borde aceptó el form`);
  const message = parsed.errors[field];
  if (message === undefined) {
    throw new Error(`se esperaba un error en "${field}" y los que hubo fueron: ${Object.keys(parsed.errors).join(', ')}`);
  }
  return message;
}

describe('control positivo', () => {
  it('acepta el form completo y devuelve centavos, no strings', () => {
    const parsed = parseAcceptTradeinForm(form());
    if (!parsed.ok) throw new Error(`el borde rechazó un form válido: ${JSON.stringify(parsed.errors)}`);

    expect(parsed.data).toEqual({
      leadId: LEAD_ID,
      title: 'iPhone 13 128 Medianoche',
      catalogModelId: MODEL_ID,
      condition: 'used_excellent',
      storageGb: 128,
      color: 'Medianoche',
      batteryPct: 87,
      priceUsd: 56_000,
      offerUsd: 42_000,
    });
  });

  it('los opcionales vacíos quedan en null, no en 0 ni en cadena vacía', () => {
    const parsed = parseAcceptTradeinForm(form({ storageGb: '', color: '', batteryPct: '' }));
    if (!parsed.ok) throw new Error('el borde rechazó un form con opcionales vacíos');
    expect(parsed.data.storageGb).toBeNull();
    expect(parsed.data.color).toBeNull();
    expect(parsed.data.batteryPct).toBeNull();
  });

  it('acepta una oferta de cero: el CHECK de Postgres la acepta y el mostrador también', () => {
    const parsed = parseAcceptTradeinForm(form({ offerUsd: '0' }));
    if (!parsed.ok) throw new Error('el borde rechazó una oferta de cero');
    expect(parsed.data.offerUsd).toBe(0);
  });

  it('ignora las claves que el schema no declara', () => {
    const fd = form();
    fd.set('costUsd', '999');
    fd.set('internalNotes', 'lo que sea');
    fd.set('tenantId', 'otro-tenant');

    const parsed = parseAcceptTradeinForm(fd);
    if (!parsed.ok) throw new Error('el borde rechazó un form válido con claves de más');
    expect(Object.keys(parsed.data).sort()).toEqual([
      'batteryPct',
      'catalogModelId',
      'color',
      'condition',
      'leadId',
      'offerUsd',
      'priceUsd',
      'storageGb',
      'title',
    ]);
  });
});

describe('el costo del canje es obligatorio', () => {
  it('sin oferta no se acepta', () => {
    expect(errorDe(form({ offerUsd: '' }), 'offerUsd')).toContain('cuánto le pagás');
  });

  it('una oferta negativa se rechaza', () => {
    expect(errorDe(form({ offerUsd: '-10' }), 'offerUsd')).toBeTruthy();
  });
});

describe('los rangos son los CHECK de Postgres', () => {
  it('precio en cero: listings_price_positive', () => {
    expect(errorDe(form({ priceUsd: '0' }), 'priceUsd')).toContain('mayor a cero');
  });

  it('batería fuera de 0–100: listings_battery_range', () => {
    expect(errorDe(form({ batteryPct: '120' }), 'batteryPct')).toContain('0 a 100');
  });

  it('GB en cero: listings_storage_positive', () => {
    expect(errorDe(form({ storageGb: '0' }), 'storageGb')).toContain('mayor a cero');
  });

  it('título de dos letras', () => {
    expect(errorDe(form({ title: 'ab' }), 'title')).toContain('al menos 3');
  });
});

describe('lo que viene del cliente y podría llegar crudo a Postgres', () => {
  it('un leadId que no es uuid no llega a un where', () => {
    expect(errorDe(form({ leadId: "1 or '1'='1" }), 'leadId')).toBe('Falta el canje.');
  });

  it('un catalogModelId que no es uuid tampoco', () => {
    expect(errorDe(form({ catalogModelId: 'iphone-13' }), 'catalogModelId')).toContain('Elegí el modelo');
  });

  it('una condición que no está en el enum del dominio', () => {
    expect(errorDe(form({ condition: 'impecable' }), 'condition')).toContain('de la lista');
  });

  it('un campo ausente del FormData se trata como vacío, no revienta', () => {
    const fd = form();
    fd.delete('title');
    expect(errorDe(fd, 'title')).toContain('al menos 3');
  });
});
