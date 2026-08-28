import { describe, expect, it } from 'vitest';
import {
  RESERVATION_DEFAULT_MINUTES,
  RESERVATION_MAX_MINUTES,
  RESERVATION_MIN_MINUTES,
} from '@istock/domain';
import { cancelReservationSchema, reserveUnitSchema } from './schema';

/**
 * El borde de la reserva. Lo que se prueba acá es lo que `CLAUDE.md` §5 llama "Zod en todos los
 * bordes": el `FormData` de la pantalla es input de cualquiera, no del formulario que escribimos.
 *
 * El caso que importa y que no es obvio: **fuera de rango se RECHAZA, no se clampea**. Un
 * `Math.min(120, Math.max(30, minutes))` deja pasar un `9999` como `120` y el dueño nunca se
 * entera de que pidió otra cosa. Además el `CHECK` de Postgres (`minutes between 30 and 120`)
 * rebotaría igual, y su mensaje viene en inglés y con la fila adentro.
 */

const LISTING_ID = '3f2b1a90-7c4d-4e21-9b8a-0c1d2e3f4a5b';

const parse = (patch: Record<string, unknown> = {}) =>
  reserveUnitSchema.safeParse({
    listingId: LISTING_ID,
    minutes: '60',
    customerLabel: '',
    ...patch,
  });

describe('reserveUnitSchema · duración', () => {
  it('acepta el mínimo, el default y el máximo', () => {
    for (const minutes of [RESERVATION_MIN_MINUTES, RESERVATION_DEFAULT_MINUTES, RESERVATION_MAX_MINUTES]) {
      const result = parse({ minutes: String(minutes) });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.minutes).toBe(minutes);
    }
  });

  it('sin valor usa el default de 60, que es el del dominio', () => {
    const result = parse({ minutes: '' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.minutes).toBe(RESERVATION_DEFAULT_MINUTES);
  });

  it('rechaza fuera de rango en vez de clampear', () => {
    for (const minutes of ['29', '121', '0', '-60', '99999']) {
      const result = parse({ minutes });
      expect(result.success, `minutes=${minutes} tendría que rebotar`).toBe(false);
    }
  });

  it('rechaza lo que no es un entero de minutos', () => {
    for (const minutes of ['60.5', 'sesenta', '6 0', ' ', '060x']) {
      const result = parse({ minutes });
      expect(result.success, `minutes=${JSON.stringify(minutes)} tendría que rebotar`).toBe(false);
    }
  });

  it('el mensaje de rango está en castellano y nombra los dos extremos', () => {
    const result = parse({ minutes: '121' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? '';
      expect(message).toContain(String(RESERVATION_MIN_MINUTES));
      expect(message).toContain(String(RESERVATION_MAX_MINUTES));
    }
  });
});

describe('reserveUnitSchema · resto del borde', () => {
  it('rechaza un listingId que no es uuid', () => {
    expect(parse({ listingId: '1; drop table listings' }).success).toBe(false);
  });

  it('la etiqueta vacía se guarda como null, no como cadena vacía', () => {
    const result = parse({ customerLabel: '   ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.customerLabel).toBeNull();
  });

  it('la etiqueta se recorta y colapsa espacios', () => {
    const result = parse({ customerLabel: '  Juan   de Cipolletti  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.customerLabel).toBe('Juan de Cipolletti');
  });

  it('rechaza una etiqueta larguísima: no es un campo de notas', () => {
    expect(parse({ customerLabel: 'x'.repeat(200) }).success).toBe(false);
  });

  it('rechaza un valor que no es texto (un File del FormData)', () => {
    expect(parse({ minutes: 60 }).success).toBe(false);
  });
});

describe('cancelReservationSchema', () => {
  it('acepta un uuid', () => {
    expect(cancelReservationSchema.safeParse({ listingId: LISTING_ID }).success).toBe(true);
  });

  it('rechaza cualquier otra cosa', () => {
    expect(cancelReservationSchema.safeParse({ listingId: 'nope' }).success).toBe(false);
    expect(cancelReservationSchema.safeParse({}).success).toBe(false);
  });
});
