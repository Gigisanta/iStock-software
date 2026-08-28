import 'server-only';
import { and, asc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { expireReservation, transitionEffects } from '@istock/domain';
import { listingEvents, listings, reservations, tenants } from '@istock/db';
import { pgErrorCode } from '../db/pg-error';
import { withServiceDb } from '../db/session';
import { logError, logEvent } from '../log';
import { invalidateStorefrontUnit } from '../tenants/storefront-cache';

/**
 * El barrido de reservas vencidas. Lo llama el cron
 * (`app/api/cron/expire-reservations/route.ts`); nadie más.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Idempotente por construcción, porque el cron no es exactly-once
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Vercel Cron puede disparar dos veces, y un deploy en el medio puede dejar una corrida a mitad de
 * camino. `ARCHITECTURE.md` §Jobs pide que correrlo dos veces no rompa nada, y acá eso se consigue
 * sin estado propio:
 *
 * - **quién decide es el dominio**: `expireReservation()` es puro, con `now` inyectado, y sobre una
 *   reserva que no venció (o que ya no está `active`) devuelve `changed: false`. Ahí no se escribe;
 *   ni un `update` que afecte 0 filas.
 * - **las dos escrituras van guardadas por el estado de origen** (`status = 'reserved'`,
 *   `status = 'active'`). La segunda corrida las encuentra ya movidas y afecta 0 filas, así que
 *   no cuenta de nuevo ni emite un evento duplicado.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Orden de locks: `listings` → `reservations`. Siempre, en todo el producto (D1)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Este barrido y el panel tocan **las mismas dos tablas en la misma transacción**: el cron vence una
 * reserva mientras el dueño, parado en el mostrador, cancela esa misma reserva o marca el equipo
 * vendido. Hasta S6 cada uno las tomaba en el orden que le resultaba natural —el cron cerraba la
 * reserva y después liberaba el listing; `cancelReservation()` movía el listing y después cerraba la
 * reserva— y eso es la receta canónica de un deadlock: dos transacciones, dos filas, orden opuesto.
 * Postgres lo resuelve matando a una con `40P01`, o sea a cualquiera de las dos, o sea a veces al
 * dueño que está mirando la pantalla.
 *
 * El LEAD unificó en el orden del panel (D1) y el que se invirtió fue **este** archivo: primero se
 * mueve el `listing`, después se cierra la `reservation`. El orden es lo único que evita el deadlock;
 * no hay reintento que lo compense, porque un reintento sobre un ciclo de locks vuelve a chocar.
 *
 * Efecto de haber invertido, que es real y está asumido: ya no se puede "no tocar `listings` si la
 * reserva ya estaba cerrada", porque para saberlo habría que leer `reservations` primero y eso es
 * volver al orden viejo. Ahora se intenta el `update` de `listings` guardado por `status='reserved'`,
 * que en ese caso afecta 0 filas y no escribe nada. Se cambió una lectura evitada por la ausencia de
 * deadlocks, y ese cambio conviene.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Una fila por transacción, no un `update` masivo
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Un solo `update ... where expires_at <= now()` sería una línea y sería peor. Cada unidad
 * liberada tiene que (a) mover su listing **sólo si sigue reservado**, (b) cerrar su reserva,
 * (c) dejar su fila en `listing_events` y (d) invalidar la vidriera de **su** tenant. Eso es una
 * decisión por fila, no una sentencia. Y con transacciones chicas, una fila que explota
 * —un deadlock contra el dueño cancelando la misma reserva desde el panel— no se lleva puesto el
 * barrido entero: se cuenta como `failed`, se loguea el id y sigue la siguiente.
 *
 * El techo de `EXPIRE_BATCH_SIZE` es la otra mitad: el cron corre cada pocos minutos y una función
 * de Vercel tiene un `maxDuration`. Lo que no entra en esta pasada entra en la próxima, porque el
 * `order by` deja primero a las más viejas **de las que todavía tienen chance**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Head-of-line: por qué el `order by` empieza por `sweep_attempts` y no por `expires_at`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Hasta S6 el orden era `expires_at asc` a secas, y ese detalle convertía una falla de una fila en
 * una falla del producto. Una reserva que tira siempre —un `CHECK` que no da, un listing en un
 * estado que nadie previó, una policy que cambió— **conserva su lugar de privilegio**: es la más
 * vieja, así que vuelve a ser la primera del lote en la corrida siguiente, y en la siguiente. El
 * barrido la reintenta 8.640 veces por mes, y con el lote lleno de filas igual de tóxicas las sanas
 * que vienen atrás nunca llegan a procesarse. Del lado del cliente eso se ve como una unidad que
 * dice «Reservado» para siempre: no se factura, se cancela.
 *
 * El arreglo son tres piezas y las tres hacen falta:
 *
 * 1. **`order by sweep_attempts asc, expires_at asc`.** Fallar te manda al fondo de la cola. La
 *    fila vieja y sana pasa adelante de la fila vieja y rota.
 * 2. **`sweep_attempts < MAX_SWEEP_ATTEMPTS` en el `where`.** Pasado el techo la fila deja de
 *    entrar al lote: reintentar para siempre algo que falla siempre es gastar la ventana del cron
 *    en algo que ya sabemos que no va a andar.
 * 3. **El `+1` en su propia transacción.** Ver el `catch` del `for`. Escribirlo adentro de la
 *    transacción que falló es la forma fácil de creer que esto quedó arreglado y no haber
 *    arreglado nada: el `update` se rollea con el error y el contador se queda en 0 para siempre.
 *
 * Y una cuarta que no es código de acá: abandonar tiene que ser **ruidoso**. Por eso `abandoned`
 * se cuenta con una segunda query y el cron devuelve 500 (`route.ts`). Una fila abandonada en
 * silencio es el mismo bug con otro disfraz — la unidad sigue trabada y ahora ni siquiera aparece
 * en los logs. Las dos salidas son humanas: el dueño aprieta «Liberar equipo» en el panel (por eso
 * `presentation.ts` dejó de decirle que esperara) o un operador pone `sweep_attempts = 0` cuando
 * arregló la causa.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Costo
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **Dos** queries por corrida —el barrido y el censo de abandonadas—, las dos cubiertas por
 * `reservations_active_expiry_idx`, el índice parcial sobre `status = 'active'`, y las dos sobre
 * una tabla que en el caso normal no tiene ni una fila vencida. Son 2 × 288 = 576 queries por día
 * contra un índice parcial: ruido de fondo al lado de un pageview. La segunda se paga a propósito
 * y no se puede evitar mirando el resultado de la primera, porque el caso que descubre es
 * justamente aquel en el que la primera trae **cero** filas y sin embargo hay una unidad trabada.
 * Fuera de eso, **cero** trabajo de escritura cuando no hay nada que vencer, que es el caso normal. No hay worker 24/7 (`CLAUDE.md` §3) ni contador en Postgres haciendo de rate limit.
 * `invalidateStorefrontUnit` se llama una vez por unidad liberada, no por corrida: purgar la
 * vidriera entera cuando venció una reserva regeneraría 200 fichas por una.
 */

/**
 * Techo por corrida. Con el cron cada 5 minutos, 200 reservas vencidas en una ventana es un
 * volumen que este producto no tiene: el techo existe para acotar el peor caso (una base sin
 * barrer por horas), no para el caso normal.
 */
export const EXPIRE_BATCH_SIZE = 200;

/**
 * Cuántas corridas seguidas puede fallar una reserva antes de que el barrido deje de tomarla.
 *
 * Con el cron cada 5 minutos son ~25 minutos de reintentos. Sobra para lo transitorio —un `40P01`
 * contra el dueño cancelando esa misma reserva desde el mostrador se resuelve en el intento
 * siguiente— y corta lo sistémico antes de que se coma la ventana del cron todos los días.
 *
 * El número vive acá y no en el dominio porque no es una regla de negocio: es cuántas veces vale la
 * pena insistir contra esta base con este cron. Si el cron cambia de frecuencia, este número cambia
 * con él.
 */
export const MAX_SWEEP_ATTEMPTS = 5;

export interface ExpirySweep {
  /** Reservas candidatas que trajo la query. */
  readonly scanned: number;
  /** Reservas que pasaron a `expired`. */
  readonly expired: number;
  /**
   * Unidades que volvieron a `available`. Normalmente ≤ `expired` (el listing pudo haberse movido a
   * `sold` y entonces se cierra la reserva sin liberar nada), pero no es un invariante: una unidad
   * `reserved` sin reserva activa se libera igual y suma acá sin sumar en `expired`.
   */
  readonly released: number;
  /** El dominio dijo que no había nada que hacer. */
  readonly skipped: number;
  /** Filas que tiraron. El barrido siguió. */
  readonly failed: number;
  /**
   * El subconjunto de `failed` que **ya venía fallando** (`sweep_attempts >= 1` antes de este
   * intento).
   *
   * La distinción es la que hace que el rojo del cron signifique algo. El dueño cancelando desde el
   * panel la misma reserva que el barrido está venciendo produce un deadlock legítimo y un `failed`
   * legítimo; un cron que se pinta de rojo por eso enseña a ignorar el rojo, que es exactamente el
   * modo de falla que este archivo vino a cerrar. Una fila que falla dos veces seguidas ya no es una
   * carrera perdida: es una fila rota.
   */
  readonly stuck: number;
  /**
   * Filas que fallaron y a las que **tampoco** se les pudo anotar el intento.
   *
   * El caso peor, y el más callado. Sin el `+1` la fila vuelve a encabezar el `order by` en la
   * próxima corrida y nunca llega a `stuck` ni al techo: el head-of-line vuelve entero y sin
   * síntoma. Por eso cuenta como degradación desde la primera y no espera a la segunda.
   */
  readonly unrecorded: number;
  /**
   * Reservas vencidas que el barrido ya no toma porque pasaron `MAX_SWEEP_ATTEMPTS`.
   *
   * No sale del `for` —el techo está en el `where`, así que estas filas por definición no entran al
   * lote—: sale de una segunda query. Es el número que evita que "abandonar" sea sinónimo de
   * "esconder": cada unidad contada acá está trabada en `reserved` hasta que una persona la libere.
   */
  readonly abandoned: number;
}

/**
 * Vence lo que tenga que vencer y devuelve el conteo.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué esta función corre sin tenant, y por qué eso NO es el bug que la regla persigue
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` §2 pide filtro de `tenant_id` en la query además de RLS, y el `select` de abajo no lo
 * lleva. Es una excepción declarada, no un olvido, y se sostiene en tres cosas:
 *
 * 1. **No hay tenant contra el cual filtrar.** El cron lo dispara Vercel, no una persona: no hay
 *    sesión, no hay claim, no hay membresía. Acotarlo a un `tenantId` obligaría a iterar todos los
 *    tenants (una query por negocio, cada cinco minutos, para vencer casi siempre cero reservas) o
 *    a elegir uno, que es peor: los demás nunca se barrerían y el equipo quedaría "Reservado" en
 *    la vidriera para siempre. El schema ya lo previó: `reservations_active_expiry_idx` es un
 *    índice parcial **sobre `expires_at` sin `tenant_id`**, y su comentario dice literalmente que
 *    el cron barre sin filtro de tenant.
 * 2. **Nada de lo que sale cruza un borde.** Se proyectan ids, un `status`, dos fechas, un
 *    contador de intentos y el `slug` —que ya es público en la URL de la vidriera— y ninguna sale
 *    de esta función: el retorno son ocho números. La segunda query (el censo de abandonadas) ni
 *    siquiera proyecta columnas: devuelve un `count(*)`. No hay `customer_label`, no hay `cost_usd`, no hay
 *    IMEI. Nadie de afuera elige un parámetro: la única entrada es `now`.
 * 3. **Cada escritura sí está acotada.** Los tres `update`/`insert` de abajo llevan
 *    `eq(tabla.tenantId, row.tenantId)` con el tenant que trajo **esa** fila. Un bug de la lectura
 *    no puede escribir en el tenant equivocado.
 *
 * El privilegio tampoco sobra: bajo `withTenantDb` las policies se evalúan contra un claim que no
 * existe y esto devolvería 0 filas siempre — o sea, no fallaría, simplemente no vencería nada
 * nunca. Es el **cuarto** uso declarado de `withServiceDb` (ver su docblock en `_lib/db/session.ts`).
 *
 * web-lint:sin-tenant el cron corre sin sesion y barre y censa las reservas vencidas de todos los tenants; cada escritura sí filtra por el tenant de su fila
 */
export async function expireDueReservations(now: Date = new Date()): Promise<ExpirySweep> {
  const due = await withServiceDb(async (tx) =>
    tx
      .select({
        reservationId: reservations.id,
        tenantId: reservations.tenantId,
        listingId: reservations.listingId,
        slug: tenants.slug,
        status: reservations.status,
        createdAt: reservations.createdAt,
        expiresAt: reservations.expiresAt,
        sweepAttempts: reservations.sweepAttempts,
      })
      .from(reservations)
      .innerJoin(tenants, eq(tenants.id, reservations.tenantId))
      .where(
        and(
          eq(reservations.status, 'active'),
          lte(reservations.expiresAt, now),
          lt(reservations.sweepAttempts, MAX_SWEEP_ATTEMPTS),
        ),
      )
      // Fallar manda al fondo de la cola. Sin esta primera clave, la fila rota es eternamente la
      // primera y las sanas que vienen atrás no se procesan nunca (ver «Head-of-line», arriba).
      .orderBy(asc(reservations.sweepAttempts), asc(reservations.expiresAt))
      .limit(EXPIRE_BATCH_SIZE),
  );

  let expired = 0;
  let released = 0;
  let skipped = 0;
  let failed = 0;
  let stuck = 0;
  let unrecorded = 0;

  for (const row of due) {
    /**
     * El dominio decide. Se le pasa la fila tal como está en la base —incluido el `status`, que
     * pudo cambiar entre el `select` y ahora— y él responde si hay algo que hacer. Este módulo no
     * vuelve a comparar fechas: hacerlo sería tener dos definiciones de "vencida", y la segunda es
     * la que se olvida de que el borde es cerrado (`now >= expires_at`).
     */
    const decision = expireReservation(
      {
        id: row.reservationId,
        tenantId: row.tenantId,
        listingId: row.listingId,
        status: row.status,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      },
      now,
    );

    /**
     * **El `'expired'` que estaba escrito acá era la misma regla derivada dos veces.** El dominio
     * ya dice las dos mitades: `expireReservation()` qué arista del listing produce esta reserva, y
     * `transitionEffects(..., 'expire')` con qué estado queda cerrada. Una constante suelta en el
     * cron es el mecanismo exacto del fallo de S6 — el panel cierra la misma arista como
     * `'cancelled'`, y con el mapeo escrito en cada call site nada obliga a que sigan de acuerdo.
     *
     * El `intent` es obligatorio y acá es `'expire'` porque **se venció sola**: nadie apretó nada.
     * Pasar `null` desde este archivo escribiría `'cancelled'` en silencio y `reservations`
     * contaría dos historias del mismo hecho.
     *
     * Los dos `null` son la misma frase —"el dominio dice que no hay nada que hacer"— y por eso
     * cuentan igual: uno es la reserva que no venció, el otro es una arista que no cierra ninguna
     * reserva. Ninguno escribe.
     */
    const transition = decision.changed ? decision.listingTransition : null;
    const closesAs =
      transition === null
        ? null
        : transitionEffects(transition.from, transition.to, 'expire').closesReservationAs;

    if (transition === null || closesAs === null) {
      skipped += 1;
      continue;
    }

    try {
      const outcome = await withServiceDb(async (tx) => {
        /**
         * `listings` PRIMERO. No es estilo: es el orden de locks del producto entero (D1, arriba).
         * El guard `status = 'reserved'` es el que hace que esto sea seguro sin haber leído la
         * reserva: si el equipo ya se vendió, se fue a service o alguien lo liberó, afecta 0 filas.
         */
        const back = await tx
          .update(listings)
          .set({ status: 'available', updatedAt: sql`now()` })
          .where(
            and(
              eq(listings.tenantId, row.tenantId),
              eq(listings.id, row.listingId),
              eq(listings.status, 'reserved'),
            ),
          )
          .returning({ id: listings.id });

        const closed = await tx
          .update(reservations)
          .set({ status: closesAs, closedAt: sql`now()`, updatedAt: sql`now()` })
          .where(
            and(
              eq(reservations.tenantId, row.tenantId),
              eq(reservations.id, row.reservationId),
              eq(reservations.status, 'active'),
            ),
          )
          .returning({ id: reservations.id });

        /**
         * El listing ya no estaba `reserved`. La reserva se cierra igual —está vencida, es verdad—
         * pero **no** se inventa una transición que no ocurrió: un `listing_events` con
         * `reserved → available` sobre algo que está `sold` es historia falsa, y la historia es lo
         * único que después explica un stock raro.
         *
         * El caso simétrico (el listing se movió pero la reserva ya no estaba `active`) cuenta como
         * `released` y no como `expired`, y el evento se escribe igual: la transición ocurrió de
         * verdad. Con el orden de locks unificado nadie cierra una reserva sin haber tomado antes el
         * lock de su listing, así que llegar ahí significa que la unidad estaba `reserved` sin
         * reserva activa — un estado inconsistente que esto repara, no que inventa.
         */
        if (back.length === 0) return { expired: closed.length > 0, released: false };

        await tx.insert(listingEvents).values({
          tenantId: row.tenantId,
          listingId: row.listingId,
          kind: 'status_change',
          fromStatus: 'reserved',
          toStatus: 'available',
          // `null` = no lo hizo una persona. La columna es nullable justamente para esto.
          actorUserId: null,
        });

        return { expired: closed.length > 0, released: true };
      });

      if (outcome.expired) expired += 1;
      if (outcome.released) {
        released += 1;
        /**
         * El equipo volvió a estar disponible **en la vidriera**, y hasta que el CDN se entere
         * sigue mostrándose "Reservado": escondido de la única página que lo vende. Va acá, por
         * unidad, y no una purga ancha al final del barrido.
         *
         * Nota de costo conocida: `storefront-cache.ts` intenta `updateTag()` primero, que fuera
         * de una Server Action tira `E872` y cae al fallback `revalidateTag(tag, { expire: 0 })`
         * dejando una línea `storefront.cache.update_tag_unavailable` por tag. En el cron eso pasa
         * **siempre**: son 3 líneas de log por unidad liberada. Es ruido acotado por
         * `EXPIRE_BATCH_SIZE` y el fallback es la API correcta; no se toca el helper para esto.
         */
        invalidateStorefrontUnit(row.slug, row.listingId);
      }
    } catch (error) {
      failed += 1;
      // El contador que trajo el `select`, o sea el estado ANTES de este intento: si ya venía en 1,
      // esta es al menos la segunda vez que la misma fila rompe y deja de ser una carrera perdida.
      if (row.sweepAttempts >= 1) stuck += 1;

      // El id de la reserva y el código SQLSTATE. Nunca el `Error`: su `DETAIL` trae la fila, y la
      // fila de una reserva lleva la etiqueta del cliente.
      logError('reservation.expire.failed', pgErrorCode(error), {
        reservationId: row.reservationId,
        tenantId: row.tenantId,
        listingId: row.listingId,
        sweepAttempts: row.sweepAttempts,
      });

      /**
       * El `+1`, en **su propia transacción**. Es lo único que hace que el techo exista de verdad.
       *
       * Adentro del `withServiceDb` que acaba de fallar, este `update` se rollea con el error: el
       * contador queda en 0, la fila vuelve a encabezar el `order by` y el archivo termina con un
       * techo escrito que nunca se alcanza — arreglado en el código y roto en la base, que es la
       * peor de las dos combinaciones porque se lee como resuelto.
       *
       * El guard `status = 'active'` está por lo mismo que en las otras dos escrituras: si la
       * reserva se cerró mientras tanto (el dueño ganó la carrera), no hay intento que anotar y el
       * `update` afecta 0 filas.
       *
       * Y va con su propio `try`: el barrido no puede caerse por no poder anotar que algo falló.
       * Cuando eso pasa se cuenta aparte, porque es el estado en el que el head-of-line vuelve.
       */
      try {
        await withServiceDb(async (tx) => {
          await tx
            .update(reservations)
            .set({
              sweepAttempts: sql`${reservations.sweepAttempts} + 1`,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(reservations.tenantId, row.tenantId),
                eq(reservations.id, row.reservationId),
                eq(reservations.status, 'active'),
              ),
            );
        });
      } catch (bumpError) {
        unrecorded += 1;
        logError('reservation.expire.attempt_unrecorded', pgErrorCode(bumpError), {
          reservationId: row.reservationId,
          tenantId: row.tenantId,
        });
      }
    }
  }

  /**
   * El censo de abandonadas, después del `for` a propósito: describe el estado en el que **queda**
   * la base al terminar esta corrida, incluidas las filas que cruzaron el techo recién.
   *
   * No lleva `catch`: si esta query tira, tira el barrido entero y el `route.ts` devuelve 500. Es
   * lo correcto — no poder contar las unidades trabadas no es un detalle que se reporte con un 200.
   */
  const abandonedRows = await withServiceDb(async (tx) =>
    tx
      .select({ total: sql<number>`count(*)::int` })
      .from(reservations)
      .where(
        and(
          eq(reservations.status, 'active'),
          lte(reservations.expiresAt, now),
          gte(reservations.sweepAttempts, MAX_SWEEP_ATTEMPTS),
        ),
      ),
  );
  const abandoned = abandonedRows[0]?.total ?? 0;

  const sweep: ExpirySweep = {
    scanned: due.length,
    expired,
    released,
    skipped,
    failed,
    stuck,
    unrecorded,
    abandoned,
  };

  // Una corrida vacía es el caso normal —el cron pega cada pocos minutos— y no merece una línea de
  // log. Loguear el silencio es cómo se vuelve invisible lo que sí pasó. `abandoned > 0` sí merece
  // línea aunque el lote haya venido vacío: es el único caso en el que "no hice nada" y "hay una
  // unidad trabada hace horas" se ven exactamente igual desde afuera.
  if (sweep.scanned > 0 || sweep.abandoned > 0) logEvent('reservation.expire.swept', { ...sweep });

  return sweep;
}
