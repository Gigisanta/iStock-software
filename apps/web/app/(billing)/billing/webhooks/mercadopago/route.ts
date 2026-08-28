import { billingDriver, mpAccessToken, mpWebhookSecret } from '../../../_lib/env';
import { createHttpMercadoPagoClient } from '../../../_lib/mercadopago/client';
import { handleWebhookNotification, type WebhookDeps } from '../../../_lib/webhook/handle-notification';
import { createPgBillingEventLedger } from '../../../_lib/webhook/pg-ledger';
import { logError } from '../../../../(app)/_lib/log';

/**
 * `POST /billing/webhooks/mercadopago` — la única puerta por la que alguien deja de ser trial.
 *
 * El archivo es **cableado y nada más**: arma las dependencias reales y delega en
 * `handleWebhookNotification()`, que es lo que los tests manejan. Esa separación es la que permite
 * entregar el mismo evento dos veces y contar los efectos sin levantar un servidor.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Qué la protege
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El HMAC de `x-signature`, verificado **acá adentro**. No hay guard del proxy y no puede haberlo:
 * un `matcher` que excluye un path también saltea las Server Functions de ese path (ADR-007), así
 * que delegar la autorización al proxy es delegarla a algo que a veces no corre. Sin
 * `MP_WEBHOOK_SECRET` no se autoriza a nadie: 401, sin tocar Postgres.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Hoy está INERTE, y es la conducta correcta
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * B3 (sandbox de MP: aplicación, access token, secreto de webhook) es un bloqueo humano abierto.
 * Con `BILLING_DRIVER="mock"` —el default de `.env.example`— no hay secreto, así que todo request
 * recibe 401 y ningún evento activa ningún plan. **No es un `if (mock) return 401` puesto a mano**:
 * es la consecuencia de fallar cerrado, que es lo que se quiere que siga pasando el día que
 * alguien apure el deploy sin las credenciales.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  22 segundos
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * MP espera un 200/201 en ≤22s o reintenta. Este handler hace, en el peor caso, dos `GET` a la API
 * de MP y una transacción corta. No se hace nada más acá adentro —ni mails, ni invalidaciones de
 * cache pesadas—: lo que no entra en el presupuesto no va en el webhook, va en un job.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Rate limit
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * No va acá y no va en `vercel.json`: vive en `config/firewall-rules.json`, que es del LEAD. Esta
 * ruta es nueva, así que **rompe el censo F3 de `scripts/guard-firewall.sh` hasta que el LEAD le
 * escriba su regla o su excepción**. Está reportado; un agente que quiere un techo pide, no edita.
 *
 * Y no se rate-limitea con un contador en Postgres (`CLAUDE.md` §2): sería pagar una escritura por
 * cada intento de quien la esté golpeando. Además el techo tiene que dejar pasar los reintentos
 * legítimos de MP, que llegan de las IPs de MP y en ráfaga.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué es dinámica sin `export const dynamic`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Con Cache Components prendido, `dynamic`/`revalidate`/`fetchCache` fueron removidos del Route
 * Segment Config en Next 16. Lo que la hace dinámica es que lee `request.headers` y el body.
 * `cache-control: no-store` lo dice también del lado del CDN.
 */

/**
 * Una vez por instancia, igual que el cron. La condición la controla enteramente quien está
 * afuera, así que un escaneo contra esta URL —que la va a recibir por el solo hecho de existir—
 * escribiría una línea idéntica por request y taparía en el drain lo único que importaba.
 */
let misconfiguredLogged = false;

function buildDeps(): WebhookDeps | null {
  let secret: string | null;
  let token: string | null;
  let driver: string;

  try {
    secret = mpWebhookSecret();
    token = mpAccessToken();
    driver = billingDriver();
  } catch {
    // `billingEnv()` tira si `BILLING_DRIVER="mercadopago"` esta a medio configurar. Es el error
    // correcto y NO puede salir como una excepcion sin manejar: eso seria un 500 con stack en el
    // cuerpo. El mensaje del Error tampoco se loguea — nombra variables de entorno.
    if (!misconfiguredLogged) {
      misconfiguredLogged = true;
      logError('billing.webhook.misconfigured', 'invalid_env', {});
    }
    return null;
  }

  if (driver !== 'mercadopago' || secret === null || token === null) {
    if (!misconfiguredLogged) {
      misconfiguredLogged = true;
      logError('billing.webhook.misconfigured', 'b3_pending', { driver });
    }
    return null;
  }

  return {
    secret,
    client: createHttpMercadoPagoClient(token),
    ledger: createPgBillingEventLedger(),
    now: () => new Date(),
  };
}

/** El mismo 401 para todo: el motivo va al log, nunca al que golpea la puerta. */
function unauthorized(): Response {
  return Response.json(
    { error: 'No autorizado.' },
    { status: 401, headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const deps = buildDeps();
  if (deps === null) return unauthorized();

  const result = await handleWebhookNotification(request, deps);

  if (result.status === 401) return unauthorized();

  // El `outcome` viaja en el cuerpo porque a MP no le dice nada y a nosotros nos ahorra correlacionar
  // con el log cuando B3 aterrice y haya que mirar el panel de notificaciones de MP. No lleva
  // `tenant_id` ni nada del pagador.
  return Response.json(
    { ok: result.status < 400, outcome: result.outcome },
    { status: result.status, headers: { 'cache-control': 'no-store' } },
  );
}
