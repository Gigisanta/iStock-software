import type { TenantSettingsFormValues } from '../../../_lib/tenants/settings-schema';

export type SettingsField =
  | 'name'
  | 'waPhone'
  | 'paymentMethods'
  | 'reservationMinutes'
  | 'pickupName'
  | 'pickupAddress'
  | 'pickupHours'
  | 'form';

export type SettingsFormState = {
  readonly status: 'idle' | 'saved' | 'error';
  readonly errors: Partial<Record<SettingsField, string>>;
  readonly values: TenantSettingsFormValues;
};

export const initialSettingsFormState = (values: TenantSettingsFormValues): SettingsFormState => ({
  status: 'idle',
  errors: {},
  values,
});
