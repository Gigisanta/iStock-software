import 'server-only';

import { and, eq, inArray, ne } from 'drizzle-orm';
import { fxSettings, tenants } from '@istock/db';
import { withServiceDb } from '../db/session';
import { invalidateStorefront } from '../tenants/storefront-cache';

/** API pública y sin autenticación del BCRA para la última cotización cambiaria disponible. */
export const BCRA_FX_URL = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones';

const REQUEST_TIMEOUT_MS = 5_000;

/** Una cotización por día y una sola petición concurrente por instancia de función. */
let dailyQuote: { readonly fetchedOn: string; readonly quote: AutomaticFxQuote } | null = null;
let pendingQuote: Promise<AutomaticFxQuote> | null = null;

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

async function requestAutomaticFxQuote(): Promise<AutomaticFxQuote> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    // Keep the init object inferred instead of forcing the DOM-only `RequestInit` type in
    // independent Node probes. Next's fetch honors `cache: 'no-store'`, while the object itself
    // remains structurally compatible with Node's fetch declaration.
    const requestInit = {
      headers: { accept: 'application/json' },
      cache: 'no-store' as const,
      signal: controller.signal,
    };
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

/** Obtiene una cotización validada sin golpear BCRA repetidamente durante el mismo día. */
export async function fetchAutomaticFxQuote(): Promise<AutomaticFxQuote> {
  const fetchedOn = new Date().toISOString().slice(0, 10);
  if (dailyQuote?.fetchedOn === fetchedOn) return dailyQuote.quote;
  if (pendingQuote !== null) return pendingQuote;

  const request = requestAutomaticFxQuote().then((quote) => {
    dailyQuote = { fetchedOn, quote };
    return quote;
  });
  pendingQuote = request;
  try {
    return await request;
  } finally {
    if (pendingQuote === request) pendingQuote = null;
  }
}

/** Sólo para tests: el cache real vive un día y no se vacía durante una corrida normal. */
export function resetAutomaticFxQuoteCache(): void {
  dailyQuote = null;
  pendingQuote = null;
}

/**
 * Actualiza el TC diario en una sola operación y purga las dos entradas de cache sólo para los
 * tenants cuyo valor cambió. El cron de reservas corre cada cinco minutos: escribir `updated_at`
 * e invalidar toda la vidriera en cada corrida aunque el BCRA devuelva el mismo valor destruiría
 * el cache hit rate y convertiría una tarea de reconciliación en una escritura global periódica.
 *
 * web-lint:sin-tenant el scheduler no tiene sesión y debe refrescar todos los tenants activos
 */
export async function refreshAutomaticFxSettings(): Promise<AutomaticFxRefresh> {
  const quote = await fetchAutomaticFxQuote();

  const changedSlugs = await withServiceDb(async (tx) => {
    // Es una lectura deliberadamente global: el job es el único llamador y debe refrescar todos.
    const rows = await tx
      .select({ tenantId: fxSettings.tenantId, slug: tenants.slug })
      .from(fxSettings)
      .innerJoin(tenants, eq(tenants.id, fxSettings.tenantId))
      .where(ne(fxSettings.arsPerUsd, quote.arsCentsPerUsd));

    const tenantIds = rows.map((row) => row.tenantId);
    if (tenantIds.length === 0) return [];

    const updated = await tx
        .update(fxSettings)
        .set({ arsPerUsd: quote.arsCentsPerUsd, updatedBy: null, updatedAt: new Date() })
        .where(
          and(
            inArray(fxSettings.tenantId, tenantIds),
            ne(fxSettings.arsPerUsd, quote.arsCentsPerUsd),
          ),
        )
        .returning({ tenantId: fxSettings.tenantId });

    const updatedIds = new Set(updated.map((row) => row.tenantId));

    return rows.filter((row) => updatedIds.has(row.tenantId)).map((row) => row.slug);
  });

  for (const slug of changedSlugs) invalidateStorefront(slug);

  return { ...quote, updatedTenants: changedSlugs.length };
}
