/**
 * Estado del formulario de alta. Separado de `actions.ts` porque un archivo `'use server'` sólo
 * puede exportar funciones async.
 */

export type CreateTenantField = 'name' | 'slug' | 'waPhone' | 'form';

export interface CreateTenantFormState {
  readonly errors: Partial<Record<CreateTenantField, string>>;
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
  values: { name: '', slug: '', waPhone: '', acceptsTradeIn: false },
};
