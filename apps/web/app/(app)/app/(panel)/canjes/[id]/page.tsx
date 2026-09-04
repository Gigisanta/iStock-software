import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { conditionLabel, formatUsd } from '@istock/domain';
import { listCatalogModels } from '../../../../_lib/catalog/queries';
import { priceInputValue } from '../../../../_lib/sales/presentation';
import { requireTenant } from '../../../../_lib/session';
import { prefillValue, waHref } from '../../../../_lib/tradein/presentation';
import { loadTradeinLead, type TradeinLead } from '../../../../_lib/tradein/queries';
import { tradeinStatusLabel } from '../../../../_lib/tradein/status';
import { Card, DataRow, PageTitle } from '../../_ui/section';
import { AcceptForm } from './accept-form';
import type { AcceptFormValues } from './accept-form-state';

/**
 * `/app/canjes/{id}` — la ficha de un canje y el botón que lo convierte en stock.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El canje de otro tenant da 404, no 403
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `loadTradeinLead()` filtra por `eq(tradeinLeads.tenantId, ctx.tenantId)` **además** de RLS y
 * devuelve `null` sin distinguir "no existe" de "no es tuyo". Acá eso es `notFound()`. Un 403 con
 * mensaje propio le confirmaría a alguien de otro negocio que ese id existe.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  RUTA BLOQUEANTE A PROPÓSITO: `instant = false` y CERO `<Suspense>` de tope
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mismo motivo, medido, que `/app/stock/{id}/fotos`. Con `cacheComponents: true` un `<Suspense>`
 * arriba parte la respuesta: el status 200 sale con el shell, antes de que corra la query, así que
 * el `notFound()` del lead ajeno llegaría tarde y la respuesta sería un 200 con cuerpo de 404. Y
 * el formulario de aceptar viajaría dentro de un `<div hidden>` que sólo se recoloca si corre
 * JavaScript, o sea que su promesa de andar sin JS sería falsa por culpa del boundary.
 *
 * Cuesta que la ruta sea `ƒ (Dynamic)` en vez de `◐`. Es tráfico autenticado a una pantalla a la
 * que se llega desde una fila del inbox, y una respuesta correcta vale más que un esqueleto rápido
 * que después se contradice.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Qué llega al payload de un `seller`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ni `offer_usd` ni `internal_notes`: `loadTradeinLead()` no los pide en el SQL cuando el rol no es
 * `owner`, así que las claves **no existen** en el objeto que se serializa. `lead.canSeeOffer` es
 * el discriminante de la unión, no un `if` de presentación: sin él no compila leer el costo.
 * `CLAUDE.md` §0.9.
 *
 * Lo que un `seller` sí ve es el nombre y el WhatsApp del visitante, porque es quien atiende el
 * mostrador y contesta. Es PII y está protegida por otras tres capas: RLS de tenant, la prohibición
 * de loguearla (`_lib/log.ts` tira si el campo se llama así) y la de meterla en un DTO público.
 *
 * ── Sin `next/image`, sin fotos ──────────────────────────────────────────────────────────────
 * Un lead no trae fotos: es texto que escribió alguien desde el teléfono. Esta pantalla no pide un
 * solo byte a R2.
 */

export const metadata: Metadata = { title: 'Canje' };

/** Ver el bloque "RUTA BLOQUEANTE A PROPÓSITO". */
export const instant = false;

/** Zod en el borde, también para los params de ruta (`CLAUDE.md` §5). */
const paramsSchema = z.object({ id: z.uuid() });

export default async function CanjeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { role, ctx } = await requireTenant();

  const parsed = paramsSchema.safeParse(await params);
  // Un id con forma inválida no llega a Postgres: el error de cast de UUID termina logueado entero.
  if (!parsed.success) notFound();

  const lead = await loadTradeinLead(ctx, parsed.data.id);
  if (lead === null) notFound();

  const isOwner = role === 'owner';
  const alreadyAccepted = lead.createdListingId !== null;
  /**
   * El catálogo se pide **sólo si el formulario se va a dibujar**. Un `seller` mirando un lead no
   * necesita cuarenta modelos en su payload, y un lead ya aceptado tampoco.
   */
  const canAccept = isOwner && !alreadyAccepted;
  const catalogModels = canAccept ? await listCatalogModels(ctx) : [];
  const phoneHref = waHref(lead.customerWaPhone);

  return (
    <>
      <PageTitle hint={`Entró el ${lead.createdAt.toLocaleDateString('es-AR')} · ${tradeinStatusLabel(lead.status)}`}>
        {lead.modelText}
      </PageTitle>

      <Card>
        <dl>
          <DataRow label="Cliente" value={lead.customerName} />
          <DataRow
            label="WhatsApp"
            value={
              phoneHref === null ? (
                // El visitante no escribió un teléfono usable. Se muestra tal cual para copiarlo a
                // mano; armar un `wa.me` con eso abre una conversación que no existe.
                <span>{lead.customerWaPhone}</span>
              ) : (
                <a
                  href={phoneHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center underline underline-offset-2"
                >
                  {lead.customerWaPhone}
                </a>
              )
            }
          />
          <DataRow label="Dice que es" value={<DeclaredSpecs lead={lead} />} />
          {lead.notes === null ? null : <DataRow label="Comentario del cliente" value={lead.notes} />}
          {lead.canSeeOffer && lead.offerUsdCents !== null ? (
            <DataRow label="Le ofreciste" value={formatUsd(lead.offerUsdCents)} />
          ) : null}
          {lead.canSeeOffer && lead.internalNotes !== null ? (
            <DataRow label="Nota interna" value={lead.internalNotes} />
          ) : null}
        </dl>
      </Card>

      <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
        Todo esto lo escribió el cliente desde su teléfono. Revisá el equipo antes de aceptar.
      </p>

      {lead.createdListingId !== null ? (
        <div className="panel-card mt-6 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-base font-semibold">Este canje ya entró al stock</p>
          <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300">
            Quedó como borrador. Sacale las fotos y publicalo.
          </p>
          <Link
            href={`/app/stock/${lead.createdListingId}/fotos`}
            className="mt-3 flex min-h-[52px] w-full items-center justify-center rounded-xl bg-neutral-900 px-6 text-base font-semibold text-white dark:bg-white dark:text-neutral-900"
          >
            Ver el equipo en el stock
          </Link>
        </div>
      ) : canAccept ? (
        <>
          <h2 className="mt-8 text-lg font-bold tracking-tight">Aceptarlo y cargarlo al stock</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            Confirmá los datos con el equipo en la mano. Entra como borrador, sin fotos.
          </p>
          <AcceptForm leadId={lead.id} catalogModels={catalogModels} prefill={prefillFrom(lead)} />
        </>
      ) : (
        <div className="panel-empty mt-6 rounded-2xl border border-dashed border-neutral-300 bg-white p-4 text-center dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Contestale por WhatsApp y coordiná que lo traiga. Cargarlo al stock lo hace el dueño de
            la cuenta, porque define el costo del equipo.
          </p>
        </div>
      )}

      <p className="mt-6 text-center text-sm">
        <Link href="/app/canjes" className="underline underline-offset-2">
          Volver a canjes
        </Link>
      </p>
    </>
  );
}

function DeclaredSpecs({ lead }: { lead: TradeinLead }) {
  const parts = [
    lead.storageGb === null ? null : `${String(lead.storageGb)} GB`,
    lead.color,
    lead.declaredCondition === null ? null : conditionLabel(lead.declaredCondition),
    lead.batteryPct === null ? null : `batería ${String(lead.batteryPct)}%`,
  ].filter((part): part is string => part !== null);

  return <span>{parts.length === 0 ? 'No dejó más datos' : parts.join(' · ')}</span>;
}

/**
 * Los valores con los que arranca el formulario. Todos son **declarados por el visitante** salvo
 * la oferta, que sólo existe si el dueño ya la había cargado.
 *
 * `priceInputValue()` es el inverso exacto de `parseUsdToCents()`: precargar con `formatUsd()`
 * dejaría un `"US$ 1.200"` que el propio borde rechaza.
 */
function prefillFrom(lead: TradeinLead): AcceptFormValues {
  return {
    title: lead.modelText,
    catalogModelId: '',
    condition: lead.declaredCondition ?? '',
    storageGb: prefillValue(lead.storageGb),
    color: lead.color ?? '',
    batteryPct: prefillValue(lead.batteryPct),
    priceUsd: '',
    offerUsd: lead.canSeeOffer && lead.offerUsdCents !== null ? priceInputValue(lead.offerUsdCents) : '',
  };
}
