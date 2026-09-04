/**
 * Presentación de la identidad del panel.
 *
 * El tenant sembrado para QA es una fixture técnica, no una marca que el dueño tenga que ver
 * mientras prueba el producto. La base conserva su nombre para que los gates puedan reconocerlo;
 * acá se separa esa identidad de la marca del producto y se limpia sólo la etiqueta de demo.
 * Los negocios reales salen intactos.
 */

export interface PanelTenantIdentity {
  readonly name: string;
  readonly isDemo: boolean;
}

export function panelTenantName(tenant: PanelTenantIdentity): string {
  const name = tenant.name.trim();
  if (!tenant.isDemo) return name;

  const withoutDemoPrefix = name.replace(/^iStock\s+Demo\s*(?:[,—–-]\s*)?/iu, '').trim();
  return withoutDemoPrefix === '' ? 'Tu negocio' : withoutDemoPrefix;
}

export function panelStorefrontLabel(
  tenant: Pick<PanelTenantIdentity, 'isDemo'>,
  storefrontHost: string,
): string {
  return tenant.isDemo ? 'Abrir tu vidriera' : storefrontHost;
}
