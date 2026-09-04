import { describe, expect, it } from 'vitest';
import { parseTenantSettingsForm } from './settings-schema';

const valid = {
  name: '  Norte   Cel  ',
  waPhone: '0299 555 1234',
  paymentMethods: 'Efectivo USD\nTransferencia ARS\nEfectivo USD',
  acceptsTradeIn: true,
  reservationMinutes: '90',
  pickupName: 'Local Centro',
  pickupAddress: 'Av. Argentina 123',
  pickupHours: 'Lun a vie de 10 a 18',
} as const;

describe('formulario de ajustes del negocio', () => {
  it('normaliza los datos que terminan en la vidriera', () => {
    const parsed = parseTenantSettingsForm(valid);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.name).toBe('Norte Cel');
    expect(parsed.data.waPhone).toBe('5492995551234');
    expect(parsed.data.paymentMethods).toEqual(['Efectivo USD', 'Transferencia ARS']);
    expect(parsed.data.reservationMinutes).toBe(90);
  });

  it('rechaza un WhatsApp con 15 y un punto de retiro incompleto', () => {
    const parsed = parseTenantSettingsForm({
      ...valid,
      waPhone: '0299 15 555 1234',
      pickupAddress: '',
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    expect(parsed.error.issues.map((issue) => issue.path[0])).toContain('waPhone');
    expect(parsed.error.issues.map((issue) => issue.path[0])).toContain('pickupAddress');
  });

  it('permite borrar los medios de pago y no acepta más de ocho', () => {
    const empty = parseTenantSettingsForm({ ...valid, paymentMethods: '' });
    expect(empty.success).toBe(true);
    if (!empty.success) return;
    expect(empty.data.paymentMethods).toEqual([]);

    const tooMany = parseTenantSettingsForm({
      ...valid,
      paymentMethods: Array.from({ length: 9 }, (_, index) => `Medio ${String(index + 1)}`).join('\n'),
    });
    expect(tooMany.success).toBe(false);
  });

  it('sólo acepta los presets que aparecen en el selector de reservas', () => {
    expect(parseTenantSettingsForm({ ...valid, reservationMinutes: '45' }).success).toBe(false);
    expect(parseTenantSettingsForm({ ...valid, reservationMinutes: '120' }).success).toBe(true);
  });
});
