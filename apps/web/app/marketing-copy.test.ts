import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HOME = readFileSync(new URL('./(marketing)/page.tsx', import.meta.url), 'utf8');
const PRICING = readFileSync(new URL('./(marketing)/precios/page.tsx', import.meta.url), 'utf8');

describe('copy pública de la vidriera', () => {
  it('usa el placeholder de dominio legible en todas las superficies de conversión', () => {
    for (const source of [HOME, PRICING]) {
      expect(source).toContain('tu-negocio.maat.work');
      expect(source).not.toContain('tunegocio.maat.work');
    }
  });
});
