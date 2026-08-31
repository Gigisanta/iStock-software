import { describe, expect, it } from 'vitest';
import {
  selectedPlanFromFormValue,
  selectedPlanFromSearchParams,
  SUBSCRIPTION_REDIRECTS,
} from './selected-plan';

describe('selectedPlanFromSearchParams', () => {
  it.each(['base', 'negocio'] as const)('acepta sólo el plan pago "%s"', (plan) => {
    expect(selectedPlanFromSearchParams({ plan })).toBe(plan);
  });

  it('rechaza trial, destinos inventados y valores repetidos', () => {
    expect(selectedPlanFromSearchParams({ plan: 'trial' })).toBeNull();
    expect(selectedPlanFromSearchParams({ plan: 'https://sitio-malicioso.test' })).toBeNull();
    expect(selectedPlanFromSearchParams({ plan: ['base', 'negocio'] })).toBeNull();
    expect(selectedPlanFromSearchParams({})).toBeNull();
  });
});

describe('selectedPlanFromFormValue', () => {
  it('acepta el campo ausente/vacío como ausencia de elección', () => {
    expect(selectedPlanFromFormValue(null)).toBeNull();
    expect(selectedPlanFromFormValue('')).toBeNull();
  });

  it('rechaza cualquier valor que no sea base o negocio', () => {
    expect(selectedPlanFromFormValue('premium')).toBeNull();
    expect(selectedPlanFromFormValue('/app?redirect=/billing')).toBeNull();
  });
});

it('los redirects son destinos fijos por plan, nunca una URL del request', () => {
  expect(SUBSCRIPTION_REDIRECTS).toEqual({
    base: '/billing/suscribirse?plan=base',
    negocio: '/billing/suscribirse?plan=negocio',
  });
});
