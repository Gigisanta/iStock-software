import type { tradeinLeads } from '@istock/db';

/**
 * El estado de un canje, y cómo se escribe en la pantalla.
 *
 * ── Por qué el tipo sale de la tabla y no de una lista escrita a mano ────────────────────────
 * `TradeinStatus` se deriva de `tradeinLeads.$inferSelect` con un **`import type`**, que TypeScript
 * borra al compilar. O sea: el enum de Postgres es la única fuente —si `db-agent` le agrega un
 * estado, este archivo deja de compilar hasta que alguien decida cómo se llama en castellano— y al
 * mismo tiempo Drizzle **no entra al bundle** del componente que muestra la etiqueta. Una segunda
 * lista de estados escrita acá compilaría siempre y mentiría cuando cambie la tabla.
 *
 * ── `accepted` es el único estado con significado de negocio para el panel ───────────────────
 * `acceptToStock()` es la única transición que este slice escribe, y su guard de concurrencia es
 * `status <> 'accepted'`. Los otros cuatro son etiquetas de seguimiento y hoy no los mueve nadie
 * desde el panel (S8 no trae la pantalla de "contactado" ni la de rechazo).
 */

export type TradeinStatus = (typeof tradeinLeads.$inferSelect)['status'];

/** El estado en el que un canje ya se convirtió en stock. Ver `accept-to-stock.ts`. */
export const ACCEPTED: TradeinStatus = 'accepted';

const STATUS_LABEL: Readonly<Record<TradeinStatus, string>> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  evaluating: 'En evaluación',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
};

export function tradeinStatusLabel(status: TradeinStatus): string {
  return STATUS_LABEL[status];
}
