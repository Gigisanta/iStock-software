import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CONFIG = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8');
const FORBIDDEN = readFileSync(new URL('./forbidden.tsx', import.meta.url), 'utf8');
const SESSION = readFileSync(new URL('./(app)/_lib/session.ts', import.meta.url), 'utf8');

describe('403 de panel', () => {
  it('habilita el boundary experimental que renderiza forbidden() para un rol insuficiente', () => {
    expect(CONFIG).toMatch(/authInterrupts:\s*true/u);
    expect(SESSION).toContain("import { forbidden, redirect } from 'next/navigation';");
    expect(SESSION).toContain("if (session.role !== 'owner') forbidden();");
    expect(SESSION).not.toContain('PanelForbiddenError');
  });

  it('tiene una pantalla de permisos clara, navegable y sin cliente innecesario', () => {
    expect(FORBIDDEN).not.toContain("'use client'");
    expect(FORBIDDEN).toContain('No tenés permiso para ver esta pantalla');
    expect(FORBIDDEN).toContain('href="/app"');
    expect(FORBIDDEN).toContain('data-auth="forbidden"');
  });
});
