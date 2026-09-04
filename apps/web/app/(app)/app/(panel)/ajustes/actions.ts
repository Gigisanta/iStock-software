'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '../../../_lib/session';
import { parseTenantSettingsForm } from '../../../_lib/tenants/settings-schema';
import { updateTenantSettings } from '../../../_lib/tenants/update-settings';
import type { SettingsField, SettingsFormState } from './form-state';

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function valuesFrom(formData: FormData) {
  return {
    name: readString(formData, 'name'),
    waPhone: readString(formData, 'waPhone'),
    paymentMethods: readString(formData, 'paymentMethods'),
    acceptsTradeIn: formData.get('acceptsTradeIn') !== null,
    reservationMinutes: readString(formData, 'reservationMinutes'),
    pickupName: readString(formData, 'pickupName'),
    pickupAddress: readString(formData, 'pickupAddress'),
    pickupHours: readString(formData, 'pickupHours'),
  } as const;
}

export async function updateTenantSettingsAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const { ctx, tenant } = await requireOwner();
  const values = valuesFrom(formData);
  const parsed = parseTenantSettingsForm(values);

  if (!parsed.success) {
    const errors: Partial<Record<SettingsField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (
        field === 'name' ||
        field === 'waPhone' ||
        field === 'paymentMethods' ||
        field === 'reservationMinutes' ||
        field === 'pickupName' ||
        field === 'pickupAddress' ||
        field === 'pickupHours'
      ) {
        errors[field] ??= issue.message;
      } else {
        errors.form ??= issue.message;
      }
    }
    return { status: 'error', errors, values };
  }

  try {
    await updateTenantSettings(ctx, tenant.slug, parsed.data);
  } catch {
    return {
      status: 'error',
      errors: { form: 'No pudimos guardar los cambios. Probá de nuevo en unos segundos.' },
      values,
    };
  }

  revalidatePath('/app/ajustes');
  return { status: 'saved', errors: {}, values };
}
