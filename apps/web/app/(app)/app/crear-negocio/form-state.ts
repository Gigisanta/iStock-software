/**
 * Estado del formulario de alta. Separado de `actions.ts` porque un archivo `'use server'` sólo
 * puede exportar funciones async.
 */

export type CreateTenantField = 'name' | 'slug' | 'waPhone' | 'form';
import type { SelectedPlan } from '../../_lib/auth/selected-plan';

export interface CreateTenantFormState {
  readonly errors: Partial<Record<CreateTenantField, string>>;
  /** Plan que la persona eligió antes de registrarse, si corresponde. */
  readonly selectedPlan: SelectedPlan | null;
  /** Lo que la persona ya escribió. Un form que se vacía al fallar hace que la gente abandone. */
  readonly values: {
    readonly name: string;
    readonly slug: string;
    readonly waPhone: string;
    readonly acceptsTradeIn: boolean;
  };
}

export const initialCreateTenantState: CreateTenantFormState = {
  errors: {},
  selectedPlan: null,
  values: { name: '', slug: '', waPhone: '', acceptsTradeIn: false },
};

export function initialCreateTenantStateForPlan(selectedPlan: SelectedPlan | null): CreateTenantFormState {
  return { ...initialCreateTenantState, selectedPlan };
}
