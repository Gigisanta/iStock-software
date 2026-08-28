import type { AcceptTradeinField } from '../../../../_lib/tradein/schema';

/**
 * Estado del formulario de aceptar un canje. Vive aparte de `actions.ts` porque un archivo
 * `'use server'` sólo puede exportar funciones `async`.
 *
 * ── `values` guarda strings, no el input parseado ────────────────────────────────────────────
 * Si aceptar falla, el formulario tiene que volver con lo que la persona escribió, tal cual lo
 * escribió. Devolver `offerUsdCents: 62000` obligaría a re-formatear y le cambiaría el `620,00`
 * por un `620` que ella no puso. Mismo criterio que `stock/nuevo/form-state.ts`.
 *
 * ── `offerUsd` es un string acá y no es una fuga ─────────────────────────────────────────────
 * Es lo que escribió **quien está mirando la pantalla**, devuelto a esa misma pantalla, y este
 * formulario sólo se le dibuja a un `owner`. La regla de §0.9 es sobre datos que el servidor le
 * manda a un `seller`; el eco de su propio input a quien lo tipeó no es eso. Un `seller` no llega
 * hasta acá: la página no le dibuja el form y la Server Action lo rechaza igual.
 */

export type { AcceptTradeinField };

export interface AcceptFormValues {
  readonly title: string;
  readonly catalogModelId: string;
  readonly condition: string;
  readonly storageGb: string;
  readonly color: string;
  readonly batteryPct: string;
  readonly priceUsd: string;
  readonly offerUsd: string;
}

export interface AcceptFormState {
  readonly errors: Partial<Record<AcceptTradeinField, string>>;
  /** `null` en el estado inicial: la pantalla usa la precarga del lead, no un eco. */
  readonly values: AcceptFormValues | null;
}

export const initialAcceptFormState: AcceptFormState = { errors: {}, values: null };
