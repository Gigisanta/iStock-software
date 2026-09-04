import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUBSCRIPTION_PLANS, trialSubscriptionCta } from './subscription-cta';

const PANEL_HOME = readFileSync(new URL('../app/(panel)/page.tsx', import.meta.url), 'utf8');
const BILLING_PAGE_PATH = new URL('../../(billing)/billing/page.tsx', import.meta.url);

describe('trialSubscriptionCta', () => {
  it('no inventa un estado cuando el trial no tiene fecha de fin', () => {
    expect(trialSubscriptionCta(null)).toBeNull();
  });

  it('ofrece los dos planes mientras el trial sigue vigente', () => {
    expect(trialSubscriptionCta(5)).toEqual({
      status: 'active',
      title: 'Elegí cómo seguir con iStock',
      message: 'Te quedan 5 días de prueba. Elegí un plan para seguir usando iStock cuando termine.',
      reassurance: 'No te vamos a cobrar sin avisarte.',
      plans: SUBSCRIPTION_PLANS,
    });
  });

  it('ofrece los dos planes cuando el trial caducó, incluido el borde en cero', () => {
    expect(trialSubscriptionCta(0)).toEqual({
      status: 'expired',
      title: 'Tu prueba terminó',
      message: 'Elegí un plan y suscribite para seguir usando iStock.',
      reassurance: null,
      plans: SUBSCRIPTION_PLANS,
    });
    expect(trialSubscriptionCta(-2)?.status).toBe('expired');
  });

  it('mantiene los destinos de suscripción exactos y sólo ofrece planes pagos', () => {
    expect(SUBSCRIPTION_PLANS).toEqual([
      {
        tier: 'base',
        label: 'Suscribite al plan Base',
        href: '/billing/suscribirse?plan=base',
      },
      {
        tier: 'negocio',
        label: 'Suscribite al plan Pro',
        href: '/billing/suscribirse?plan=negocio',
      },
    ]);
    expect(SUBSCRIPTION_PLANS.map((plan) => plan.tier)).not.toContain('trial');
  });

  it('la home sólo lo muestra para trial con fecha y no conserva el copy bloqueante', () => {
    expect(PANEL_HOME).toContain("tenant.plan === 'trial' && subscriptionCta !== null");
    expect(PANEL_HOME).toContain('trialSubscriptionCta(daysLeft)');
    expect(PANEL_HOME).toContain('<SubscriptionPrompt cta={subscriptionCta} />');
    expect(PANEL_HOME).not.toContain('todavía no hay forma de pagar');
  });

  it('apunta a la página real de billing y no a una ruta que dé 404', () => {
    expect(existsSync(BILLING_PAGE_PATH)).toBe(true);
    const billingPage = readFileSync(BILLING_PAGE_PATH, 'utf8');
    expect(billingPage).toContain('action="/billing/subscribe"');
    expect(SUBSCRIPTION_PLANS.map((plan) => plan.href)).toEqual([
      '/billing/suscribirse?plan=base',
      '/billing/suscribirse?plan=negocio',
    ]);
  });
});
