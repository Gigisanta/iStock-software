import { describe, expect, it } from 'vitest';

import { isBlank } from './text';

describe('isBlank — el criterio único de "vacío"', () => {
  it('T1 — la cadena vacía es vacía', () => {
    expect(isBlank('')).toBe(true);
  });

  it('T2 — sólo whitespace también es vacío: `NOT NULL` no es `no vacío`', () => {
    // Los tres son valores representables en un `text not null` sin CHECK.
    for (const blank of [' ', '   ', '\t', '\n', '\r\n', '\t\n  ', ' ', '  \t']) {
      expect(isBlank(blank)).toBe(true);
    }
  });

  it('T3 — un texto con contenido no es vacío, aunque venga rodeado de espacios', () => {
    for (const filled of ['a', 'iPhone 14 Pro', '  iPhone 14 Pro  ', '\n0\n', '0', '-', '.']) {
      expect(isBlank(filled)).toBe(false);
    }
  });

  it('T4 — es exactamente `trim().length === 0`, sin sorpresas de coerción', () => {
    // La propiedad, escrita como propiedad: si `trim()` deja algo, no está en blanco.
    for (const sample of ['', ' ', 'x', ' x ', ' ', 'iPhone 14']) {
      expect(isBlank(sample)).toBe(sample.trim().length === 0);
    }
  });
});
