import { describe, expect, it } from 'vitest';

import { buildUnitTitle } from './unit-title';

describe('buildUnitTitle', () => {
  it('compone el nombre visible desde el modelo y la variante', () => {
    expect(buildUnitTitle(' iPhone 14 Pro ', 256, ' Grafito ')).toBe('iPhone 14 Pro 256 Grafito');
  });

  it('normaliza espacios para que el slug y la ficha sean estables', () => {
    expect(buildUnitTitle('iPhone   15', 128, 'Azul   ')).toBe('iPhone 15 128 Azul');
  });

  it('puede mostrar sólo el modelo cuando el canje no trae una variante confirmada', () => {
    expect(buildUnitTitle(' iPhone 13 ', null, null)).toBe('iPhone 13');
  });
});
