'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';
import { addUnitPhoto } from '../../../../../_lib/listings/add-photo';
import { checkPhotoFile, photoFromFormData } from '../../../../../_lib/listings/schema';
import { requireTenant } from '../../../../../_lib/session';
import type { PhotoActionState } from './photo-action-state';

/**
 * Agregar **una** foto a una unidad. Una request, una foto.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Autorización adentro de la acción (ADR-007). No es delegable al proxy ni al layout.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `requireTenant()` es lo primero que pasa acá. Las Server Functions **no** son rutas propias en
 * la cadena de matchers de `proxy.ts`: un `matcher` que excluye un path también saltea las Server
 * Functions de ese path. Un guard en el proxy protege la pantalla y deja la mutación abierta a
 * cualquier `POST` crudo.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El `listingId` viene del cliente, o sea de cualquiera
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sale de un `<input type="hidden">`, así que se valida con Zod (`CLAUDE.md` §5) antes de tocar
 * una query: sin `z.uuid()`, un string cualquiera llega a un `where id = $1` y Postgres contesta
 * con un error de sintaxis de UUID que después alguien loguea entero.
 *
 * Y el filtro de tenant **no** viene del form: `addUnitPhoto` relee la unidad con
 * `eq(listings.tenantId, ctx.tenantId)` explícito *además* de RLS. Una unidad de otro negocio
 * vuelve `null` y sale de acá como "no encontramos ese equipo" — el mismo texto que un id
 * inventado. Un mensaje distinto le confirmaría a alguien de otro tenant que ese id existe.
 *
 * `tenantSlug` sale de la **sesión**, nunca del request: es lo que se usa para invalidar el cache
 * de la vidriera, y un slug ajeno purgaría la vidriera de otro.
 *
 * ── El archivo se chequea por forma antes de leerlo ──────────────────────────────────────────
 * `checkPhotoFile` mira tipo y tamaño sin materializar un byte. El cap es 3 MB y la razón está en
 * `_lib/listings/schema.ts`: es el primer eslabón de una cadena que termina en el techo de 4 MB
 * del Routing Middleware de Vercel.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `refresh()`: sin esto la acción contesta 200 y la pantalla se queda vieja
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `/app/stock/{id}/fotos` **lee vivo de Postgres**. No tiene `'use cache'`, no tiene tag propia y
 * no hay ninguna entrada de cache que invalidar: lo que falta después de guardar la foto no es
 * purgar algo, es avisarle al **router del cliente** que vuelva a renderizar el segmento.
 *
 * Medido en el gate de S2: el POST salía **200**, la foto quedaba guardada, y la grilla seguía
 * mostrando una sola foto después de 30 s de reintentos, sin ningún `data-testid="error-foto"`.
 * Eso es **peor que un error**. El dueño ve que "no pasó nada", vuelve a apretar y sube la misma
 * foto dos veces; un error, al menos, se lee y se entiende.
 *
 * Es `refresh()` y **NO** `revalidatePath()`, a propósito. `revalidatePath` purga el cache de una
 * ruta, y acá no hay cache de esta ruta que purgar: sería pedir la cosa equivocada por el motivo
 * equivocado, y el que lea esto en seis meses se iría creyendo que la pantalla está cacheada.
 * `refresh()` sólo se puede llamar desde una Server Action, que es exactamente donde estamos.
 *
 * Va **sólo en el camino exitoso**. En el de error no hay nada nuevo que mostrar, y refrescar de
 * más es una consulta a Postgres regalada.
 *
 * `invalidateStorefront()` no lo reemplaza y es otra capa: `addUnitPhoto` la llama únicamente
 * `if (isPublicStatus(unit.status))`, o sea **nunca** para una unidad en `draft` — que es el
 * estado en el que se usa esta pantalla. Cache de CDN de la vidriera y router del panel son dos
 * cosas distintas y ninguna hace el trabajo de la otra.
 *
 * Este bug sobrevivió dos gates porque el helper del e2e tenía una **lectura congelada** que lo
 * tapaba: contaba las fotos sobre un snapshot tomado antes del submit, así que veía la foto nueva
 * donde el navegador seguía mostrando la vieja.
 */

const schema = z.object({ listingId: z.uuid('Ese equipo no existe.') });

export async function addPhotoAction(
  _prev: PhotoActionState,
  formData: FormData,
): Promise<PhotoActionState> {
  const session = await requireTenant();

  const parsed = schema.safeParse({ listingId: formData.get('listingId') });
  if (!parsed.success) {
    return { error: 'No pudimos identificar el equipo. Recargá la pantalla.' };
  }

  const photoCheck = checkPhotoFile(photoFromFormData(formData, 'photo'));
  if (!photoCheck.ok) return { error: photoCheck.reason };

  const bytes = new Uint8Array(await photoCheck.file.arrayBuffer());

  const result = await addUnitPhoto(
    session.ctx,
    session.tenant.slug,
    parsed.data.listingId,
    bytes,
  );

  if (!result.ok) return { error: result.message };

  // La pantalla se queda donde está y lee vivo: sin esto muestra la cantidad de fotos anterior.
  // Sólo acá, en el camino exitoso. Ver el encabezado.
  refresh();

  return { error: null };
}
