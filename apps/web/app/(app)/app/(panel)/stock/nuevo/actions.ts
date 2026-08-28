'use server';

import { redirect } from 'next/navigation';
import { createUnit } from '../../../../_lib/listings/create-listing';
import { checkPhotoFile, newUnitSchema, photoFromFormData } from '../../../../_lib/listings/schema';
import { requireTenant } from '../../../../_lib/session';
import type { NewUnitField, NewUnitFormState, NewUnitValues } from './form-state';

/**
 * Alta de una unidad, con **una** foto, desde el teléfono.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Orden de las verificaciones. No es casual, es ADR-007.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. **`requireTenant()` primero, adentro de la acción.** Las Server Functions no son rutas
 *    propias en la cadena de matchers de `proxy.ts`: un `matcher` que excluye un path también
 *    saltea las Server Functions de ese path. Un guard en el proxy o en el layout protege la
 *    pantalla y deja la mutación abierta a cualquier `POST` crudo.
 * 2. **Zod después.** Nada del `FormData` se toca antes del schema.
 * 3. **La foto se chequea por forma antes de leerla.** `checkPhotoFile` mira tipo y tamaño sin
 *    materializar un byte: no queremos 3 MB en RAM para descubrir que había un PDF.
 * 4. **Recién ahí `arrayBuffer()`**, y el pipeline de `@istock/media`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  UNA foto por request. El techo lo pone Vercel, no nosotros.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * El POST del alta no termina en una extensión conocida, así que cae en el catch-all del
 * `matcher` de `proxy.ts` y lo procesa el Routing Middleware, cuyo body está capado en **4 MB** y
 * no varía por plan. El diseño anterior mandaba hasta ocho fotos en un submit: reventaba con dos
 * fotos de celular. La cadena completa de techos está documentada en `_lib/listings/schema.ts`
 * (`MAX_PHOTO_BYTES`) y en `next.config.ts`.
 *
 * Por eso el éxito **redirige a `/app/stock/{id}/fotos`**: ahí se completan las 3 fotos que
 * `MIN_PHOTOS_TO_PUBLISH` exige, una request por foto. Un borrador con una sola foto no es un
 * estado a medias: es el único estado que la plataforma permite alcanzar en un submit.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `catalogModelId` es obligatorio
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `checkPublishable()` de `@istock/domain` deniega `missing_catalog_model` para todo
 * `kind: 'unit'`. Una unidad sin modelo de catálogo no se puede publicar, no se puede filtrar en
 * la vidriera y el chatbot no la puede contestar. Se pide en el alta y se valida acá: el `<select>`
 * de la pantalla no es la defensa, un `POST` armado a mano llega igual.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `cost_usd`: el seller no lo escribe, y el filtro está acá
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Si el rol no es `owner`, el campo se descarta **antes de parsear**. No alcanza con no dibujar el
 * input: un `POST` con `costUsd=1` armado a mano llega igual. `CLAUDE.md` §0.9.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La foto NUNCA sube desde el browser a R2
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * No hay presigned PUT ni credencial en el cliente: el archivo viaja en el `FormData` de esta
 * acción y de acá va a `uploadListingPhoto()`, que resizea antes de tocar el storage.
 *
 * ── Nada de esto se loguea ───────────────────────────────────────────────────────────────────
 * Ni el `FormData`, ni el input parseado, ni el IMEI, ni el nombre del archivo. `_lib/log.ts` no
 * acepta objetos y tiene denylist de nombres de campo: `logEvent('x', { imei })` tira en dev.
 */

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

const FIELD_NAMES: readonly NewUnitField[] = [
  'title',
  'catalogModelId',
  'condition',
  'storageGb',
  'color',
  'priceUsd',
  'batteryPct',
  'imei',
  'costUsd',
  'description',
  'photo',
];

function isField(value: unknown): value is NewUnitField {
  return typeof value === 'string' && (FIELD_NAMES as readonly string[]).includes(value);
}

export async function createUnitAction(
  _prev: NewUnitFormState,
  formData: FormData,
): Promise<NewUnitFormState> {
  const session = await requireTenant();
  const isOwner = session.role === 'owner';

  const values: NewUnitValues = {
    title: readString(formData, 'title'),
    catalogModelId: readString(formData, 'catalogModelId'),
    condition: readString(formData, 'condition'),
    storageGb: readString(formData, 'storageGb'),
    color: readString(formData, 'color'),
    priceUsd: readString(formData, 'priceUsd'),
    batteryPct: readString(formData, 'batteryPct'),
    imei: readString(formData, 'imei'),
    // El costo del seller no se lee siquiera. Ver el encabezado.
    costUsd: isOwner ? readString(formData, 'costUsd') : '',
    description: readString(formData, 'description'),
  };

  const parsed = newUnitSchema.safeParse(values);
  if (!parsed.success) {
    const errors: Partial<Record<NewUnitField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (isField(field)) errors[field] ??= issue.message;
      else errors.form ??= issue.message;
    }
    return { errors, values, photoLost: true };
  }

  const photoCheck = checkPhotoFile(photoFromFormData(formData, 'photo'));
  if (!photoCheck.ok) {
    return { errors: { photo: photoCheck.reason }, values, photoLost: true };
  }

  const bytes = new Uint8Array(await photoCheck.file.arrayBuffer());

  const result = await createUnit(session.ctx, parsed.data, bytes);
  if (!result.ok) {
    return { errors: { [result.field]: result.message }, values, photoLost: true };
  }

  // Fuera de cualquier try/catch: `redirect()` navega tirando una excepción.
  // A completar las fotos: con una sola, `checkPublishable` todavía deniega `missing_photos`.
  redirect(`/app/stock/${result.listingId}/fotos`);
}
