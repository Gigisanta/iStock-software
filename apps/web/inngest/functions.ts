import 'server-only';

import { cron, Inngest } from 'inngest';
import { inngestConfig } from '../app/(app)/_lib/env';
import {
  reservationMaintenanceIsDegraded,
  runReservationMaintenance,
} from '../app/(app)/_lib/scheduler/reservation-maintenance';

const config = inngestConfig();

export const inngest = new Inngest({
  id: 'istock',
  ...(config.eventKey === undefined ? {} : { eventKey: config.eventKey }),
  ...(config.signingKey === undefined ? {} : { signingKey: config.signingKey }),
});

export const expireReservations = inngest.createFunction(
  {
    id: 'expire-reservations',
    triggers: [cron('*/5 * * * *')],
  },
  async () => {
    const { sweep, fxRefresh } = await runReservationMaintenance();

    if (reservationMaintenanceIsDegraded(sweep)) {
      throw new Error('El barrido de reservas quedó degradado.');
    }

    return {
      ok: true,
      ...sweep,
      fxUpdated: fxRefresh.updatedTenants,
    };
  },
);

export const functions = [expireReservations] as const;
