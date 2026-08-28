import type { PublicStatus } from '@istock/domain';
import { STATUS_TONE_CLASS, statusBadge } from '../_lib/status';

/**
 * Badge de estado. El texto y el color salen los dos de `_lib/status.ts`, que es donde está
 * escrito por qué `reserved` nunca dice "disponible" y por qué son tres estados y no un booleano.
 *
 * Acá no hay lógica a propósito: si el mapeo estado → texto viviera en el JSX, no se podría
 * testear sin montar React, y la aserción "reservado no dice disponible" es de las que tienen que
 * poder fallar en un test de 3 ms.
 */
export function StatusBadge({ status }: { readonly status: PublicStatus }) {
  const badge = statusBadge(status);

  return (
    <span
      data-status={badge.tone}
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_TONE_CLASS[badge.tone]}`}
    >
      {badge.label}
    </span>
  );
}
