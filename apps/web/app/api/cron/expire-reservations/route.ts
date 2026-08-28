import { createHash, timingSafeEqual } from 'node:crypto';
import { pgErrorCode } from '../../../(app)/_lib/db/pg-error';
import { cronSecret } from '../../../(app)/_lib/env';
import { logError, logEvent } from '../../../(app)/_lib/log';
import { expireDueReservations } from '../../../(app)/_lib/reservations/expire-reservations';

/**
 * `GET /api/cron/expire-reservations` — devuelve al stock los equipos cuya reserva venció.
 *
 * Lo dispara **Vercel Cron** con el schedule que vive en `vercel.json` (archivo del LEAD; esta
 * ruta sólo se expone). El trabajo de verdad es `expireDueReservations()`; acá sólo se decide
 * quién puede pedirlo.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Es la única puerta HTTP sin sesión que ESCRIBE. Todo lo demás sigue de eso.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `/api/health` es pública y no revela nada; `/api/tenants/slug-check` exige sesión. Esta no puede
 * exigir sesión —el cron no tiene una— así que la credencial **es** la autorización, y por eso el
 * chequeo se escribe con más cuidado que un `if`:
 *
 * 1. **Sin credencial no se toca Postgres.** No alcanza con devolver 401 al final: la comparación
 *    va antes de llamar al barrido. Un handler que primero trabaja y después decide el status es
 *    un endpoint de escritura abierto con una hoja de parra encima.
 * 2. **Sin `CRON_SECRET` en el entorno, falla CERRADO.** El bug clásico es el contrario: la env no
 *    está, la comparación termina siendo contra `undefined` y pasa cualquiera. En un preview
 *    deploy sin la variable seteada eso es un vaciador de reservas público. `cronSecret()`
 *    devuelve `null` para ausente **y para vacío** (`.env.example` trae `CRON_SECRET=""`), y `null`
 *    es 401.
 * 3. **La comparación es de tiempo constante.** `===` sobre strings corta en el primer byte
 *    distinto: el tiempo de respuesta filtra cuántos caracteres acertaste, y un secreto se extrae
 *    byte a byte con suficientes intentos. Se comparan los **hashes** y no los valores para que
 *    `timingSafeEqual` reciba siempre dos buffers de 32 bytes — pasarle largos distintos tira, y
 *    esa excepción sería, ella misma, un oráculo de longitud.
 * 4. **El 401 no explica nada.** Mismo cuerpo y mismo status para "no mandaste header", "mandaste
 *    uno equivocado" y "la ruta no está configurada". Distinguirlos ayuda a quien está probando,
 *    y quien está probando no somos nosotros: nosotros tenemos los logs.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué es dinámica sin `export const dynamic`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Con Cache Components prendido (`next.config.ts`), `dynamic`, `revalidate` y `fetchCache`
 * **fueron removidos** del Route Segment Config en Next 16
 * (`node_modules/next/dist/docs/.../route-segment-config`, historial de versiones `v16.0.0`).
 * Escribir `export const dynamic = 'force-dynamic'` sería cargo cult. Lo que hace dinámica a esta
 * ruta es que lee `request.headers`: sin eso no hay respuesta que cachear, y con eso no hay
 * ninguna que se pueda cachear. `cache-control: no-store` en las dos salidas lo dice también del
 * lado del CDN.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Costo
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Una invocación por schedule, sin worker 24/7 (`CLAUDE.md` §3). Una corrida sin nada que vencer
 * es **una** query indexada y ninguna escritura. El rate limit de esta ruta no se resuelve con un
 * contador en Postgres —eso sería pagar una escritura por cada intento de quien la esté golpeando,
 * o sea financiarle el ataque—: es la regla de `config/firewall-rules.json`, que es del LEAD.
 */

/** 401 idéntico para los tres motivos. Ver el punto 4 del encabezado. */
function unauthorized(): Response {
  return Response.json(
    { error: 'No autorizado.' },
    { status: 401, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * El token de un `Authorization: Bearer <token>`, o `null`.
 *
 * El esquema se exige (`Bearer`, sin distinguir mayúsculas, como manda RFC 7235) y el token no
 * puede tener espacios: un header vacío, un `Basic`, o el secreto pelado sin esquema no son
 * "casi" válidos, son `null`. Parsear de más acá es aceptar de más.
 */
function bearerToken(header: string | null): string | null {
  if (header === null) return null;
  const match = /^bearer\s+(\S+)$/iu.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Comparación de tiempo constante sobre el SHA-256 de cada lado.
 *
 * El hash no es para guardar nada: es para que los dos buffers midan siempre 32 bytes y
 * `timingSafeEqual` no tire por longitudes distintas (que además delataría el largo del secreto).
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/**
 * ¿Ya avisamos, en esta instancia, que la ruta está desplegada sin secreto?
 *
 * Sin este flag había **una línea de `logError` por request anónimo**, y ese es el peor lugar
 * posible para un log por request: la condición que lo dispara la controla enteramente quien está
 * afuera. Un escaneo de 10 mil GET contra `/api/cron/*` —que es tráfico que esta URL va a recibir
 * por el solo hecho de existir— escribe 10 mil líneas de error idénticas, sin un solo campo que las
 * distinga, y tapa en el drain lo único que realmente importaba: que el cron no está venciendo
 * nada. Un atacante que puede elegir cuánto le cuesta tu observabilidad ya ganó algo.
 *
 * Que sea **por instancia** y no global es exactamente la propiedad que se quiere. No es un cache
 * ni un contador —no hay nada que coordinar entre instancias, y un rate limit con estado no va
 * acá (`CLAUDE.md` §2)—: es un "esto ya lo dijimos". Cada instancia nueva de la función vuelve a
 * decirlo una vez, así que un deploy mal configurado sigue apareciendo en los logs cada vez que
 * Vercel levanta un contenedor, que es la frecuencia correcta para un problema de despliegue.
 * El peor caso es unas pocas líneas de más; el caso que se elimina es diez mil.
 */
let misconfiguredLogged = false;

export async function GET(request: Request): Promise<Response> {
  const secret = cronSecret();
  if (secret === null) {
    // La ruta está desplegada y no puede autenticar a nadie: el cron no vence nada y nadie se
    // entera hasta que un cliente pregunta por qué su equipo sigue reservado. Se loguea sin campos:
    // no hay nada que agregar que no sea el secreto que falta. Y por eso mismo se loguea **una vez
    // por instancia**: la segunda línea es idéntica a la primera y no agrega información, sólo la
    // diluye (ver `misconfiguredLogged`). El 401 sale igual, siempre.
    if (!misconfiguredLogged) {
      misconfiguredLogged = true;
      logError('cron.expire_reservations.misconfigured', 'no_secret', {});
    }
    return unauthorized();
  }

  const token = bearerToken(request.headers.get('authorization'));
  if (token === null || !secretMatches(token, secret)) {
    return unauthorized();
  }

  try {
    const sweep = await expireDueReservations();

    /**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     *  Cuándo una corrida que no explotó igual es un fracaso
     * ══════════════════════════════════════════════════════════════════════════════════════════
     *
     * Hasta S6 este handler devolvía 200 pase lo que pase con las filas: el `try/catch` está
     * adentro del `for` del barrido, así que una corrida en la que fallaron las 200 filas se veía
     * en Vercel Cron **exactamente igual** que una perfecta. Un cron verde mientras nada se vence
     * es la falla que se descubre semanas después y del lado del cliente.
     *
     * El predicado importa tanto como el 500. `failed > 0` a secas estaría mal: el dueño cancelando
     * desde el mostrador la misma reserva que el barrido está venciendo produce un deadlock —uno de
     * los dos muere, por diseño (D1)— y pintar el cron de rojo por eso enseña a ignorar el rojo,
     * que es cómo se llegó acá. Se mira, entonces, lo que **no** se explica por contención normal:
     *
     * - `stuck`: falló una fila que ya venía fallando. Dos veces seguidas no es una carrera.
     * - `unrecorded`: falló una fila y **tampoco** se le pudo anotar el intento. Es peor que
     *   `stuck` aunque suene menor: sin el `+1` la fila nunca llega a `stuck` ni al techo, así que
     *   el head-of-line vuelve entero y sin síntoma. Rojo desde la primera.
     * - `abandoned`: hay reservas vencidas que el barrido ya no toma (pasaron el techo). Cada una
     *   es una unidad trabada en `reserved` hasta que una persona la libere. Que el barrido haya
     *   dejado de intentarlo es la razón por la que esto tiene que gritar, no la razón por la que
     *   podría callarse.
     *
     * `abandoned` es además el único de los tres que sigue en rojo en las corridas siguientes, que
     * es lo que se quiere: no es un incidente que pasó, es un estado en el que está la base.
     */
    const degraded = sweep.stuck > 0 || sweep.unrecorded > 0 || sweep.abandoned > 0;

    if (degraded) {
      // Números, siempre. Ni un id de listing entero, ni la fila: `logError` no acepta objetos. Los
      // ids de las filas que rompieron ya salieron, uno por línea, desde el barrido.
      logError('cron.expire_reservations.degraded', 'sweep_not_draining', { ...sweep });

      return Response.json(
        { ok: false, ...sweep },
        { status: 500, headers: { 'cache-control': 'no-store' } },
      );
    }

    // Números, siempre. Ni un id de listing entero, ni la fila: `logEvent` no acepta objetos.
    logEvent('cron.expire_reservations.done', { ...sweep });

    return Response.json({ ok: true, ...sweep }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    /**
     * Un fallo del barrido entero (la base se cayó, timeout de conexión). Se devuelve **500** y no
     * un `{ ok: false }` con 200: Vercel Cron marca la ejecución como fallida por el status code, y
     * un cron que reporta éxito mientras no vence nada es la clase de falla que se descubre semanas
     * después, del lado del cliente.
     *
     * El `Error` no se loguea, sólo su SQLSTATE. La regla de siempre: el `DETAIL` de Postgres cita
     * la fila que rompió, y la fila de una reserva lleva la etiqueta del cliente.
     */
    logError('cron.expire_reservations.crashed', pgErrorCode(error), {});
    return Response.json(
      { ok: false },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
