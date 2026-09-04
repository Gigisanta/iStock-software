/**
 * El catálogo comercial: qué se vende, a cuánto, y qué incluye.
 *
 * Módulo **puro** — no importa `server-only`, no toca Postgres, no lee `process.env`. Es la
 * traducción ejecutable de `PRODUCT.md` §Planes y de `CLAUDE.md` §1, y existe para que "¿qué
 * incluye Negocio?" tenga **una** respuesta y no tres.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Este archivo NO resuelve entitlements. Sólo dice qué vende cada plan.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Quién puede hacer qué **hoy** lo decide `featureAccess()` en `app/(app)/_lib/entitlements.ts`
 * (ADR-018), que además mira la fila explícita de `entitlements` y la vigencia del trial. Acá no
 * hay `if` de autorización y no puede haberlo: un catálogo que además autoriza es el segundo lugar
 * donde alguien se olvida de mirar `trial_ends_at`.
 *
 * **La colisión cerró el 2026-08-28.** `app/(app)/_lib/entitlements.ts` traía su propio mapa
 * `PLAN_FEATURES` con una sola feature y era un **subconjunto** de esto; hoy importa
 * `planFeatures()` de acá y no declara ningún plan. Este archivo es el catálogo de `apps/web`: ya
 * no hay una segunda respuesta a "¿qué incluye Negocio?".
 *
 * Que siga habiendo una sola **está medido desde los dos lados, y la duplicación es deliberada**:
 * `plans.test.ts` (acá) y `(app)/_lib/entitlements.test.ts` (allá) corren la misma matriz de los
 * tres planes por todas las `BILLABLE_FEATURES` contra `featureAccess()`. No es cobertura repetida,
 * es independencia — ninguno de los dos writers puede sacar el chequeo del otro sin que el suyo lo
 * delate.
 */

export const PLAN_TIERS = ['trial', 'base', 'negocio'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export function isPlanTier(value: string): value is PlanTier {
  return (PLAN_TIERS as readonly string[]).includes(value);
}

/**
 * Los nombres de feature son **valores de `entitlements.feature`** (una columna `text`), no un
 * enum de TypeScript. Se declaran como constantes para que un typo sea un error de compilación en
 * el call site y no una feature que nunca se prende.
 *
 * `FEATURE_RESERVATIONS` repite el literal `'reservations'` que ya exporta
 * `app/(app)/_lib/entitlements.ts`. Que sean el mismo string **está testeado**, no asumido.
 */
export const FEATURE_CHATBOT = 'chatbot';
export const FEATURE_RESERVATIONS = 'reservations';
export const FEATURE_MARGIN = 'margin';
export const FEATURE_PICKUP_POINTS = 'pickup_points';

/** Todas las features que el producto sabe cobrar. Orden estable: se muestra en `/precios`. */
export const BILLABLE_FEATURES = [
  FEATURE_CHATBOT,
  FEATURE_RESERVATIONS,
  FEATURE_MARGIN,
  FEATURE_PICKUP_POINTS,
] as const;

export interface PlanSpec {
  readonly tier: PlanTier;
  /** Como se escribe en pantalla, en rioplatense. */
  readonly label: string;
  /**
   * Precio de lista en **centavos de USD**. Enteros a propósito: `19.00` en punto flotante es la
   * clase de número que termina facturando `18,999999`.
   *
   * **No es lo que se le cobra a MP.** El checkout hospedado crea una suscripción pendiente sin
   * plan asociado; el importe ARS se calcula en el servidor con el TC persistido del tenant y se
   * congela para esa adhesión. Este número es el precio **de referencia** que se muestra y con el
   * que se razona el margen.
   */
  readonly monthlyUsdCents: number;
  readonly features: readonly string[];
  /** Techo numérico por feature. Hoy sólo `pickup_points`. Ausente = sin techo. */
  readonly limits: Readonly<Record<string, number>>;
}

/**
 * `trial` incluye **todo lo de `negocio`**, y eso es producto, no una comodidad: `PRODUCT.md`
 * vende los 14 días como la prueba del producto completo y un trial que no deja probar lo que se
 * paga no vende nada (ADR-018 §1). Lo que el trial **no** hace es sobrevivirse: vencido no da
 * ninguna feature, y eso lo aplica `featureAccess()`, no este mapa.
 *
 * `base` no incluye chatbot. Es la línea del §1 de `CLAUDE.md` y la razón por la que el plan
 * existe: el chatbot es lo único del producto con costo marginal por visitante.
 */
export const PLAN_CATALOG: Readonly<Record<PlanTier, PlanSpec>> = {
  trial: {
    tier: 'trial',
    label: 'Prueba',
    monthlyUsdCents: 0,
    features: [FEATURE_CHATBOT, FEATURE_RESERVATIONS, FEATURE_MARGIN, FEATURE_PICKUP_POINTS],
    limits: { [FEATURE_PICKUP_POINTS]: 3 },
  },
  base: {
    tier: 'base',
    label: 'Base',
    monthlyUsdCents: 1900,
    features: [],
    limits: { [FEATURE_PICKUP_POINTS]: 1 },
  },
  negocio: {
    tier: 'negocio',
    label: 'Negocio',
    monthlyUsdCents: 3500,
    features: [FEATURE_CHATBOT, FEATURE_RESERVATIONS, FEATURE_MARGIN, FEATURE_PICKUP_POINTS],
    limits: { [FEATURE_PICKUP_POINTS]: 3 },
  },
};

/** Qué features trae el plan **de lista**. No mira ni la fila de `entitlements` ni el trial. */
export function planFeatures(tier: PlanTier): readonly string[] {
  return PLAN_CATALOG[tier].features;
}

/** ¿El plan de lista incluye esta feature? Ver el encabezado: esto **no** es la autorización. */
export function planIncludes(tier: PlanTier, feature: string): boolean {
  return PLAN_CATALOG[tier].features.includes(feature);
}

/** Techo del plan para la feature, o `null` si no tiene techo declarado. */
export function planLimit(tier: PlanTier, feature: string): number | null {
  return PLAN_CATALOG[tier].limits[feature] ?? null;
}

/**
 * `1900` → `"USD 19"`. Sin decimales cuando son cero: el precio se lee en un teléfono y
 * `USD 19,00` no agrega nada. Con decimales, coma — se lee en Cipolletti.
 */
export function formatMonthlyUsd(tier: PlanTier): string {
  const cents = PLAN_CATALOG[tier].monthlyUsdCents;
  const whole = Math.trunc(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `USD ${whole}` : `USD ${whole},${String(rest).padStart(2, '0')}`;
}

/**
 * Los planes que se pueden **contratar**. `trial` no está: no se compra, se recibe en el alta y
 * se vence. Un `preapproval` de MP para el trial sería cobrarle cero a alguien todos los meses.
 */
export const PAID_PLAN_TIERS = ['base', 'negocio'] as const satisfies readonly PlanTier[];
export type PaidPlanTier = (typeof PAID_PLAN_TIERS)[number];

export function isPaidPlanTier(value: string): value is PaidPlanTier {
  return (PAID_PLAN_TIERS as readonly string[]).includes(value);
}
