import { describe, expect, it } from 'vitest';

import { DomainError, isDomainError } from './errors';
import {
  CONDITIONS,
  LISTING_KINDS,
  LISTING_STATUSES,
  MAIN_STATUSES,
  PUBLIC_STATUSES,
  SIDE_STATUSES,
  conditionLabel,
  isCondition,
  isListingStatus,
  isPublicStatus,
  isSideStatus,
  waConditionLabel,
} from './types';

describe('vocabulario del dominio', () => {
  it('las condiciones son las cinco de CLAUDE.md §1, sin agregados', () => {
    expect([...CONDITIONS]).toEqual([
      'sealed',
      'open_box',
      'tester_a_plus',
      'used_excellent',
      'used_with_detail',
    ]);
    expect(isCondition('used_excellent')).toBe(true);
    expect(isCondition('refurbished')).toBe(false);
  });

  it('los estados son los cuatro principales más los cuatro laterales', () => {
    expect([...MAIN_STATUSES]).toEqual(['draft', 'available', 'reserved', 'sold']);
    expect([...SIDE_STATUSES]).toEqual(['in_transit', 'in_tradein', 'in_service', 'unavailable']);
    expect(LISTING_STATUSES).toHaveLength(8);
    expect(new Set(LISTING_STATUSES).size).toBe(8);
    expect(isListingStatus('sold')).toBe(true);
    expect(isListingStatus('archived')).toBe(false);
    expect(isSideStatus('in_service')).toBe(true);
    expect(isSideStatus('available')).toBe(false);
  });

  it('la vidriera sólo conoce available, reserved y sold', () => {
    expect([...PUBLIC_STATUSES]).toEqual(['available', 'reserved', 'sold']);
    expect(isPublicStatus('draft')).toBe(false);
    for (const side of SIDE_STATUSES) expect(isPublicStatus(side)).toBe(false);
  });

  it('unidad y lote existen desde el día 1', () => {
    expect([...LISTING_KINDS]).toEqual(['unit', 'lot']);
  });

  it('la etiqueta de UI y la del mensaje de WhatsApp son distintas a propósito', () => {
    expect(conditionLabel('used_excellent')).toBe('usado excelente');
    expect(waConditionLabel('used_excellent')).toBe('usado A');
    for (const condition of CONDITIONS) {
      expect(conditionLabel(condition).length).toBeGreaterThan(0);
      expect(waConditionLabel(condition).length).toBeGreaterThan(0);
    }
  });
});

describe('DomainError', () => {
  it('lleva un código estable para que el borde decida el mensaje', () => {
    const err = new DomainError('FX_RATE_INVALID', 'TC inválido');
    expect(err.code).toBe('FX_RATE_INVALID');
    expect(err.name).toBe('DomainError');
    expect(err).toBeInstanceOf(Error);
    expect(isDomainError(err)).toBe(true);
    expect(isDomainError(new Error('otra cosa'))).toBe(false);
    expect(isDomainError(null)).toBe(false);
  });
});
