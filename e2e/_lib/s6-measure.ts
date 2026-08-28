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

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  S6 · el RADIO de la invalidación por unidad, medido en PÁGINAS. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Por qué esto no se puede afirmar con los tests de tags que ya existen
 * Los tests unitarios de `storefront-cache.ts` afirman **qué strings se emiten**, y los de
 * `listings.ts` afirman **qué strings se registran**. Las dos mitades pueden estar verdes y el
 * catálogo entero purgarse igual, porque lo que decide qué página muere es la **intersección** de
 * las dos listas, y esa intersección no vive en ningún archivo: vive en el cache de Next, que
 * además tiene entradas en **dos niveles** (la ruta y cada `'use cache'` de adentro). Una página
 * puede sobrevivir en el nivel de adentro y morir en el de afuera; el resultado es una función
 * invocada, un HTML re-renderizado y una escritura de ISR — o sea el costo — con cero queries.
 *
 * Por eso la afirmación que queda parada acá es sobre **páginas**, no sobre tags.
 *
 * ## Cómo se detecta un re-render (la decisión delicada de esta medición)
 * Se pide cada página **una sola vez** después de la mutación y se mira `x-nextjs-cache`:
 *
 * - `HIT`  → la entrada de ruta sobrevivió: nadie invocó la función. La página no se re-renderizó.
 * - lo que sea (`MISS`, `STALE`, ausente) → la entrada murió y esta request la volvió a generar.
 *
 * Una sola request y no más, porque la segunda ya vuelve a decir `HIT` y borraría la evidencia.
 *
 * El contador de sentencias del espía de Postgres (`_lib/pg-spy.ts`) va **al lado, no en lugar**:
 * `statements > 0` prueba que además se pagó una query. No alcanza solo —el caso "re-render sin
 * query" es real y es justo el que produce el arreglo a medias— pero es el que distingue "murió la
 * ruta" de "murió también el loader", que es la diferencia entre un arreglo parcial y uno completo.
 *
 * Lo que **no** sirve, dicho para que nadie lo intente de nuevo: comparar el HTML. Un re-render
 * produce exactamente el mismo HTML, así que una aserción de igualdad de body no puede fallar.
 */
export type PageRole = 'grilla' | 'ficha-reservada' | 'ficha-hermana';

/**
 * Una página de la vidriera, observada **antes y después** de la reserva.
 *
 * `cacheBefore` es el control y no es decorativo: una página que nunca llegó a `HIT` no puede
 * "sobrevivir" a nada, y contarla como sobreviviente daría verde con la invalidación borrada.
 */
export interface PageVisit {
  /** Nombre corto para la línea MEDIDO (`grilla`, `ficha-b`, `ficha-a`). Sin ` · ` adentro. */
  readonly label: string;
  readonly role: PageRole;
  readonly url: string;
  /** `x-nextjs-cache` de la página ya calentada, antes de tocar nada. Tiene que ser `HIT`. */
  readonly cacheBefore: string;
  /** `x-nextjs-cache` de **la única** request posterior a la reserva. */
  readonly cacheAfter: string;
  /** Sentencias que el server le mandó a Postgres durante esa única request. */
  readonly statementsAfter: number;
  /** Lo que la página decía del equipo antes de la reserva (badge). */
  readonly saidBefore: string;
  /** Lo que dice después. Para la grilla es el badge de la card del equipo reservado. */
  readonly saysAfter: string;
}

/**
 * ¿Esta página se volvió a generar? La ruta cacheada es la señal primaria; la query es la
 * corroboración. Cualquiera de las dos alcanza: las dos cuestan plata y ninguna implica a la otra.
 */
export function pageWasRerendered(visit: PageVisit): boolean {
  return visit.cacheAfter !== 'HIT' || visit.statementsAfter > 0;
}

/** Qué señal se prendió, para que un rojo diga *cómo* se supo. Vacío = la página sobrevivió. */
export function rerenderSignal(visit: PageVisit): string {
  const signals: string[] = [];
  if (visit.cacheAfter !== 'HIT') signals.push(`cache=${visit.cacheAfter}`);
  if (visit.statementsAfter > 0) signals.push(`db=${String(visit.statementsAfter)}`);
  return signals.join('+');
}

export interface InvalidationRadiusMeasurement {
  /** El equipo que se reservó desde el panel. */
  readonly reservedListingId: string;
  /** Cuántas unidades publicadas tiene la vidriera. Es el `N` del que el radio no puede depender. */
  readonly publishedUnits: number;
  /**
   * Sentencias de la primerísima request, con todo frío. Es el control de que el espía está en el
   * camino: si acá sale 0, el contador no está midiendo nada y los ceros de abajo no significan
   * "sobrevivió", significan "no vi".
   */
  readonly coldStatements: number;
  readonly visits: readonly PageVisit[];
}

/**
 * El radio que este producto puede pagar: la grilla (cambia: aparece el badge) y la ficha del
 * equipo señado. Dos. Nada más cambió, así que nada más puede morir.
 */
export const EXPECTED_RADIUS = 2;

/** Cuántas páginas se volvió a generar el server por una reserva. */
export function invalidationRadius(m: InvalidationRadiusMeasurement): number {
  return m.visits.filter(pageWasRerendered).length;
}

function labelsOf(visits: readonly PageVisit[]): string {
  return visits.length === 0 ? '(ninguna)' : visits.map((v) => v.label).join(',');
}

/**
 * La línea que el gate lee de la salida de la corrida.
 *
 * ```
 * MEDIDO s6 radio · unidad=<id> · publicadas=<N> · paginas=<M> · rerender=<K> · esperado=2 · purgadas=[…] · sobrevivieron=[…] · grilla_dice=<texto> · ficha_dice=<texto> · frio=<N>
 * ```
 *
 * Ningún valor lleva ` · ` adentro: el parser de `scripts/accept-s*.sh` corta por ahí.
 */
export function invalidationRadiusMedidoLine(m: InvalidationRadiusMeasurement): string {
  const purgadas = m.visits.filter(pageWasRerendered);
  const vivas = m.visits.filter((v) => !pageWasRerendered(v));
  const grilla = m.visits.find((v) => v.role === 'grilla');
  const ficha = m.visits.find((v) => v.role === 'ficha-reservada');
  const detalle = purgadas.map((v) => `${v.label}(${rerenderSignal(v)})`).join(',');

  return (
    `MEDIDO s6 radio · unidad=${m.reservedListingId} · ` +
    `publicadas=${String(m.publishedUnits)} · ` +
    `paginas=${String(m.visits.length)} · ` +
    `rerender=${String(invalidationRadius(m))} · ` +
    `esperado=${String(EXPECTED_RADIUS)} · ` +
    `purgadas=[${detalle.length === 0 ? '(ninguna)' : detalle}] · ` +
    `sobrevivieron=[${labelsOf(vivas)}] · ` +
    `grilla_dice=${JSON.stringify(grilla?.saysAfter ?? '(no se midió)')} · ` +
    `ficha_dice=${JSON.stringify(ficha?.saysAfter ?? '(no se midió)')} · ` +
    `frio=${String(m.coldStatements)}`
  );
}

/**
 * Todo lo que está mal con el radio. Vacío = una reserva cuesta dos páginas y no el catálogo.
 *
 * Las reglas, y por qué ninguna sobra:
 *
 * - **El espía tiene que haber visto la request fría.** Sin eso los ceros no son evidencia.
 * - **Toda página medida tenía que estar en `HIT` antes.** Es el control: una página fría no
 *   sobrevive, aparece.
 * - **Tiene que haber al menos dos fichas hermanas.** Con una sola, "el radio no crece con N" es
 *   una frase sobre un solo dato.
 * - **La grilla SÍ se tiene que haber purgado, y tiene que decir `Reservado`.** Sin esta mitad, el
 *   veredicto entero lo aprobaría un arreglo que rompió la invalidación: no purgar nada da radio
 *   0 y "mejora" el número mientras la vidriera le miente al visitante.
 * - **La ficha del equipo señado también.** Es la que abre el que tiene el link pegado en el estado.
 * - **Ninguna hermana.** Es la regla que este archivo vino a poner de pie.
 * - **A ninguna hermana le cambió lo que dice.** Una ficha ajena que se re-renderizó y además
 *   cambió de contenido es un bug peor que el costo.
 */
export function invalidationRadiusProblems(m: InvalidationRadiusMeasurement): readonly string[] {
  const problems: string[] = [];

  if (m.coldStatements <= 0) {
    problems.push(
      'el espía de Postgres no vio ni una sentencia en la request fría: el contador no está en el ' +
        'camino, así que los ceros de después no prueban que nadie consultó la base.',
    );
  }

  const frias = m.visits.filter((v) => v.cacheBefore !== 'HIT');
  if (frias.length > 0) {
    problems.push(
      `estas páginas nunca se sirvieron desde el cache antes de la reserva: ${labelsOf(frias)}. ` +
        'Una página fría no puede sobrevivir a una purga, así que medirla no dice nada del radio.',
    );
  }

  const hermanas = m.visits.filter((v) => v.role === 'ficha-hermana');
  if (hermanas.length < 2) {
    problems.push(
      `el fixture tiene ${String(hermanas.length)} ficha(s) hermana(s): con menos de dos, "el radio ` +
        'no crece con el tamaño del stock" es una afirmación sobre un solo dato.',
    );
  }

  const grilla = m.visits.find((v) => v.role === 'grilla');
  if (grilla === undefined) {
    problems.push('no se midió la grilla: la mitad "sí se invalida" del veredicto no existe.');
  } else {
    if (!pageWasRerendered(grilla)) {
      problems.push(
        'la grilla sobrevivió a la reserva: la card del equipo señado sigue saliendo del cache ' +
          'diciendo lo de antes. Un radio chico que se consigue no invalidando nada es la ' +
          'regresión, no el arreglo.',
      );
    }
    if (grilla.saysAfter !== BADGE_RESERVADO) {
      problems.push(
        `la card del equipo señado en la grilla dice ${JSON.stringify(grilla.saysAfter)} y no ` +
          `${JSON.stringify(BADGE_RESERVADO)}: dos personas viajan al local por el mismo teléfono.`,
      );
    }
  }

  const ficha = m.visits.find((v) => v.role === 'ficha-reservada');
  if (ficha === undefined) {
    problems.push('no se midió la ficha del equipo reservado.');
  } else {
    if (!pageWasRerendered(ficha)) {
      problems.push(
        'la ficha del equipo señado sobrevivió a la reserva: el link que circula por WhatsApp la ' +
          'sigue mostrando como estaba.',
      );
    }
    if (ficha.saysAfter !== BADGE_RESERVADO) {
      problems.push(
        `la ficha del equipo señado dice ${JSON.stringify(ficha.saysAfter)} con la seña puesta.`,
      );
    }
  }

  const purgadasDeMas = hermanas.filter(pageWasRerendered);
  if (purgadasDeMas.length > 0) {
    const detalle = purgadasDeMas.map((v) => `${v.label} (${rerenderSignal(v)})`).join(', ');
    problems.push(
      `señar UN equipo tiró abajo la ficha cacheada de ${String(purgadasDeMas.length)} equipo(s) que ` +
        `no cambiaron: ${detalle}. En un negocio de ${String(m.publishedUnits)} publicados esto es ` +
        'todo el catálogo re-renderizándose por cada reserva del día, que es el cold-hit rate del ' +
        'que se queja `cost-auditor`. El tag que las alcanza es el que sobra en la intersección: ' +
        'mirá qué registra la RUTA de la ficha, no sólo qué registra el loader.',
    );
  }

  const contaminadas = hermanas.filter((v) => v.saysAfter !== v.saidBefore);
  if (contaminadas.length > 0) {
    problems.push(
      `reservar un equipo le cambió lo que dice la ficha de otro: ${labelsOf(contaminadas)}.`,
    );
  }

  const radio = invalidationRadius(m);
  if (radio !== EXPECTED_RADIUS) {
    problems.push(
      `el radio de la purga por unidad es ${String(radio)} página(s) sobre ${String(m.visits.length)} ` +
        `medidas y tiene que ser ${String(EXPECTED_RADIUS)} (la grilla y la ficha del equipo).`,
    );
  }

  return problems;
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La otra punta: publicar un borrador tiene que matar el miss cacheado de SU ficha.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Es la mitad que se pierde si alguien "arregla" el radio sacándole `storefront:{slug}` a la ficha
 * **entera**. La ficha registra el tag de la unidad **después** del `await` y sólo cuando la unidad
 * existe y es pública: en el camino de MISS no hay `listing:{uuid}` que emitir, así que el único
 * tag que puede alcanzar esa entrada es el del tenant. Sacarlo dejaría la página de "este equipo ya
 * no está publicado" servida hasta que venza el perfil corto — el dueño publica, pega el link, y
 * durante minutos el link dice que el equipo no está.
 *
 * Un test que sólo mirara el radio aprobaría ese arreglo. Por eso esta medición existe.
 */
export interface DraftPublishMeasurement {
  readonly listingId: string;
  /** La ficha del borrador se estaba sirviendo **desde el cache** como "no publicado". */
  readonly cacheBefore: string;
  /** Y era el miss del equipo, no otra página. */
  readonly missWasCached: boolean;
  /** Estado en Postgres después de apretar "Publicar". */
  readonly statusAfterPublish: string;
  /** Qué se vio en cada visita posterior, en orden: `miss` · `ficha` · `otro(...)`. */
  readonly sequence: readonly string[];
}

/** En qué visita apareció la ficha publicada. `0` = nunca apareció. */
export function visitsUntilPublished(m: DraftPublishMeasurement): number {
  const index = m.sequence.indexOf('ficha');
  return index === -1 ? 0 : index + 1;
}

/**
 * ```
 * MEDIDO s6 alta-de-unidad · unidad=<id> · miss_cacheado=<HIT> · estado=<available> · visita_que_la_muestra=<n> · secuencia=[miss,ficha]
 * ```
 */
export function draftPublishMedidoLine(m: DraftPublishMeasurement): string {
  return (
    `MEDIDO s6 alta-de-unidad · unidad=${m.listingId} · ` +
    `miss_cacheado=${m.missWasCached ? m.cacheBefore : `no(${m.cacheBefore})`} · ` +
    `estado=${m.statusAfterPublish} · ` +
    `visita_que_la_muestra=${String(visitsUntilPublished(m))} · ` +
    `secuencia=[${m.sequence.length === 0 ? '(ninguna)' : m.sequence.join(',')}]`
  );
}

export function draftPublishProblems(m: DraftPublishMeasurement): readonly string[] {
  const problems: string[] = [];

  if (!m.missWasCached || m.cacheBefore !== 'HIT') {
    problems.push(
      `la ficha del borrador no se estaba sirviendo desde el cache como "no publicado" ` +
        `(cache=${m.cacheBefore}, miss=${String(m.missWasCached)}): sin esa entrada cacheada, verla ` +
        'publicada después no prueba que publicar la haya invalidado.',
    );
  }

  if (m.statusAfterPublish !== 'available') {
    problems.push(
      `el equipo quedó en \`${m.statusAfterPublish}\` y no en \`available\`: no se publicó nada, así ` +
        'que la invalidación no tenía por qué correr y esta medición no dice nada.',
    );
  }

  const visita = visitsUntilPublished(m);
  if (visita === 0) {
    problems.push(
      'publicar el equipo no tiró abajo el miss cacheado de su ficha: el dueño publica, pega el ' +
        'link en un estado, y el link sigue diciendo que el equipo no está publicado hasta que ' +
        'venza el perfil corto. Es el mismo bug que S1 atrapa para el tenant, un nivel más abajo.',
    );
  } else if (visita > 1) {
    problems.push(
      `la ficha recién apareció en la visita ${String(visita)} (secuencia: ${m.sequence.join(', ')}): ` +
        'el primero que abre el link se come la página vieja.',
    );
  }

  return problems;
}
