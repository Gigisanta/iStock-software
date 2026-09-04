import Link from 'next/link';
import { conditionLabel, formatUsd } from '@istock/domain';
import type { TradeinLead } from '../../../../_lib/tradein/queries';
import { tradeinStatusLabel } from '../../../../_lib/tradein/status';

/**
 * Un canje en el inbox. **Server Component**: cero JavaScript.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La oferta se dibuja porque llegó, no llegó porque se dibuje
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `lead.canSeeOffer` es el discriminante de la unión que devuelve `listTradeinLeads()`. En la rama
 * del `seller` la clave `offerUsdCents` **no existe en el objeto**, así que esto no es un `if` que
 * esconde: es un `if` que TypeScript exige para poder leer un campo que, en el otro caso, no está.
 * Sacarlo no revelaría el costo — no compilaría. `CLAUDE.md` §0.9.
 *
 * La condición que se muestra es la **declarada por el visitante**, y lo dice con todas las letras:
 * es lo que alguien escribió desde el teléfono sin que nadie mire el equipo. Confundirla con la
 * condición real es cómo se publica un "usado excelente" que llega rayado.
 */

const STATUS_CLASS: Readonly<Record<string, string>> = {
  new: 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900',
  contacted: 'bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100',
  evaluating: 'bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100',
  accepted: 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900',
  rejected: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

export function LeadCard({ lead }: { lead: TradeinLead }) {
  const specs = [
    lead.storageGb === null ? null : `${String(lead.storageGb)} GB`,
    lead.color,
    lead.declaredCondition === null ? null : conditionLabel(lead.declaredCondition),
    lead.batteryPct === null ? null : `batería ${String(lead.batteryPct)}%`,
  ].filter((part): part is string => part !== null);

  return (
    <li className="panel-lead-card rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <Link
        href={`/app/canjes/${lead.id}`}
        className="flex min-h-[88px] flex-col gap-1.5 p-4"
        prefetch={false}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="text-base font-semibold leading-tight">{lead.modelText}</span>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[lead.status] ?? ''}`}
          >
            {tradeinStatusLabel(lead.status)}
          </span>
        </div>

        {specs.length === 0 ? null : (
          <span className="text-sm text-neutral-600 dark:text-neutral-300">
            {specs.join(' · ')}
            <span className="text-neutral-400 dark:text-neutral-500"> (dice el cliente)</span>
          </span>
        )}

        <span className="text-sm text-neutral-600 dark:text-neutral-300">{lead.customerName}</span>

        {lead.canSeeOffer && lead.offerUsdCents !== null ? (
          <span className="text-sm font-semibold">Le ofreciste {formatUsd(lead.offerUsdCents)}</span>
        ) : null}
      </Link>
    </li>
  );
}
