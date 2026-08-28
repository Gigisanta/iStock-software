/**
 * Estado del formulario de alta. Vive aparte de `actions.ts` porque un archivo `'use server'`
 * sólo puede exportar funciones async.
 *
 * ── `values` guarda strings, no el input parseado ────────────────────────────────────────────
 * Si el alta falla, el formulario tiene que volver con lo que la persona escribió, tal cual lo
 * escribió. Devolver `priceUsdCents: 62000` obligaría a re-formatear y le cambiaría el `620,00`
 * por un `620` que ella no puso.
 *
 * ── La foto NO se puede repoblar ─────────────────────────────────────────────────────────────
 * Ningún navegador deja setear el `value` de un `<input type="file">` por seguridad. Cuando el
 * alta falla hay que volver a elegirla, y la pantalla lo dice en vez de dejar el campo vacío sin
 * explicación.
 *
 * Es **una** foto y el campo se llama `photo`: entra una por request (techo de 4 MB del Routing
 * Middleware, ver `_lib/listings/schema.ts`). Las otras dos se cargan en `/app/stock/{id}/fotos`.
 */

export type NewUnitField =
  | 'title'
  | 'catalogModelId'
  | 'condition'
  | 'storageGb'
  | 'color'
  | 'priceUsd'
  | 'batteryPct'
  | 'imei'
  | 'costUsd'
  | 'description'
  | 'photo'
  | 'form';

export interface NewUnitValues {
  readonly title: string;
  readonly catalogModelId: string;
  readonly condition: string;
  readonly storageGb: string;
  readonly color: string;
  readonly priceUsd: string;
  readonly batteryPct: string;
  readonly imei: string;
  readonly costUsd: string;
  readonly description: string;
}

export interface NewUnitFormState {
  readonly errors: Partial<Record<NewUnitField, string>>;
  readonly values: NewUnitValues;
  /** `true` cuando el fallo llegó después de elegir la foto: hay que volver a elegirla. */
  readonly photoLost: boolean;
}

export const emptyNewUnitValues: NewUnitValues = {
  title: '',
  catalogModelId: '',
  condition: '',
  storageGb: '',
  color: '',
  priceUsd: '',
  batteryPct: '',
  imei: '',
  costUsd: '',
  description: '',
};

export const initialNewUnitState: NewUnitFormState = {
  errors: {},
  values: emptyNewUnitValues,
  photoLost: false,
};
