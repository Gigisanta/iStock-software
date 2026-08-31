import { z } from 'zod';

export const SELECTED_PLANS = ['base', 'negocio'] as const;
export type SelectedPlan = (typeof SELECTED_PLANS)[number];

const selectedPlanSchema = z.enum(SELECTED_PLANS, { error: 'Elegí un plan válido.' });
export const selectedPlanFieldSchema = z.preprocess(
  (value) => (value === null || value === '' ? undefined : value),
  selectedPlanSchema.optional(),
);
const selectedPlanSearchParamsSchema = z.object({ plan: selectedPlanFieldSchema });

/** Destinos cerrados: ningún valor del request se usa como URL de redirección. */
export const SUBSCRIPTION_REDIRECTS: Readonly<Record<SelectedPlan, string>> = {
  base: '/billing/suscribirse?plan=base',
  negocio: '/billing/suscribirse?plan=negocio',
};

/** Valida el query de `/ingresar`; valores desconocidos no pueden elegir un destino. */
export function selectedPlanFromSearchParams(value: unknown): SelectedPlan | null {
  const parsed = selectedPlanSearchParamsSchema.safeParse(value);
  return parsed.success ? parsed.data.plan ?? null : null;
}

/** Valida el campo oculto del formulario y falla cerrado si alguien lo modifica. */
export function selectedPlanFromFormValue(value: unknown): SelectedPlan | null {
  const parsed = selectedPlanFieldSchema.safeParse(value);
  return parsed.success ? parsed.data ?? null : null;
}
