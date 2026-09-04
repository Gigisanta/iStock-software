import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const PANEL_LAYOUT = readFileSync(new URL('./(app)/app/(panel)/layout.tsx', import.meta.url), 'utf8');
const LOGO = readFileSync(new URL('../public/brand/logo-horizontal.svg', import.meta.url), 'utf8');
const MARK = readFileSync(new URL('../public/brand/mark.svg', import.meta.url), 'utf8');
const APP_ROOT = fileURLToPath(new URL('.', import.meta.url));

function productionUiSources(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return productionUiSources(absolutePath);
    return /\.(css|svg|tsx)$/u.test(entry.name) && !entry.name.endsWith('.test.ts')
      ? [absolutePath]
      : [];
  });
}

const COLORED_UI_UTILITY =
  /\b(?:bg|text|border|ring)-(?:emerald|green|teal|lime|sky|violet|blue|purple|pink|cyan|indigo|orange)-\d+/iu;

describe('sistema visual monocromático', () => {
  it('mantiene el acento de marca en negro/blanco y no vuelve al verde global', () => {
    expect(CSS).toContain('--accent: #111111;');
    expect(CSS).toContain('--accent-strong: #080808;');
    expect(CSS).not.toMatch(/#(?:000000|ffffff)\b/iu);
    expect(CSS).toContain('--surface-tint: #eeeeee;');
    expect(CSS).not.toMatch(/emerald|green|#087f5b|#2f8f68/iu);
    expect(CSS).not.toContain('backdrop-filter');
    expect(CSS).not.toMatch(/html\s*\{[^}]*min-width:\s*320px;/su);
    expect(CSS).toMatch(/\.account-panel\s*\{[^}]*min-width:\s*0;/su);
    expect(CSS).toMatch(/\.account-form\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/su);
    expect(CSS).toMatch(/\.account-form\s*>\s*\*\s*\{[^}]*min-width:\s*0;/su);
    expect(PANEL_LAYOUT).not.toMatch(/backdrop-(?:blur|filter)|bg-(?:white|black)\/\d+/iu);
  });

  it('usa el mismo lockup monocromático en claro y oscuro', () => {
    expect(LOGO).toContain('--istock-accent: #111111;');
    expect(LOGO).toContain('--istock-accent: #f5f5f5;');
    expect(MARK).toContain('--istock-accent: #111111;');
    expect(MARK).toContain('--istock-accent: #f5f5f5;');
    expect(`${LOGO}\n${MARK}`).not.toMatch(/#2f8f68|#111513|#e8efe9/iu);
  });

  it('no reintroduce acentos de color en la UI de producción', () => {
    const offenders = productionUiSources(APP_ROOT)
      .map((file) => ({ file, contents: readFileSync(file, 'utf8') }))
      .filter(({ contents }) => COLORED_UI_UTILITY.test(contents))
      .map(({ file }) => file.replace(`${APP_ROOT}/`, ''));

    expect(offenders).toEqual([]);
  });
});
