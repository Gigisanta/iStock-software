/**
 * PROBE DEL LEAD PARA S6 — el 401 va ANTES del barrido, y eso se mide invocando, no leyendo.
 *
 * `GET /api/cron/expire-reservations` es la única puerta HTTP sin sesión que ESCRIBE en todo el
 * producto. Su propiedad de seguridad no es "devuelve 401 cuando corresponde": es **"sin credencial
 * válida no toca Postgres"**, que es una afirmación sobre el ORDEN de dos cosas, no sobre el status
 * code. Un handler que barre primero y decide el status después devuelve exactamente los mismos 401
 * y es un endpoint de escritura abierto.
 *
 * Por eso acá no se lee el archivo ni se compara un status: se **espía la función del barrido** y se
 * exige que no haya sido llamada. Es la única forma de que la aserción hable del orden.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué esto no delega en `route.test.ts`, que ya existe y prueba cosas parecidas
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` §4: la auditoría de referencia —la afirmación que un gate cita y que queda parada
 * entre un handler aflojado y un merge— **no puede ser del writer del código auditado**.
 * `route.test.ts` es de `app-agent`, igual que el handler: sirve como red de regresión propia, y
 * está bien que exista, pero si `accept-s6.sh` lo citara como evidencia, `app-agent` estaría
 * firmando su propio certificado. Esta probe es de otra columna y por eso puede ser citada.
 *
 * El caso 2 es el que justifica el archivo entero. El bug clásico de un cron autenticado no es
 * "comparé mal": es que la env **no está** —un preview, un deploy nuevo, un `.env` incompleto—, la
 * comparación termina siendo contra `undefined` y **pasa cualquiera**. En esa forma, el endpoint
 * que vacía reservas queda público y el síntoma es cero: responde 200, hace el trabajo, no loguea
 * nada raro. Se falla cerrado o no se falla.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `server-only` tira apenas se importa fuera de un bundle de Next, y `_lib/env.ts` y `_lib/log.ts`
 * lo importan. Se neutraliza SOLO eso: `env` y `log` cargan REALES a propósito. El test del handler
 * (`route.test.ts`, de `app-agent`) los mockea enteros, y por eso no ejerce `cronSecret()` — que es
 * justo donde vive la mitad del fail-closed: `''` tiene que valer lo mismo que ausente.
 */
vi.mock('server-only', () => ({}));

const barrido = vi.fn(async () => ({ revisadas: 0, expiradas: 0, tenants: 0 }));

vi.mock('../../apps/web/app/(app)/_lib/reservations/expire-reservations', () => ({
  EXPIRE_BATCH_SIZE: 200,
  expireDueReservations: barrido,
}));

/** El secreto de la corrida. Largo y de alta entropía a propósito: el handler compara hashes. */
const SECRETO = 'probe-s6-4f8a1c7e9b2d6053aa71c4e8f0b39d2c';

/**
 * `vi.resetModules()` en CADA invocación, no una vez por test: `serverEnv()` **memoiza**, así que
 * un cambio de `process.env` posterior al primer import no tiene ningún efecto. Sin esto, el caso
 * de abajo que borra `CRON_SECRET` a mitad de camino devolvía **200** y el test pasaba comparando
 * un cuerpo de éxito contra dos 401 — verde por medir otra cosa. Lo encontré escribiéndolo.
 * (En producción la env no cambia en runtime, así que la memoización está bien; el que tiene que
 * ajustarse a ella es el gate.)
 */
async function invocar(headers: Record<string, string>): Promise<Response> {
  vi.resetModules();
  const { GET } = await import('../../apps/web/app/api/cron/expire-reservations/route');
  return GET(new Request('https://istock-software.vercel.app/api/cron/expire-reservations', { headers }));
}

describe('S6 · el cron falla cerrado y no toca Postgres sin credencial', () => {
  beforeEach(() => {
    barrido.mockClear();
    vi.resetModules();
    process.env.CRON_SECRET = SECRETO;
  });

  it('sin header Authorization: 401 y el barrido NO se llama', async () => {
    const res = await invocar({});

    expect(res.status).toBe(401);
    expect(
      barrido,
      'el handler llamó al barrido sin credencial. El status code no es la propiedad: el orden lo ' +
        'es. Un endpoint que trabaja primero y decide el status después es una escritura abierta ' +
        'con una hoja de parra encima.',
    ).not.toHaveBeenCalled();
  });

  it('con un Bearer equivocado: 401 y el barrido NO se llama', async () => {
    const res = await invocar({ authorization: `Bearer ${SECRETO.slice(0, -1)}x` });

    expect(res.status).toBe(401);
    expect(barrido).not.toHaveBeenCalled();
  });

  it('SIN `CRON_SECRET` en el entorno: 401 aunque el pedido traiga un Bearer cualquiera', async () => {
    delete process.env.CRON_SECRET;

    expect(
      (await invocar({ authorization: 'Bearer lo-que-sea' })).status,
      'con la env ausente el handler dejó pasar. Es el bug clásico: la comparación cae contra ' +
        '`undefined` y el endpoint que vacía reservas queda PÚBLICO en cualquier deploy sin la ' +
        'variable seteada, respondiendo 200 y sin loguear nada raro.',
    ).toBe(401);
    expect(barrido).not.toHaveBeenCalled();
  });

  it('con `CRON_SECRET` vacío —que es como viene en `.env.example`— también es 401', async () => {
    process.env.CRON_SECRET = '';

    expect((await invocar({ authorization: 'Bearer ' })).status).toBe(401);
    expect(barrido).not.toHaveBeenCalled();
  });

  it('con el Bearer correcto: 200, el barrido se llama UNA vez y la respuesta es `no-store`', async () => {
    const res = await invocar({ authorization: `Bearer ${SECRETO}` });

    expect(res.status).toBe(200);
    expect(barrido).toHaveBeenCalledTimes(1);
    expect(
      res.headers.get('cache-control'),
      'la respuesta del cron sin `no-store` es cacheable: el CDN puede servir el resultado de una ' +
        'corrida vieja a la siguiente invocación, y entonces el barrido deja de ocurrir.',
    ).toBe('no-store');
  });

  it('el 401 no distingue entre "sin header", "header malo" y "sin env"', async () => {
    const sinHeader = await invocar({});
    const headerMalo = await invocar({ authorization: 'Bearer no' });
    delete process.env.CRON_SECRET;
    const sinEnv = await invocar({ authorization: `Bearer ${SECRETO}` });

    const cuerpos = await Promise.all([sinHeader.text(), headerMalo.text(), sinEnv.text()]);
    expect(
      new Set(cuerpos).size,
      'los tres 401 tienen cuerpos distintos. Distinguirlos ayuda a quien está probando el ' +
        'secreto, y quien está probando no somos nosotros: nosotros tenemos los logs.',
    ).toBe(1);
  });
});
