export const SUBSCRIPTION_PLANS = [
  { tier: 'base', label: 'Suscribite al plan Base', href: '/billing/suscribirse?plan=base' },
  { tier: 'negocio', label: 'Suscribite al plan Negocio', href: '/billing/suscribirse?plan=negocio' },
] as const;

export type TrialSubscriptionCta = {
  readonly status: 'active' | 'expired';
  readonly title: string;
  readonly message: string;
  readonly reassurance: string | null;
  readonly plans: typeof SUBSCRIPTION_PLANS;
};

/**
 * Copy y destinos de la conversión del trial. Sólo usa los días ya calculados desde la sesión:
 * si no hay fecha de fin, devuelve `null` para no inventar vigencia ni estado de pago.
 */
export function trialSubscriptionCta(daysLeft: number | null): TrialSubscriptionCta | null {
  if (daysLeft === null) return null;

  if (daysLeft > 0) {
    return {
      status: 'active',
      title: 'Elegí cómo seguir con iStock',
      message: `Te quedan ${daysLeft} días de prueba. Elegí un plan para seguir usando iStock cuando termine.`,
      reassurance: 'No te vamos a cobrar sin avisarte.',
      plans: SUBSCRIPTION_PLANS,
    };
  }

  return {
    status: 'expired',
    title: 'Tu prueba terminó',
    message: 'Elegí un plan y suscribite para seguir usando iStock.',
    reassurance: null,
    plans: SUBSCRIPTION_PLANS,
  };
}
