import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HOME_SOURCE = readFileSync(new URL('../app/(panel)/page.tsx', import.meta.url), 'utf8');

describe('accesos del inicio del panel', () => {
  it('presenta Canjes como un flujo disponible', () => {
    expect(HOME_SOURCE).toContain('<Tile href="/app/canjes"');
    expect(HOME_SOURCE).toContain('note="Revisá y aceptá equipos"');
    expect(HOME_SOURCE).not.toContain('title="Canjes" note="Todavía no"');
  });
});
