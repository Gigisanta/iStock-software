import 'server-only';

import { pgErrorCode } from '../db/pg-error';
import { refreshAutomaticFxSettings, type AutomaticFxRefresh } from '../fx/automatic-rate';
import { expireDueReservations, type ExpirySweep } from '../reservations/expire-reservations';

export interface ReservationMaintenanceResult {
  readonly sweep: ExpirySweep;
  readonly fxRefresh: AutomaticFxRefresh;
}

/** Error seguro para el contexto de Inngest cuando falla el barrido completo. */
export class ReservationMaintenanceSweepError extends Error {
  readonly code: string;

  constructor(code: string) {
    super('No pudimos completar el barrido de reservas.');
    this.name = 'ReservationMaintenanceSweepError';
    this.code = code;
  }
}

/** Conserva el sweep para que el GET mantenga su respuesta actual sin propagar el error crudo. */
export class ReservationMaintenanceFxError extends Error {
  readonly sweep: ExpirySweep;

  constructor(sweep: ExpirySweep) {
    super('No pudimos actualizar la cotización automática.');
    this.name = 'ReservationMaintenanceFxError';
    this.sweep = sweep;
  }
}

/**
 * Ejecuta el mantenimiento común de reservas y cotización.
 *
 * Los errores se convierten en errores sin payload de infraestructura: el route handler conserva
 * su SQLSTATE y el job de Inngest puede reintentar sin llevar mensajes de Postgres al contexto.
 */
export async function runReservationMaintenance(): Promise<ReservationMaintenanceResult> {
  let sweep: ExpirySweep;
  try {
    sweep = await expireDueReservations();
  } catch (error) {
    throw new ReservationMaintenanceSweepError(pgErrorCode(error));
  }

  let fxRefresh: AutomaticFxRefresh;
  try {
    fxRefresh = await refreshAutomaticFxSettings();
  } catch {
    throw new ReservationMaintenanceFxError(sweep);
  }

  return { sweep, fxRefresh };
}

/** Una corrida que no drena necesita quedar fallida para que el scheduler la reintente. */
export function reservationMaintenanceIsDegraded(sweep: ExpirySweep): boolean {
  return sweep.stuck > 0 || sweep.unrecorded > 0 || sweep.abandoned > 0;
}
