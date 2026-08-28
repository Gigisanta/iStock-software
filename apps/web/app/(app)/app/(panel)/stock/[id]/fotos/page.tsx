import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { MIN_PHOTOS_TO_PUBLISH, checkTransition } from '@istock/domain';
import { variantUrl } from '@istock/media';
import {
  MAX_PHOTOS_PER_LISTING,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_MB,
  PHOTO_ACCEPT_ATTR,
} from '../../../../../_lib/listings/schema';
import { loadUnitWithPhotos } from '../../../../../_lib/listings/queries';
import {
  denyReasonText,
  transitionContextFor,
} from '../../../../../_lib/listings/publish-listing';
import { requireTenant } from '../../../../../_lib/session';
import { PageTitle } from '../../../_ui/section';
import { StatusButton } from '../../_ui/status-button';
import { AgregarFotoForm } from './agregar-foto-form';

/**
 * `/app/stock/{id}/fotos` — completar las fotos de una unidad.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué esta pantalla existe
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `MIN_PHOTOS_TO_PUBLISH` son 3 y **entra una foto por request**: el POST pasa por el Routing
 * Middleware de Vercel, capado en 4 MB, que no varía por plan y que no se evade con streaming.
 * Tres fotos de celular no comparten request con ningún techo de los cuatro de la cadena (ver
 * `_lib/listings/schema.ts`). Así que el alta crea el borrador con la primera foto y acá se suman
 * las que faltan, de a una. No es un paso de más: es el único camino que la plataforma habilita.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La unidad de otro tenant da 404, no 403
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `loadUnitWithPhotos` filtra por `eq(listings.tenantId, ctx.tenantId)` **además** de RLS, y
 * devuelve `null` sin distinguir "no existe" de "no es tuya". Acá eso se convierte en
 * `notFound()`. Un 403 con mensaje propio le confirmaría a alguien de otro negocio que ese id
 * existe, y ese es justo el dato que no queremos regalar.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Server Component. El JavaScript es el form de subida y el botón de publicar, nada más.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Las miniaturas son `<img>` pelados con `width`/`height` explícitos: el byte ya sale del tamaño
 * correcto del pipeline (`thumb`, 200px, ≤25 KB) y `next/image` está prohibido (`CLAUDE.md` §3,
 * regla W006). La URL la arma `variantUrl()`, nunca esta pantalla: con las keys opacas de ADR-006
 * no se puede derivar una variante desde otra y concatenar un sufijo da una URL que no existe.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El botón de publicar se dibuja con el MISMO criterio que valida la acción
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `checkTransition()` con `transitionContextFor()`, igual que en la fila de `/app/stock`. Si la
 * pantalla decidiera con un criterio y la acción con otro, el dueño vería un botón que siempre
 * falla. El `disabled` es cortesía: la Server Action relee la unidad y vuelve a chequear.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  RUTA BLOQUEANTE A PROPÓSITO: `instant = false` y CERO `<Suspense>` de tope
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Esta es la única página del panel sin `<Suspense>` arriba. **No es un olvido y no se le
 * devuelve el boundary**: es la decisión que arregla dos fallas medidas en el gate de S2.
 *
 * Con `cacheComponents: true`, un `<Suspense>` en el tope de la página parte la respuesta en dos.
 * Primero sale el shell —status 200 y el esqueleto— y el contenido real viaja al final, adentro
 * de un `<div hidden id="S:…">` que un script inline (`$RC`) recoloca. Eso rompe dos cosas que
 * acá son parte del contrato, no adornos:
 *
 * 1. **El 404 de la unidad ajena dejaba de ser un 404.** El status se manda con el shell, antes
 *    de que corra `loadUnitWithPhotos()`; `notFound()` llegaba tarde y la respuesta era 200 con
 *    cuerpo de 404. El cuerpo nunca filtró nada —el filtro de tenant siempre corrió—, pero para
 *    cualquiera que lea el status, 200 y 404 son dos respuestas distintas.
 * 2. **Sin JavaScript la pantalla era un esqueleto permanente.** Si `$RC` no corre, el form de
 *    `agregar-foto-form.tsx` nunca sale del `<div hidden>`. El form está bien armado y postea sin
 *    JS, pero a un form invisible no se lo puede tocar: la promesa de progressive enhancement era
 *    falsa por culpa de este boundary, no del form.
 *
 * `export const instant = false` es la salida que nombra el propio Next en el texto del error
 * `blocking-prerender-runtime` — *"[block] Set `export const instant = false` to allow a blocking
 * route"* — y, según `instant.md` §"Disabling static shell validation", también saca a la ruta de
 * la validación de shell estático de Cache Components. Ningún ancestro declara `instant`, así que
 * este `false` es el más alto del árbol de la ruta y alcanza para las dos cosas.
 *
 * **Lo que cuesta, y está aceptado por el LEAD:** en la tabla de rutas de `next build` esta ruta
 * pasa de `◐ (Partial Prerender)` a `ƒ (Dynamic)`. El primer byte espera la sesión, los params y
 * la query de la unidad: no hay esqueleto instantáneo. Es tráfico autenticado del dueño, de una
 * pantalla a la que se llega desde una fila del stock, y una respuesta correcta vale más que un
 * esqueleto rápido que después se contradice.
 *
 * **El alcance es exactamente esta ruta.** `/app`, `/app/ajustes`, `/app/canjes`, `/app/stock` y
 * `/app/stock/nuevo` siguen con su `<Suspense>` y su shell en `◐`, y los dos boundaries del
 * layout del panel (header y bottom nav) siguen donde estaban. La excepción vale acá porque esta
 * es la única ruta del panel que (a) puede `notFound()` por un id que viene de la URL y (b) tiene
 * un form que promete andar sin JavaScript. Si otra ruta del panel se cae a `ƒ`, no es esta
 * decisión: es un efecto colateral y se revierte.
 */

export const metadata: Metadata = { title: 'Fotos del equipo' };

/**
 * Ver el bloque "RUTA BLOQUEANTE A PROPÓSITO" de arriba. Sin esto, Cache Components exige que el
 * acceso a `params` y a la sesión viva adentro de un `<Suspense>`, y ese boundary es justo el bug:
 * manda el 200 antes de saber si la unidad es de este tenant.
 */
export const instant = false;

/** Zod en el borde, también para los params de ruta (`CLAUDE.md` §5). */
const paramsSchema = z.object({ id: z.uuid() });

export default async function FotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireTenant();

  const parsed = paramsSchema.safeParse(await params);
  // Un id con forma inválida no llega a Postgres: el error de cast de UUID termina logueado entero.
  if (!parsed.success) notFound();

  const unit = await loadUnitWithPhotos(ctx, parsed.data.id);
  if (unit === null) notFound();

  const now = new Date();
  const missing = Math.max(0, MIN_PHOTOS_TO_PUBLISH - unit.photos.length);
  const remaining = Math.max(0, MAX_PHOTOS_PER_LISTING - unit.photos.length);
  /**
   * Exactamente la arista que ejecuta la acción (`draft → available`) y con el mismo contexto.
   * `now` se calcula una sola vez: `@istock/domain` no llama `Date.now()`, el tiempo entra por
   * parámetro, y dos relojes distintos en un mismo render hacen el resultado no determinista.
   */
  const draftCheck = checkTransition('draft', 'available', transitionContextFor(ctx, unit, now));
  const isDraft = unit.status === 'draft';
  const canPublish = isDraft && draftCheck.ok;
  const blockedText = isDraft && !draftCheck.ok ? denyReasonText(draftCheck.reason) : null;

  return (
    <>
      <PageTitle hint="Van de a una. Con tres ya lo podés publicar.">{unit.title}</PageTitle>

      <section
        data-testid="fotos-de-la-unidad"
        aria-label="Fotos cargadas"
        className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
      >
        {unit.photos.length === 0 ? (
          <p className="py-4 text-center text-sm text-neutral-600 dark:text-neutral-300">
            Todavía no tiene fotos.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2">
            {unit.photos.map((photo) => (
              <li key={photo.thumbKey} className="contents">
                <img
                  data-testid="foto-cargada"
                  src={variantUrl(photo, 'thumb')}
                  alt={photo.alt ?? unit.title}
                  width={200}
                  height={200}
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full rounded-xl bg-neutral-100 object-cover dark:bg-neutral-800"
                />
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          {unit.photos.length === 1 ? '1 foto' : `${String(unit.photos.length)} fotos`} · máximo{' '}
          {String(MAX_PHOTOS_PER_LISTING)}
        </p>
      </section>

      {missing === 0 ? null : (
        <p
          data-testid="faltan-fotos"
          className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          {missing === 1
            ? 'Falta 1 foto para poder publicar'
            : `Faltan ${String(missing)} fotos para poder publicar`}
        </p>
      )}

      <div className="mt-5">
        {remaining === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Ya tiene las {String(MAX_PHOTOS_PER_LISTING)} fotos que entran por equipo.
          </p>
        ) : (
          <AgregarFotoForm
            listingId={unit.id}
            photoAccept={PHOTO_ACCEPT_ATTR}
            maxPhotoBytes={MAX_PHOTO_BYTES}
            maxPhotoMb={MAX_PHOTO_MB}
            remaining={remaining}
          />
        )}
      </div>

      <div className="mt-6 border-t border-neutral-200 pt-5 dark:border-neutral-800">
        {isDraft ? (
          <>
            <StatusButton
              listingId={unit.id}
              to="available"
              label="Publicar en mi vidriera"
              pendingLabel="Publicando…"
              tone="primary"
              testId="submit-publicar"
              disabled={!canPublish}
              after="stock"
            />
            {blockedText === null ? null : (
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{blockedText}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Este equipo ya no es un borrador. Su estado se cambia desde el stock.
          </p>
        )}
      </div>

      <p className="mt-6 text-center text-sm">
        <Link href="/app/stock" className="underline underline-offset-2">
          Volver al stock
        </Link>
      </p>
    </>
  );
}
