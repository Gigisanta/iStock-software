import { describe, expect, it } from 'vitest';
import { mapAuthorizedPaymentStatus, mapPreapprovalStatus, planAfterEffect } from './status';

/**
 * La tabla de traducción. Lo que se mide es lo que MP **realmente** escribe, incluidas sus dos
 * ortografías de "cancelado", que no son una anécdota: `payment.status` usa `cancelled` (dos "l")
 * y `preapproval.status` usa `canceled` (una). Cubrir sólo una deja una suscripción cancelada
 * cobrando features, sin error y sin log.
 */

describe('preapproval', () => {
  it('authorized da el plan', () => {
    expect(mapPreapprovalStatus('authorized')).toEqual({ status: 'authorized', planEffect: 'grant' });
  });

  it('las DOS ortografías de cancelado lo sacan', () => {
    expect(mapPreapprovalStatus('cancelled')).toEqual({ status: 'cancelled', planEffect: 'revoke' });
    expect(mapPreapprovalStatus('canceled')).toEqual({ status: 'cancelled', planEffect: 'revoke' });
  });

  it('paused se registra y NO toca el plan', () => {
    expect(mapPreapprovalStatus('paused')).toEqual({ status: 'paused', planEffect: 'keep' });
  });

  /**
   * `pending` es la mitad de un alta: la suscripción existe y el pagador no autorizó. Guardarlo
   * como `trialing` mezclaría "está probando el producto" con "abrió el checkout y se fue", y una
   * de las dos se cobra.
   */
  it('pending no es un estado nuestro', () => {
    expect(mapPreapprovalStatus('pending')).toBeNull();
  });

  it('un estado que MP invente mañana: null, y el handler responde 200', () => {
    expect(mapPreapprovalStatus('waiting for gateway')).toBeNull();
  });

  it('mayúsculas y espacios no cambian el resultado', () => {
    expect(mapPreapprovalStatus('  AUTHORIZED ')).toEqual({ status: 'authorized', planEffect: 'grant' });
  });
});

describe('authorized_payment', () => {
  it('processed cobra y da el plan', () => {
    expect(mapAuthorizedPaymentStatus('processed')).toEqual({ status: 'authorized', planEffect: 'grant' });
  });

  it('recycling queda como pago fallido pero NO baja el plan', () => {
    expect(mapAuthorizedPaymentStatus('recycling')).toEqual({ status: 'payment_failed', planEffect: 'keep' });
  });

  it('scheduled todavía no pasó nada', () => {
    expect(mapAuthorizedPaymentStatus('scheduled')).toBeNull();
  });

  it('una cuota cancelada no cancela la suscripción por sí sola', () => {
    expect(mapAuthorizedPaymentStatus('cancelled')?.planEffect).toBe('keep');
    expect(mapAuthorizedPaymentStatus('canceled')?.planEffect).toBe('keep');
  });
});

describe('planAfterEffect', () => {
  it('grant deja el plan comprado', () => {
    expect(planAfterEffect('grant', 'negocio')).toBe('negocio');
    expect(planAfterEffect('grant', 'base')).toBe('base');
  });

  /**
   * `trial` es el ÚNICO downgrade que admite el enum `plan_tier`: no hay `none`. Con un
   * `trial_ends_at` en el pasado —el caso de cualquiera que llegó a pagar— eso es exactamente
   * "sin features pagas" según ADR-018, sin código nuevo.
   */
  it('revoke baja a trial, que es el único downgrade que existe', () => {
    expect(planAfterEffect('revoke', 'negocio')).toBe('trial');
  });

  it('keep devuelve null: NO se emite el update, que no es lo mismo que escribir el mismo valor', () => {
    expect(planAfterEffect('keep', 'negocio')).toBeNull();
  });
});
