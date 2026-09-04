import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireTenant } from '../../../_lib/session';
import { listTradeinLeads } from '../../../_lib/tradein/queries';
import { PageTitle } from '../_ui/section';
import { LeadCard } from './_ui/lead-card';

/**
 * `/app/canjes` — el inbox de canjes.
 *
 * Canje es un flujo de primera clase del producto (`CLAUDE.md` §1), no una nota al pie: el equipo
 * del cliente entra al stock por acá, con su costo, y por eso esta pantalla vive en la barra de
 * abajo al lado del stock.
 *
 * ── Server Component, sin excepciones ────────────────────────────────────────────────────────
 * La lista se lee, no se toca. Cero JavaScript al cliente.
 *
 * ── Autorización adentro de la página ────────────────────────────────────────────────────────
 * `requireTenant()` acá, no en el layout: un layout no vuelve a correr al navegar entre páginas
 * hermanas (ADR-007). `listTradeinLeads()` corre con `withTenantDb` (RLS activa) **más** su
 * `where tenant_id = …` explícito. Las dos capas, siempre.
 *
 * ── Qué llega al payload de esta pantalla ────────────────────────────────────────────────────
 * Para un `seller`, ni `offer_usd` ni `internal_notes`: no se piden en el SQL, así que no existen
 * en el objeto que se serializa al cliente. No es un `hidden` ni un `null`. Ver
 * `_lib/tradein/queries.ts`.
 */

export const metadata: Metadata = { title: 'Canjes' };

export default function TradeInPage() {
  return (
    <Suspense fallback={<TradeInSkeleton />}>
      <TradeInContent />
    </Suspense>
  );
}

async function TradeInContent() {
  const { ctx } = await requireTenant();
  const leads = await listTradeinLeads(ctx);

  return (
    <>
      <PageTitle hint="Lo que el cliente quiere entregar, antes de que se tome el colectivo hasta tu local.">
        Canjes
      </PageTitle>

      {leads.length === 0 ? (
        <div className="panel-empty rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-base font-semibold">Todavía no te entró ningún canje</p>
          <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300">
            Cuando alguien cargue su equipo desde tu vidriera, te aparece acá con los datos y el
            WhatsApp para contestarle.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {leads.length === 1 ? '1 canje' : `${String(leads.length)} canjes`}
          </p>
          <ul className="mt-2 space-y-3">
            {leads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function TradeInSkeleton() {
  return (
    <div className="space-y-3 pt-2" aria-hidden="true">
      <div className="h-9 w-40 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-24 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-24 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
    </div>
  );
}
