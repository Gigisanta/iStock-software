/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La línea que `scripts/accept-s6.sh` (V8) no puede producir solo. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * V8 lo dice sin vueltas: *"S6 no se cierra con tests unitarios: el gate del board dice 'cron
 * libera; vidriera revalida', y eso es un ciclo, no una función"*. El script **lee** la línea y
 * falla si no está; medirla necesita un browser real, un visitante anónimo y la puerta HTTP del
 * cron, o sea el arnés.
 *
 * Este módulo existe separado del spec por los mismos dos motivos que `s3-measure.ts`:
 *
 * 1. **El formato es un contrato con un parser de `sed`.** Escrito una sola vez, cambia una sola
 *    vez.
 * 2. **El veredicto tiene que poder verse fallar sin levantar un browser.** El caso que este gate
 *    vino a atrapar —"Publicar" sobre una unidad reservada devolviendo `ok`— sólo se puede ver en
 *    rojo rompiendo a propósito `transitionUnit`, o sea editando el código bajo test, que es
 *    exactamente lo que `qa-agent` no hace (`CLAUDE.md` §4). Con la decisión acá adentro, la
 *    polaridad negativa se ejercita alimentando la función con la medición del bug (un intento
 *    aceptado, o rechazado pero con la fila ya pisada) y viendo que el veredicto sale no vacío.
 *
 * Los veredictos devuelven **lista de problemas** en vez de tirar: un rojo imprime *qué* está mal.
 *
 * ── Las etiquetas están escritas a mano, y es a propósito ────────────────────────────────────
 * `Disponible` y `Reservado` se duplican de `apps/web/app/(storefront)/_lib/status.ts` en vez de
 * importarse. Si el test leyera la constante que audita, cambiar la copy a "Libre" pondría el test
 * en verde igual y el guard dejaría de guardar. La divergencia entre las dos copias **es** la
 * señal: es el momento en que alguien decidió cambiarle el texto al visitante.
 */

/** Lo que la ficha pública tiene que decir cuando el equipo está libre. Ver el encabezado. */
export const BADGE_DISPONIBLE = 'Disponible';
/** Lo que la ficha pública tiene que decir cuando hay una seña puesta. */
export const BADGE_RESERVADO = 'Reservado';

/**
 * El intento de publicar **con la reserva viva**, medido en sus cuatro dimensiones. Las cuatro
 * hacen falta y ninguna implica a las otras:
 *
 * - `httpStatus`: prueba de vida. Sin una respuesta de la Server Action, "no pasó nada" y "el
 *   sistema rechazó" se ven idénticos desde afuera, y el segundo se reportaría como éxito.
 * - `alert`: lo que el dueño **lee** en la pantalla. Un rechazo mudo es un bug de producto.
 * - `listingStatusAfter` / `reservationStatusAfter`: lo que quedó **escrito**. Un rechazo que
 *   igual dejó basura escrita no es un rechazo.
 */
export interface PublishWhileReservedAttempt {
  /** Status HTTP de la respuesta a la invocación de la Server Action. `null` = no se observó. */
  readonly httpStatus: number | null;
  /** Texto del `role="alert"` tras el intento. `null` = la pantalla no dijo nada. */
  readonly alert: string | null;
  /** Estado del equipo en Postgres **después** del intento. */
  readonly listingStatusAfter: string;
  /** Estado de la reserva en Postgres después del intento. `null` = ya no hay reserva viva. */
  readonly reservationStatusAfter: string | null;
}

export interface ReservationCycleMeasurement {
  /** El equipo real que se reservó. */
  readonly listingId: string;
  /** Estado leído de Postgres inmediatamente después de reservar desde el panel. */
  readonly statusAfterReserve: string;
  /**
   * Lo que la ficha **cacheada** decía justo antes de reservar. No es decorativo: es el control
   * que hace honesto al campo siguiente. Si la vidriera nunca dijo `Disponible`, leer `Reservado`
   * después no prueba que la invalidación corrió — prueba que llegamos tarde a una página fría.
   */
  readonly storefrontSaidBefore: string;
  /** Lo que un visitante anónimo lee en el DOM renderizado, ya con la reserva puesta. */
  readonly storefrontSays: string;
  /** Estado del equipo en Postgres después de que el barrido corrió por su puerta HTTP. */
  readonly statusAfterSweep: string;
  /** Lo que la vidriera vuelve a decirle al visitante una vez liberado el equipo. */
  readonly storefrontSaysAfterSweep: string;
  readonly publish: PublishWhileReservedAttempt;
}

/**
 * El quinto campo, condensado en **un solo token** (sin ` · ` adentro) para no romper el formato
 * de cinco campos que el gate documenta.
 *
 * `rechazado` / `aceptado` sale de si la pantalla mostró un error, no de lo que esperábamos: una
 * línea que imprime la expectativa en vez del hecho es peor que no tener línea.
 */
export function publishVerdict(attempt: PublishWhileReservedAttempt): string {
  const verdict = attempt.alert === null ? 'aceptado' : 'rechazado';
  const http = attempt.httpStatus === null ? 'sin-respuesta' : String(attempt.httpStatus);
  const motive = attempt.alert === null ? 'sin-mensaje' : JSON.stringify(attempt.alert);
  const reservation = attempt.reservationStatusAfter ?? 'ninguna';
  return `${verdict}(http=${http}; motivo=${motive}; listing=${attempt.listingStatusAfter}; reserva=${reservation})`;
}

/**
 * La línea que lee V8. **El formato es del gate, no de este archivo.**
 *
 * ```
 * MEDIDO s6 reserva · unidad=<id> · estado_tras_reservar=<estado> · vidriera_dice=<texto> · tras_expirar=<estado> · publicar_estando_reservada=<resultado>
 * ```
 */
export function reservationCycleMedidoLine(m: ReservationCycleMeasurement): string {
  return (
    `MEDIDO s6 reserva · unidad=${m.listingId} · ` +
    `estado_tras_reservar=${m.statusAfterReserve} · ` +
    `vidriera_dice=${JSON.stringify(m.storefrontSays)} · ` +
    `tras_expirar=${m.statusAfterSweep} · ` +
    `publicar_estando_reservada=${publishVerdict(m.publish)}`
  );
}

/**
 * Todo lo que está mal con el ciclo, en castellano. Vacío = S6 cumple.
 *
 * Las reglas, y por qué cada una es distinta de las otras:
 *
 * - **`reserved` en la base.** Sin esto no se reservó nada y el resto de la línea habla de otro
 *   estado.
 * - **La vidriera tiene que haber dicho `Disponible` antes.** Es el control de la invalidación:
 *   ver `storefrontSaidBefore`.
 * - **La vidriera no puede decir `Disponible` con la seña puesta.** Es el daño real de S6: dos
 *   personas viajando al local por el mismo equipo.
 * - **`available` después del barrido.** Una reserva que vence y no libera el equipo lo deja
 *   muerto en la vidriera hasta que alguien lo toque a mano.
 * - **La vidriera vuelve a decir `Disponible`.** "cron libera" y "vidriera revalida" son dos
 *   afirmaciones: el cron puede liberar en Postgres y dejar la ficha cacheada mintiendo.
 * - **Publicar con la reserva viva se rechaza, Y el rechazo no escribe.** Las dos mitades, porque
 *   el bug original devolvía `ok` **y** republicaba: un rechazo que igual dejó basura escrita no
 *   es un rechazo.
 */
export function reservationCycleProblems(m: ReservationCycleMeasurement): readonly string[] {
  const problems: string[] = [];

  if (m.statusAfterReserve !== 'reserved') {
    problems.push(
      `estado_tras_reservar=${m.statusAfterReserve}: reservar desde el panel no dejó el equipo en ` +
        '`reserved`. Todo lo que sigue en la línea mide otra cosa.',
    );
  }

  if (m.storefrontSaidBefore !== BADGE_DISPONIBLE) {
    problems.push(
      `la ficha cacheada decía ${JSON.stringify(m.storefrontSaidBefore)} y no ` +
        `${JSON.stringify(BADGE_DISPONIBLE)} antes de reservar: sin ese control, leer ` +
        '"Reservado" después no prueba que la invalidación por unidad corrió.',
    );
  }

  if (m.storefrontSays !== BADGE_RESERVADO) {
    problems.push(
      `vidriera_dice=${JSON.stringify(m.storefrontSays)} con la reserva viva. Un equipo señado que ` +
        'sigue publicado como disponible manda dos personas al local por el mismo teléfono.',
    );
  }

  if (m.statusAfterSweep !== 'available') {
    problems.push(
      `tras_expirar=${m.statusAfterSweep}: el barrido corrió y el equipo no volvió a ` +
        '`available`. Una reserva vencida que no libera stock es stock que se pierde.',
    );
  }

  if (m.storefrontSaysAfterSweep !== BADGE_DISPONIBLE) {
    problems.push(
      `después del barrido la vidriera dice ${JSON.stringify(m.storefrontSaysAfterSweep)}: el cron ` +
        'liberó en Postgres pero la ficha cacheada le sigue mintiendo al visitante.',
    );
  }

  problems.push(...publishProblems(m.publish));

  return problems;
}

/** Las tres formas de fallar el quinto campo. Se exporta aparte para poder verlas en rojo solas. */
export function publishProblems(attempt: PublishWhileReservedAttempt): readonly string[] {
  const problems: string[] = [];

  if (attempt.httpStatus === null) {
    problems.push(
      'no se observó ninguna respuesta a la Server Action de publicar: el click no llegó al ' +
        'server. Sin prueba de vida, "no pasó nada" y "el sistema rechazó" se ven iguales, y el ' +
        'segundo se reportaría como éxito.',
    );
  }

  if (attempt.alert === null) {
    problems.push(
      'publicar con la reserva viva no mostró ningún error: el panel aceptó republicar un equipo ' +
        'con la seña puesta. Es el bug que V8 vino a atrapar (`activeReservation: null` ' +
        'hardcodeado en `transitionUnit`).',
    );
  }

  if (attempt.listingStatusAfter !== 'reserved') {
    problems.push(
      `tras el intento el equipo quedó en \`${attempt.listingStatusAfter}\` y no en \`reserved\`: ` +
        'el rechazo igual escribió. Un rechazo que deja basura escrita no es un rechazo.',
    );
  }

  if (attempt.reservationStatusAfter !== 'active') {
    problems.push(
      `tras el intento la reserva quedó en \`${attempt.reservationStatusAfter ?? 'ninguna'}\` y no ` +
        'en `active`: el intento fallido se llevó puesta la seña de alguien.',
    );
  }

  return problems;
}

// ── línea 2 · la puerta del barrido ───────────────────────────────────────────────────────────

/**
 * El cron es **la única puerta HTTP sin sesión que escribe** en el producto. Se mide como la
 * llama Vercel (`GET` + `Authorization: Bearer`) y se mide también sin secreto, porque un barrido
 * que funciona pero está abierto es peor que uno que no funciona: cualquiera puede vencerle las
 * reservas a cualquier tenant.
 */
export interface SweepMeasurement {
  readonly httpStatus: number;
  readonly httpStatusSinSecreto: number;
  readonly scanned: number;
  readonly expired: number;
  readonly released: number;
}

/**
 * ```
 * MEDIDO s6 barrido · http=<N> · sin_secreto=<N> · escaneadas=<N> · vencidas=<N> · liberadas=<N>
 * ```
 */
export function sweepMedidoLine(m: SweepMeasurement): string {
  return (
    `MEDIDO s6 barrido · http=${String(m.httpStatus)} · ` +
    `sin_secreto=${String(m.httpStatusSinSecreto)} · ` +
    `escaneadas=${String(m.scanned)} · vencidas=${String(m.expired)} · liberadas=${String(m.released)}`
  );
}

export function sweepProblems(m: SweepMeasurement): readonly string[] {
  const problems: string[] = [];

  if (m.httpStatus !== 200) {
    problems.push(`el barrido con el secreto correcto respondió ${String(m.httpStatus)} y no 200.`);
  }

  if (m.httpStatusSinSecreto !== 401) {
    problems.push(
      `sin \`Authorization\` la puerta del cron respondió ${String(m.httpStatusSinSecreto)} y no 401: ` +
        'es la única puerta sin sesión que escribe, y estaría abierta para cualquiera.',
    );
  }

  if (m.expired < 1 || m.released < 1) {
    problems.push(
      `vencidas=${String(m.expired)} liberadas=${String(m.released)}: había una reserva vencida y el ` +
        'barrido no la tocó. Un barrido que no barre nada da 0 y "pasa".',
    );
  }

  return problems;
}
