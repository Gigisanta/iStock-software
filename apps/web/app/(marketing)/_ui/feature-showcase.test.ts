import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('./feature-showcase.tsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../globals.css', import.meta.url), 'utf8');

describe('feature showcase · recorrido de marketing', () => {
  it('mantiene el showcase interactivo y accesible', () => {
    expect(SOURCE).toContain("'use client';");
    expect(SOURCE).toContain('role="tablist"');
    expect(SOURCE).toContain('role="tab"');
    expect(SOURCE).toContain('aria-selected={selected}');
    expect(SOURCE).toContain('aria-controls={panelId}');
    expect(SOURCE).toContain('role="tabpanel"');
    expect(SOURCE).toContain('onKeyDown');
    expect(SOURCE).toContain('ArrowRight');
    expect(SOURCE).toContain('ArrowLeft');
    expect(SOURCE).toContain('setStorage(next.storage[0]);');
    expect(SOURCE).toContain('setColor(next.colors[0]);');
  });

  it('usa transiciones breves y respeta reduced motion', () => {
    expect(CSS).toContain('@keyframes showcase-panel-in');
    expect(CSS).toContain('@keyframes showcase-message-in');
    expect(CSS).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(CSS).toContain('.marketing-showcase-tab[aria-selected="true"]');
  });

  it('mantiene el escenario sobrio y sin adornos de interfaz falsos', () => {
    expect(SOURCE).toContain('showcase-browser-dot');
    expect(SOURCE).toContain('showcase-stage-status');
    expect(SOURCE).toContain('Ficha lista para publicar');
    expect(SOURCE).not.toContain('↗');
    expect(SOURCE).not.toMatch(/eyebrow:\s*'0[1-9]/);
    expect(SOURCE).toContain('/marketing/storefront-preview.png');
    expect(SOURCE).toContain('showcase-model-select');
    expect(SOURCE).not.toContain('aria-hidden="true">0{String(index + 1)}');
    expect(SOURCE).not.toContain('showcase-product-photo');
    expect(SOURCE).not.toContain('showcase-stock-thumb');
    expect(CSS).toContain('.showcase-browser-dot');
    expect(CSS).toContain('@keyframes showcase-status-pulse');
  });
});
