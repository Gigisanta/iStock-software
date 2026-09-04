import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BRAND_SOURCE = readFileSync(new URL('./panel-brand.tsx', import.meta.url), 'utf8');
const NAV_SOURCE = readFileSync(new URL('./bottom-nav-view.tsx', import.meta.url), 'utf8');

describe('identidad de producto en el panel', () => {
  it('usa el lockup real de iStock y vuelve al inicio del panel', () => {
    expect(BRAND_SOURCE).toContain('aria-label="iStock · Ir al inicio"');
    expect(BRAND_SOURCE).toContain('<span aria-hidden="true">iStock</span>');
    expect(BRAND_SOURCE).toContain("'/brand/logo-horizontal.svg'");
    expect(BRAND_SOURCE).toContain("'/brand/mark.svg'");
  });

  it('la navegación de escritorio tiene una marca visible sin quitar la nav mobile', () => {
    expect(NAV_SOURCE).toContain('className="panel-nav-brand"');
    expect(NAV_SOURCE).toContain('<PanelBrand variant="full" />');
    expect(NAV_SOURCE).toContain('aria-label="Secciones del panel"');
  });
});
