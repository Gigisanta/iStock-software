'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { transitionUnit } from '../../../_lib/listings/publish-listing';
import { requireTenant } from '../../../_lib/session';
import type { StatusActionState } from './status-action-state';

/**
 * Publicar / despublicar una unidad.
 *
 * ── Autorización adentro de la acción (ADR-007) ──────────────────────────────────────────────
 * `requireTenant()` es lo primero. Las Server Functions no son rutas propias en la cadena de
 * matchers de `proxy.ts`: un `matcher` que excluye un path también saltea sus Server Functions.
 *
 * ── Zod en el borde, también acá ─────────────────────────────────────────────────────────────
 * El `listingId` viene de un `<input type="hidden">`, o sea del cliente, o sea de cualquiera.
 * Sin `z.uuid()` un string cualquiera llega a un `where id = $1` y Postgres responde con un error
 * de sintaxis de UUID que después alguien loguea entero.
 *
 * ── El destino es una allowlist de dos, no un `ListingStatus` cualquiera ─────────────────────
 * Desde esta pantalla sólo se publica y se despublica. `sold`, `reserved` y los laterales tienen
 * su propio flujo (S5/S6) con sus propios efectos: dejar que el enum entero entre por acá sería
 * habilitar "marcar vendido" sin registrar la venta. `checkTransition()` igual lo atajaría, pero
 * la allowlist es más barata y más explícita.
 *
 * ── El tenant NO viaja en el form ────────────────────────────────────────────────────────────
 * `tenant.slug` sale de la sesión. Si viniera del request, un `POST` con el slug de otro negocio
 * purgaría el cache de una vidriera ajena.
 *
 * ── `after`: a dónde va el dueño después de publicar ─────────────────────────────────────────
 * `/app/stock/{id}/fotos` es una pantalla de un solo propósito: dejar la unidad publicable. Una
 * vez publicada, quedarse ahí es un callejón sin salida justo en el momento de más impulso — el
 * "done cobrable" de CLAUDE.md es cargar 15 equipos en una tarde, y el botón de alta vive en
 * `/app/stock`. Desde la lista, en cambio, no hay a dónde ir: se queda.
 *
 * Es un campo del cliente, así que **NO** es una URL: es una allowlist de dos valores que mapea a
 * paths escritos acá adentro. Un `redirectTo` de texto libre en un form es un open redirect, y en
 * una Server Action además es un redirect que el navegador sigue sin preguntar. `catch('stay')`
 * hace que basura en el campo no rompa la publicación: publica y se queda.
 *
 * ── `redirect()` cuando se va, `refresh()` cuando se queda ───────────────────────────────────
 * Las dos son la misma obligación —que la pantalla deje de mentir— y hay que cumplir una. Con
 * `after='stock'` el `redirect()` fuerza la navegación y el segmento se rinde de cero: alcanza.
 * Con `after='stay'`, que es el default y el caso de la lista de `/app/stock`, la acción devolvía
 * `{ error: null }` y la fila se quedaba con el badge viejo, el botón viejo y el motivo de "no se
 * puede publicar" viejo, con la transición ya escrita en Postgres. Mismo bug que el de
 * `stock/{id}/fotos/actions.ts`, distinta pantalla.
 *
 * `/app/stock` **lee vivo de Postgres** (sin `'use cache'`): no hay cache de la ruta que purgar,
 * así que es `refresh()` y no `revalidatePath()`. `invalidateStorefront()`, que `transitionUnit`
 * sí llama, es la otra capa —el CDN de la vidriera— y no refresca ninguna pantalla del panel.
 *
 * Sólo en el camino exitoso, por el mismo motivo que el `redirect()`: un fallo tiene que poder
 * mostrar su mensaje, y refrescar de más es re-consultar Postgres gratis.
 */

const AFTER_PATHS = {
  stay: null,
  stock: '/app/stock',
} as const;

const schema = z.object({
  listingId: z.uuid('Ese equipo no existe.'),
  to: z.enum(['available', 'draft']),
  after: z.enum(['stay', 'stock']).catch('stay'),
});

export async function setListingStatusAction(
  _prev: StatusActionState,
  formData: FormData,
): Promise<StatusActionState> {
  const session = await requireTenant();

  const parsed = schema.safeParse({
    listingId: formData.get('listingId'),
    to: formData.get('to'),
    after: formData.get('after') ?? 'stay',
  });
  if (!parsed.success) {
    return { error: 'No pudimos identificar el equipo. Recargá la pantalla.' };
  }

  const result = await transitionUnit(
    session.ctx,
    session.tenant.slug,
    parsed.data.listingId,
    parsed.data.to,
  );

  if (!result.ok) {
    return { error: result.message };
  }

  // Sólo cuando salió bien. Un fallo tiene que poder mostrar su mensaje donde el dueño está mirando.
  const destination = AFTER_PATHS[parsed.data.after];
  if (destination !== null) {
    redirect(destination);
  }

  // Se queda en la pantalla: hay que decirle al router del cliente que vuelva a pedir el segmento
  // o la fila sigue mostrando el estado anterior. Ver el encabezado.
  refresh();

  return { error: null };
}
