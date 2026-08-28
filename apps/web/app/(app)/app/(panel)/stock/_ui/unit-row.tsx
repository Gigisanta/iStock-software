import Link from 'next/link';
import {
  checkTransition,
  conditionLabel,
  formatUsd,
  type ListingStatus,
} from '@istock/domain';
import { variantUrl } from '@istock/media';
import type { TenantContext } from '../../../../_lib/db/session';
import { denyReasonText, transitionContextFor } from '../../../../_lib/listings/publish-listing';
import type { UnitRow } from '../../../../_lib/listings/queries';
import { StatusButton } from './status-button';

/**
 * Una unidad en la lista de stock. **Server Component**: cero JavaScript salvo el botón de estado.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La miniatura: `<img>` pelado, `width`/`height` explícitos, `loading="lazy"`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nada de `next/image` — está prohibido por `CLAUDE.md` §3 y por la regla W006 de `web-lint`.
 * El byte ya viene del tamaño correcto: `thumb` sale del pipeline de `@istock/media` con el lado
 * mayor en 200px y ≤25 KB. Pasarlo por el optimizador de Vercel sería pagar dos veces por el
 * mismo píxel y encima empeorarlo.
 *
 * La URL la arma `variantUrl()`, nunca esta pantalla. `CLAUDE.md` §2 prohíbe armar una URL de R2
 * a mano, y el motivo no es de estilo: con el esquema de key opaca de ADR-006 **no se puede
 * derivar** una variante desde otra, y cualquier intento de concatenar un sufijo genera una URL
 * que no existe (en el mejor caso) o que apunta a otra cosa (en el peor).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué el motivo de "no se puede publicar" se calcula ACÁ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Se corre `checkTransition()` en el render, con el **mismo** contexto que va a usar la Server
 * Action (`transitionContextFor`). Si el botón se dibujara con un criterio y la acción validara
 * con otro, el dueño vería un botón que siempre falla. Y mostrar el motivo antes del click
 * ("Faltan fotos: para publicarlo necesitás 3") es la diferencia entre una pantalla que enseña y
 * una que rebota.
 *
 * La acción **igual** vuelve a chequear: entre el render y el click pasa tiempo, y el `POST` lo
 * arma cualquiera.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `cost_usd` sólo llega acá si el rol es `owner`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Y no porque este componente lo esconda: `listUnits()` no lo consulta para un `seller`
 * (`CLAUDE.md` §0.9). Acá se renderiza lo que llegó. El `imei` directamente no se selecciona en
 * la lista: la compliance vive en la ficha del equipo (S4), no en la grilla.
 */

const STATUS_LABEL: Readonly<Record<ListingStatus, string>> = {
  draft: 'Borrador',
  available: 'En vidriera',
  reserved: 'Reservado',
  sold: 'Vendido',
  in_transit: 'En camino',
  in_tradein: 'En canje',
  in_service: 'En service',
  unavailable: 'Fuera de venta',
};

const STATUS_CLASS: Readonly<Record<ListingStatus, string>> = {
  draft: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  available: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  reserved: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  sold: 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900',
  in_transit: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300',
  in_tradein: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-300',
  in_service: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-300',
  unavailable: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400',
};

const THUMB_PX = 88;

function detailLine(unit: UnitRow): string {
  const parts = [conditionLabel(unit.condition)];
  if (unit.storageGb !== null) parts.push(`${String(unit.storageGb)} GB`);
  if (unit.color !== null) parts.push(unit.color);
  if (unit.batteryPct !== null) parts.push(`batería ${String(unit.batteryPct)}%`);
  return parts.join(' · ');
}

export function UnitRowCard({ unit, ctx, now }: { unit: UnitRow; ctx: TenantContext; now: Date }) {
  const photo = unit.photos[0];
  const publishCheck = checkTransition('draft', 'available', transitionContextFor(ctx, unit, now));
  const canPublish = unit.status === 'draft' && publishCheck.ok;
  const publishBlockedText =
    unit.status === 'draft' && !publishCheck.ok ? denyReasonText(publishCheck.reason) : null;

  return (
    <li
      data-testid="fila-unidad"
      data-listing-id={unit.id}
      className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex gap-3">
        {photo === undefined ? (
          <div
            aria-hidden="true"
            className="size-[88px] shrink-0 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700"
          />
        ) : (
          <img
            data-testid="thumb-unidad"
            src={variantUrl(photo, 'thumb')}
            alt={photo.alt ?? unit.title}
            width={THUMB_PX}
            height={THUMB_PX}
            loading="lazy"
            decoding="async"
            className="size-[88px] shrink-0 rounded-xl bg-neutral-100 object-cover dark:bg-neutral-800"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 truncate text-base font-semibold leading-tight">{unit.title}</p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[unit.status]}`}
            >
              {STATUS_LABEL[unit.status]}
            </span>
          </div>

          <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
            {detailLine(unit)}
          </p>

          <p className="mt-1 text-base font-semibold tabular-nums">
            {formatUsd(unit.priceUsdCents)}
          </p>

          {unit.costUsdCents === null ? null : (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Te costó {formatUsd(unit.costUsdCents)} · te quedan{' '}
              {formatUsd(unit.priceUsdCents - unit.costUsdCents)}
            </p>
          )}

          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {unit.photoCount === 1 ? '1 foto' : `${String(unit.photoCount)} fotos`}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-start gap-2">
        {canPublish ? (
          <StatusButton
            listingId={unit.id}
            to="available"
            label="Publicar"
            pendingLabel="Publicando…"
            tone="primary"
          />
        ) : null}

        {unit.status === 'available' ? (
          <StatusButton
            listingId={unit.id}
            to="draft"
            label="Sacar de la vidriera"
            pendingLabel="Sacando…"
            tone="quiet"
          />
        ) : null}

        {/*
          El camino a completar las fotos tiene que estar en la fila, no sólo después del alta: un
          borrador con una foto queda impublicable y sin este link no hay forma de llegar a la
          pantalla que lo arregla salvo escribiendo la URL a mano.
        */}
        {unit.status === 'draft' ? (
          <Link
            href={`/app/stock/${unit.id}/fotos`}
            className="flex min-h-[44px] items-center rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700"
          >
            Fotos
          </Link>
        ) : null}

        {publishBlockedText === null ? null : (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{publishBlockedText}</p>
        )}
      </div>
    </li>
  );
}
