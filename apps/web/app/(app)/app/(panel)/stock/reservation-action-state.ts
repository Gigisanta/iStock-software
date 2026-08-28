/**
 * Estado de `reserveUnitAction` y `cancelReservationAction`.
 *
 * Vive aparte por la misma razón que `status-action-state.ts`: un archivo `'use server'` sólo
 * puede exportar funciones asíncronas, así que un `interface` o una constante ahí adentro rompe el
 * build. No es organización, es una regla del compilador.
 */
export interface ReservationActionState {
  readonly error: string | null;
}

export const initialReservationActionState: ReservationActionState = { error: null };
