/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Los VENCIMIENTOS del seed se cuentan contra el reloj de la corrida, no contra `SEED_NOW`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## El defecto que este archivo existe para que no vuelva
 *
 * El seed fechaba **todo** con `SEED_NOW`, una constante congelada, incluidas las tres columnas
 * que no son un hecho histórico sino un **plazo**: `reservations.expires_at` y los dos
 * `trial_ends_at`. Una reserva sembrada con `expires_at = SEED_NOW + 60 min` nace vencida contra
 * el reloj real apenas la constante queda atrás, y desde S6 hay un cron cada 5 minutos
 * (`/api/cron/expire-reservations`) que la vence y devuelve la unidad a `available`.
 *
 * O sea: el seed corría verde, los tests pasaban, y minutos después el `/demo` perdía el badge
 * "Reservado" —uno de los estados que le queremos mostrar a un reseller que está evaluando— **en
 * silencio y con retraso**. En la base local de este repo la fila ya estaba en `expired` antes de
 * que nadie lo notara.
 *
 * ## Por qué se lee la FILA y no la constante
 *
 * Un test que compare `minutesAfter(SEED_NOW, 60)` contra lo que el seed escribió sería verde con
 * el bug adentro: comprobaría que el seed hace lo que el seed hace. Lo único que decide es la
 * pregunta que se hace el cron: **¿esta fila está vencida contra `now()`?** Así que se corre el
 * seed de verdad, se lee la fila de verdad, y se compara contra el reloj de Postgres (que es el
 * que usa el barrido) y contra el de Node.
 *
 * ## Alcance: es de `db-agent`
 *
 * No cruza tenants —mira sólo el tenant `demo`, que es el que siembra este paquete— y ningún gate
 * lo cita como evidencia. `CLAUDE.md` §4: el test unitario de un paquete es del owner del paquete.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_TENANT_ID } from './seed-data';
import { openAdmin } from './test-session';

const admin = openAdmin();

/** El `tsx` del monorepo. Sin él no hay forma de correr el seed de verdad, y un mock no serviría. */
function tsxBin(): string {
  const candidates = [
    path.resolve(process.cwd(), 'node_modules/.bin/tsx'),
    path.resolve(process.cwd(), '../../node_modules/.bin/tsx'),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (found === undefined) throw new Error(`no encontré tsx en: ${candidates.join(', ')}`);
  return found;
}

interface DeadlineRow {
  readonly id: string;
  readonly status: string;
  readonly minutes: number;
  readonly created_at: Date;
  readonly expires_at: Date;
  readonly ms_left: string;
}

beforeAll(() => {
  // El seed es idempotente (borra y recrea el tenant demo), así que correrlo acá no ensucia nada.
  execFileSync(tsxBin(), ['src/seed.ts'], { cwd: process.cwd(), stdio: 'pipe' });
}, 60_000);

afterAll(async () => {
  await admin.end({ timeout: 5 });
});

describe('el seed no siembra plazos ya vencidos', () => {
  it('ninguna reserva `active` del demo está vencida contra el reloj de AHORA', async () => {
    const rows = (await admin`
      select id, status, minutes, created_at, expires_at,
             extract(epoch from (expires_at - now())) * 1000 as ms_left
        from reservations
       where tenant_id = ${SEED_TENANT_ID} and status = 'active'
    `) as unknown as DeadlineRow[];

    // El gate D4 pide exactamente una unidad reservada: si esto es 0, o el seed cambió o el cron
    // ya se la llevó, y las dos cosas son el bug.
    expect(rows).toHaveLength(1);

    const now = Date.now();
    for (const row of rows) {
      expect(Number(row.ms_left), `reserva ${row.id} vencida contra now() de Postgres`).toBeGreaterThan(0);
      expect(row.expires_at.getTime(), `reserva ${row.id} vencida contra el reloj de Node`).toBeGreaterThan(now);
    }
  });

  it('a la reserva demo le queda más de un día: sobrevive a un seed corrido ayer', async () => {
    const rows = (await admin`
      select id, status, minutes, created_at, expires_at,
             extract(epoch from (expires_at - now())) * 1000 as ms_left
        from reservations
       where tenant_id = ${SEED_TENANT_ID} and status = 'active'
    `) as unknown as DeadlineRow[];

    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    // 24 h es el piso, no el valor elegido: el margen concreto lo decide `seed-data.ts` y este
    // test no lo copia, lo mide. Un margen de minutos —el que había— no pasa de acá.
    expect(Number(row.ms_left)).toBeGreaterThan(24 * 60 * 60 * 1000);
    // Y la fila sigue siendo una reserva legal del producto (30–120 min, CHECK de Postgres).
    expect(row.minutes).toBeGreaterThanOrEqual(30);
    expect(row.minutes).toBeLessThanOrEqual(120);
  });

  it('el trial del tenant demo y el de su suscripción todavía no terminaron', async () => {
    const [tenant] = (await admin`
      select trial_ends_at, extract(epoch from (trial_ends_at - now())) * 1000 as ms_left
        from tenants where id = ${SEED_TENANT_ID}
    `) as unknown as { trial_ends_at: Date; ms_left: string }[];
    const [sub] = (await admin`
      select trial_ends_at, extract(epoch from (trial_ends_at - now())) * 1000 as ms_left
        from subscriptions where tenant_id = ${SEED_TENANT_ID}
    `) as unknown as { trial_ends_at: Date; ms_left: string }[];

    expect(tenant).toBeDefined();
    expect(sub).toBeDefined();
    // Un trial que terminó apaga entitlements (`trialIsAlive`) y pone el cartel de "se te terminó
    // la prueba" en el panel. Sembrado desde una constante, eso llega solo un día cualquiera.
    expect(Number(tenant?.ms_left ?? 0)).toBeGreaterThan(0);
    expect(Number(sub?.ms_left ?? 0)).toBeGreaterThan(0);
  });
});
