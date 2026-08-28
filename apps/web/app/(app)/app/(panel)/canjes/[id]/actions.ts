'use server';

import { redirect } from 'next/navigation';
import { requireTenant } from '../../../../_lib/session';
import { acceptToStock } from '../../../../_lib/tradein/accept-to-stock';
import { parseAcceptTradeinForm } from '../../../../_lib/tradein/schema';
import type { AcceptFormState, AcceptFormValues } from './accept-form-state';

/**
 * Aceptar un canje: crear la unidad en `draft` con su costo y dejar el lead atado a ella.
 *
 * ── Autorización adentro de la acción (ADR-007) ──────────────────────────────────────────────
 * `requireTenant()` es lo primero. Las Server Functions no son rutas propias en la cadena de
 * matchers de `proxy.ts`: un `matcher` que excluye un path también saltea sus Server Functions.
 *
 * ── El rol se chequea DOS veces, y no es paranoia ────────────────────────────────────────────
 * Acá y adentro de `acceptToStock()`. Acá porque este es el borde por el que llega el `POST`, y
 * allá porque la función es exportada y un caller nuevo no tiene por qué acordarse. Lo que **no**
 * cuenta como chequeo es que la página no dibuje el formulario: un `POST` lo arma cualquiera con
 * el id del lead y `curl`.
 *
 * ── El tenant NO viaja en el form ────────────────────────────────────────────────────────────
 * Sale de la sesión. Del `FormData` llega el id del lead y lo que la persona escribió del equipo.
 *
 * ── Sin `revalidateTag`, y está medido ───────────────────────────────────────────────────────
 * La unidad nace en `draft`. La policy de la vidriera exige estado público **y**
 * `published_at is not null`, así que un anónimo no ve nada distinto y no hay cache que purgar.
 * La invalidación vive en `publish-listing.ts`, que es donde el equipo entra a la vidriera.
 * `CLAUDE.md` §0.7 pide el tag cuando cambia **stock visible**; esto no lo cambia.
 *
 * ── A dónde va el dueño después ──────────────────────────────────────────────────────────────
 * A `/app/stock/{id}/fotos`. El equipo entró al stock pero no tiene una sola foto, y con menos de
 * tres no se publica (`MIN_PHOTOS_TO_PUBLISH`). Dejarlo en el detalle del canje sería terminar el
 * flujo en el punto exacto en que falta lo único que importa. El destino se arma con el id que
 * devolvió la transacción, no con nada del `FormData`: un `redirectTo` de texto libre en un form
 * es un open redirect, y en una Server Action es uno que el navegador sigue sin preguntar.
 */

const NOT_OWNER = 'Sólo el dueño puede aceptar un canje: define el costo del equipo.';

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/** Lo que la persona escribió, para devolvérselo si algo falla. Ver `accept-form-state.ts`. */
function echo(formData: FormData): AcceptFormValues {
  return {
    title: readString(formData, 'title'),
    catalogModelId: readString(formData, 'catalogModelId'),
    condition: readString(formData, 'condition'),
    storageGb: readString(formData, 'storageGb'),
    color: readString(formData, 'color'),
    batteryPct: readString(formData, 'batteryPct'),
    priceUsd: readString(formData, 'priceUsd'),
    offerUsd: readString(formData, 'offerUsd'),
  };
}

export async function acceptTradeinAction(
  _prev: AcceptFormState,
  formData: FormData,
): Promise<AcceptFormState> {
  const { role, ctx } = await requireTenant();
  const values = echo(formData);

  if (role !== 'owner') {
    return { errors: { form: NOT_OWNER }, values };
  }

  const parsed = parseAcceptTradeinForm(formData);
  if (!parsed.ok) {
    return { errors: parsed.errors, values };
  }

  const result = await acceptToStock(ctx, parsed.data);
  if (!result.ok) {
    return { errors: { [result.field]: result.message }, values };
  }

  // `redirect()` tira: va fuera de todo `try` y después del camino de fallo.
  redirect(`/app/stock/${result.listingId}/fotos`);
}
