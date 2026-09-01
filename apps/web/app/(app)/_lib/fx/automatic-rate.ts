import 'server-only';

import { eq, inArray } from 'drizzle-orm';
import { fxSettings, tenants } from '@istock/db';
import { withServiceDb } from '../db/session';
import { invalidateStorefront } from '../tenants/storefront-cache';

/** API pública y sin autenticación del BCRA para la última cotización cambiaria disponible. */
export const BCRA_FX_URL = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones';

const REQUEST_TIMEOUT_MS = 5_000;

export interface AutomaticFxQuote {
  readonly arsCentsPerUsd: number;
  readonly asOf: string;
  readonly source: 'bcra';
}

export interface AutomaticFxRefresh {
  readonly arsCentsPerUsd: number;
  readonly asOf: string;
  readonly source: 'bcra';
  readonly updatedTenants: number;
}

export class AutomaticFxError extends Error {
  readonly code = 'AUTOMATIC_FX_UNAVAILABLE';

  constructor() {
    super('No pudimos obtener la cotización automática.');
    this.name = 'AutomaticFxError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Valida el JSON del BCRA antes de convertirlo en dinero.
 * `tipoCotizacion` es ARS por USD y se guarda como centavos para no usar floats en el dominio.
 */
export function parseBcraUsdQuote(payload: unknown): AutomaticFxQuote | null {
  const root = record(payload);
  const results = record(root?.['results']);
  const details = results?.['detalle'];
  const asOf = results?.['fecha'];

  if (root?.['status'] !== 200 || typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(asOf)) {
    return null;
  }
  if (!Array.isArray(details)) return null;

  const usd = details
    .map(record)
    .find((item) => item?.['codigoMoneda'] === 'USD');
  const arsPerUsd = usd?.['tipoCotizacion'];
  if (typeof arsPerUsd !== 'number' || !Number.isFinite(arsPerUsd) || arsPerUsd <= 0) return null;

  const arsCentsPerUsd = Math.round(arsPerUsd * 100);
  if (!Number.isSafeInteger(arsCentsPerUsd) || arsCentsPerUsd <= 0) return null;

  return { arsCentsPerUsd, asOf, source: 'bcra' };
}

/** Obtiene una cotización validada, con timeout corto y sin exponer el body del proveedor. */
export async function fetchAutomaticFxQuote(): Promise<AutomaticFxQuote> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const requestInit = {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    } as RequestInit & { cache: 'no-store' };
    const response = await fetch(BCRA_FX_URL, requestInit);
    if (!response.ok) throw new AutomaticFxError();

    const quote = parseBcraUsdQuote(await response.json());
    if (quote === null) throw new AutomaticFxError();
    return quote;
  } catch (error) {
    if (error instanceof AutomaticFxError) throw error;
    throw new AutomaticFxError();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Actualiza el TC diario en una sola operación y purga las dos entradas de cache de cada tenant.
 *
 * web-lint:sin-tenant el scheduler no tiene sesión y debe refrescar todos los tenants activos
 */
export async function refreshAutomaticFxSettings(): Promise<AutomaticFxRefresh> {
  const quote = await fetchAutomaticFxQuote();

  const slugs = await withServiceDb(async (tx) => {
    // Es una lectura deliberadamente global: el job es el único llamador y debe refrescar todos.
    const rows = await tx
      .select({ tenantId: fxSettings.tenantId, slug: tenants.slug })
      .from(fxSettings)
      .innerJoin(tenants, eq(tenants.id, fxSettings.tenantId));

    const tenantIds = rows.map((row) => row.tenantId);
    if (tenantIds.length > 0) {
      await tx
        .update(fxSettings)
        .set({ arsPerUsd: quote.arsCentsPerUsd, updatedBy: null, updatedAt: new Date() })
        .where(inArray(fxSettings.tenantId, tenantIds));
    }

    return rows.map((row) => row.slug);
  });

  for (const slug of slugs) invalidateStorefront(slug);

  return { ...quote, updatedTenants: slugs.length };
}
