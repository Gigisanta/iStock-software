import { describe, expect, it } from 'vitest';
import { panelStorefrontLabel, panelTenantName } from './panel-identity';

describe('identidad del panel', () => {
  it('separa la fixture técnica de la marca que ve el dueño', () => {
    const tenant = { name: 'iStock Demo, Alto Valle', isDemo: true } as const;

    expect(panelTenantName(tenant)).toBe('Alto Valle');
    expect(panelTenantName(tenant)).not.toContain('iStock Demo');
    expect(panelStorefrontLabel(tenant, 'demo.maat.work')).toBe('Abrir tu vidriera');
  });

  it('no cambia el nombre ni el dominio de un negocio real', () => {
    const tenant = { name: 'Norte Cel', isDemo: false } as const;

    expect(panelTenantName(tenant)).toBe('Norte Cel');
    expect(panelStorefrontLabel(tenant, 'nortecel.maat.work')).toBe('nortecel.maat.work');
  });

  it('evita dejar una etiqueta vacía si una fixture no tiene nombre usable', () => {
    expect(panelTenantName({ name: 'iStock Demo', isDemo: true })).toBe('Tu negocio');
  });
});
