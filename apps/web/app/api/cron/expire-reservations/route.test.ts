import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `GET /api/cron/expire-reservations` — la única puerta HTTP sin sesión que escribe en la base.
 *
 * Por eso el test empieza por lo que NO tiene que pasar. Tres afirmaciones, en orden de qué tan
 * caro sale equivocarse:
 *
 * 1. **Sin `Authorization` no se toca Postgres.** No es sólo 401: el barrido ni se llama. Un
 *    handler que primero trabaja y después decide el status code es un endpoint de escritura
 *    abierto con una hoja de parra encima.
 * 2. **Sin `CRON_SECRET` en el entorno, falla CERRADO.** El bug clásico es el contrario: env
 *    ausente → comparación contra `undefined` → cualquiera pasa. En un preview deploy sin la env
 *    seteada eso es exactamente un vaciador de reservas público.
 * 3. **La comparación es de tiempo constante.** `===` sobre strings corta en el primer byte
 *    distinto y filtra el secreto byte a byte. Acá se prueba lo observable —que un prefijo válido
 *    no valga más que basura— y el que la comparación sea `timingSafeEqual` se lee en el módulo.
 * 4. **El log de "sin secreto" sale una vez por instancia, no una por request** (D4). La condición
 *    que lo dispara la controla quien está afuera: un escaneo contra `/api/cron/*` no puede elegir
 *    cuántas líneas escribimos. El 401, en cambio, sale siempre.
 *
 * Y después, lo que sí tiene que pasar y hasta S6 no pasaba: **un barrido que no drena tiene que
 * devolver 500**. El `try/catch` del barrido es por fila, así que una corrida en la que ninguna
 * unidad se liberó se veía en Vercel Cron igual que una perfecta. El último `describe` fija el
 * predicado, que es la mitad delicada: `failed > 0` a secas pintaría el cron de rojo con una sola
 * carrera perdida contra el dueño cancelando desde el panel, y un rojo que aparece por contención
 * normal se aprende a ignorar — que es exactamente cómo se llegó a tener el bug.
 */

const expireDueReservations = vi.fn();
vi.mock('../../../(app)/_lib/reservations/expire-reservations', () => ({
  expireDueReservations: (now?: Date) => expireDueReservations(now),
}));

const cronSecret = vi.fn();
vi.mock('../../../(app)/_lib/env', () => ({
  cronSecret: () => cronSecret(),
}));

const logEvent = vi.fn();
const logError = vi.fn();
vi.mock('../../../(app)/_lib/log', () => ({
  logEvent: (event: string, fields: unknown) => {
    logEvent(event, fields);
  },
  logError: (event: string, code: string, fields: unknown) => {
    logError(event, code, fields);
  },
}));

const { GET } = await import('./route');

const SECRET = 'cron-secret-de-verdad-largo';
const EMPTY_SWEEP = {
  scanned: 0,
  expired: 0,
  released: 0,
  skipped: 0,
  failed: 0,
  stuck: 0,
  unrecorded: 0,
  abandoned: 0,
};

const request = (headers: Record<string, string> = {}): Request =>
  new Request('https://maat.work/api/cron/expire-reservations', { headers });

const call = (headers: Record<string, string> = {}): Promise<Response> => GET(request(headers));

/**
 * El handler con una instancia **nueva** del módulo, o sea con `misconfiguredLogged` en `false`.
 *
 * `vi.clearAllMocks()` limpia los spies pero no el estado de módulo, que es justamente lo que D4
 * introdujo: sin esto, el primer test que pega el camino "sin secreto" se lleva el único log del
 * archivo y el resto mide contra un flag ya prendido. Los `vi.mock` siguen registrados después del
 * `resetModules()`, así que la instancia nueva usa los mismos spies.
 */
async function freshRoute(): Promise<(req: Request) => Promise<Response>> {
  vi.resetModules();
  const mod = await import('./route');
  return mod.GET;
}

beforeEach(() => {
  vi.clearAllMocks();
  cronSecret.mockReturnValue(SECRET);
  expireDueReservations.mockResolvedValue({ ...EMPTY_SWEEP, scanned: 3, expired: 2, released: 2 });
});

describe('GET /api/cron/expire-reservations · sin credencial no hace nada', () => {
  it('sin header Authorization responde 401 y NO barre', async () => {
    const response = await call();

    expect(response.status).toBe(401);
    expect(expireDueReservations).not.toHaveBeenCalled();
  });

  it('con un secreto equivocado responde 401 y NO barre', async () => {
    const response = await call({ authorization: `Bearer ${SECRET}-mal` });

    expect(response.status).toBe(401);
    expect(expireDueReservations).not.toHaveBeenCalled();
  });

  it('un prefijo válido del secreto no vale más que basura', async () => {
    const prefix = await call({ authorization: `Bearer ${SECRET.slice(0, -1)}` });
    const garbage = await call({ authorization: 'Bearer zzzz' });

    expect(prefix.status).toBe(401);
    expect(garbage.status).toBe(401);
    expect(expireDueReservations).not.toHaveBeenCalled();
  });

  it('el esquema tiene que ser Bearer: el secreto pelado no alcanza', async () => {
    expect((await call({ authorization: SECRET })).status).toBe(401);
    expect((await call({ authorization: `Basic ${SECRET}` })).status).toBe(401);
    expect(expireDueReservations).not.toHaveBeenCalled();
  });

  it('la respuesta 401 no dice si el problema fue el header o el entorno', async () => {
    const response = await call();
    const body: unknown = await response.json();

    expect(body).toEqual({ error: 'No autorizado.' });
  });

  it('el 401 no se cachea en ningún lado', async () => {
    const response = await call();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('GET /api/cron/expire-reservations · falla cerrado', () => {
  it('sin CRON_SECRET en el entorno responde 401 aunque el header venga bien formado', async () => {
    cronSecret.mockReturnValue(null);

    const response = await call({ authorization: `Bearer ${SECRET}` });

    expect(response.status).toBe(401);
    expect(expireDueReservations).not.toHaveBeenCalled();
  });

  it('un Bearer vacío no pasa, aunque el secreto esté configurado', async () => {
    expect((await call({ authorization: 'Bearer ' })).status).toBe(401);
    expect((await call({ authorization: 'Bearer' })).status).toBe(401);
    expect(expireDueReservations).not.toHaveBeenCalled();
  });

  it('deja rastro de la config faltante, sin el secreto adentro', async () => {
    const get = await freshRoute();
    cronSecret.mockReturnValue(null);

    await get(request({ authorization: `Bearer ${SECRET}` }));

    expect(logError).toHaveBeenCalledWith('cron.expire_reservations.misconfigured', 'no_secret', {});
  });

  /**
   * D4. La línea es idéntica en todos los requests —no lleva un solo campo que los distinga—, así
   * que la número diez mil no agrega información: diluye la única que importaba. Y el 401 sigue
   * saliendo en todas: lo que se acota es el log, nunca la puerta.
   */
  it('avisa UNA sola vez por instancia, por más requests anónimos que lleguen', async () => {
    const get = await freshRoute();
    cronSecret.mockReturnValue(null);

    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await get(request())).status);
    }

    expect(statuses).toEqual([401, 401, 401, 401, 401]);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('una instancia nueva vuelve a avisar: un deploy mal configurado no se silencia para siempre', async () => {
    const first = await freshRoute();
    cronSecret.mockReturnValue(null);
    await first(request());
    await first(request());

    const second = await freshRoute();
    await second(request());

    expect(logError).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/cron/expire-reservations · con la credencial correcta', () => {
  it('barre y devuelve el conteo', async () => {
    const response = await call({ authorization: `Bearer ${SECRET}` });

    expect(response.status).toBe(200);
    expect(expireDueReservations).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      scanned: 3,
      expired: 2,
      released: 2,
      skipped: 0,
      failed: 0,
      stuck: 0,
      unrecorded: 0,
      abandoned: 0,
    });
  });

  it('acepta el header con el nombre en mayúsculas: los headers HTTP no distinguen caso', async () => {
    const response = await call({ Authorization: `Bearer ${SECRET}` });
    expect(response.status).toBe(200);
  });

  it('loguea el resultado con números, nunca con filas', async () => {
    await call({ authorization: `Bearer ${SECRET}` });

    expect(logEvent).toHaveBeenCalledWith(
      'cron.expire_reservations.done',
      expect.objectContaining({ scanned: 3, expired: 2, released: 2, failed: 0 }),
    );
  });

  it('no se cachea: es una escritura', async () => {
    const response = await call({ authorization: `Bearer ${SECRET}` });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('si el barrido explota devuelve 500 y no se traga el error en silencio', async () => {
    expireDueReservations.mockRejectedValue(
      Object.assign(new Error('connection terminated'), { code: '08006' }),
    );

    const response = await call({ authorization: `Bearer ${SECRET}` });

    expect(response.status).toBe(500);
    expect(logError).toHaveBeenCalledWith('cron.expire_reservations.crashed', '08006', {});
  });
});

describe('GET /api/cron/expire-reservations · un barrido que no drena no es un éxito', () => {
  const authed = (): Promise<Response> => call({ authorization: `Bearer ${SECRET}` });

  it('una fila que falló por primera vez NO pinta el cron de rojo', async () => {
    // El dueño cancelando desde el mostrador la misma reserva que el barrido está venciendo: uno de
    // los dos muere por diseño (D1). Es contención normal y el cron sigue verde.
    expireDueReservations.mockResolvedValue({
      ...EMPTY_SWEEP,
      scanned: 4,
      expired: 3,
      released: 3,
      failed: 1,
    });

    const response = await authed();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, failed: 1 });
  });

  it('una fila que falló teniendo ya intentos anotados devuelve 500', async () => {
    expireDueReservations.mockResolvedValue({ ...EMPTY_SWEEP, scanned: 2, failed: 1, stuck: 1 });

    const response = await authed();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ ok: false, stuck: 1 });
  });

  it('no poder anotar el intento es rojo desde la primera vez', async () => {
    // Sin el `+1`, la fila vuelve a encabezar el `order by` en la próxima corrida y nunca llega a
    // `stuck` ni al techo: el head-of-line vuelve entero y sin síntoma. Esperar a la segunda sería
    // esperar para siempre.
    expireDueReservations.mockResolvedValue({
      ...EMPTY_SWEEP,
      scanned: 1,
      failed: 1,
      unrecorded: 1,
    });

    expect((await authed()).status).toBe(500);
  });

  it('una reserva abandonada mantiene el rojo aunque el lote venga vacío', async () => {
    // El caso que ninguna otra métrica ve: `scanned: 0` porque el techo las sacó del `where`, y sin
    // embargo hay una unidad trabada en `reserved` esperando que una persona la libere.
    expireDueReservations.mockResolvedValue({ ...EMPTY_SWEEP, abandoned: 1 });

    const response = await authed();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ ok: false, abandoned: 1 });
  });

  it('el 500 degradado loguea números, no filas, y no dice "done"', async () => {
    expireDueReservations.mockResolvedValue({ ...EMPTY_SWEEP, scanned: 1, failed: 1, stuck: 1 });

    await authed();

    expect(logError).toHaveBeenCalledWith(
      'cron.expire_reservations.degraded',
      'sweep_not_draining',
      expect.objectContaining({ stuck: 1, failed: 1 }),
    );
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('el 500 degradado tampoco se cachea', async () => {
    expireDueReservations.mockResolvedValue({ ...EMPTY_SWEEP, abandoned: 2 });

    const response = await authed();

    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
