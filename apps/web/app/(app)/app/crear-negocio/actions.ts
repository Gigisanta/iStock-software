'use server';

import { redirect } from 'next/navigation';
import { requireUser } from '../../_lib/session';
import { createTenant, createTenantSchema, isSlugTaken } from '../../_lib/tenants/create-tenant';
import type { CreateTenantField, CreateTenantFormState } from './form-state';

/**
 * Alta del negocio.
 *
 * Orden de las verificaciones, que no es casual:
 *
 * 1. **`requireUser()` primero.** Autorización adentro de la Server Function (ADR-007). Sin esto,
 *    cualquiera con un `POST` crudo al endpoint de la acción crea tenants: las Server Functions
 *    no están cubiertas por el matcher del proxy.
 * 2. **Zod después.** Nada del `FormData` se toca antes de pasar por el schema.
 * 3. **Disponibilidad del slug al final**, y aun así el `insert` puede fallar con `23505`: entre
 *    el chequeo y el insert hay una carrera. La verdad la tiene el `unique index`
 *    `tenants_slug_key`, no este `select`. El chequeo previo existe sólo para dar un mensaje
 *    lindo en el 99% de los casos; `createTenant()` maneja el 1% restante.
 */

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export async function createTenantAction(
  _prev: CreateTenantFormState,
  formData: FormData,
): Promise<CreateTenantFormState> {
  const identity = await requireUser();

  const values = {
    name: readString(formData, 'name'),
    slug: readString(formData, 'slug'),
    waPhone: readString(formData, 'waPhone'),
    acceptsTradeIn: formData.get('acceptsTradeIn') !== null,
  };

  const parsed = createTenantSchema.safeParse({
    name: values.name,
    slug: values.slug,
    waPhone: values.waPhone,
    acceptsTradeIn: values.acceptsTradeIn,
  });
  if (!parsed.success) {
    const errors: Partial<Record<CreateTenantField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'name' || field === 'slug' || field === 'waPhone') {
        errors[field] ??= issue.message;
      } else {
        errors.form ??= issue.message;
      }
    }
    return { errors, values };
  }

  if (await isSlugTaken(parsed.data.slug)) {
    return { errors: { slug: 'Ese link ya lo está usando otro negocio.' }, values };
  }

  const result = await createTenant(identity.userId, parsed.data);
  if (!result.ok) {
    return { errors: { [result.field]: result.message }, values };
  }

  // Fuera del try/catch: `redirect()` navega tirando una excepción.
  redirect('/app');
}
