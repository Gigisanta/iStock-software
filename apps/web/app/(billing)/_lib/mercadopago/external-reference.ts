import { isPaidPlanTier, type PaidPlanTier } from '../plans';

/**
 * El puente MP → tenant.
 *
 * `external_reference` es un **request param de `POST /preapproval`** (de la suscripción, no del
 * plan), así que el alta se hace siempre server-side y el redirect va al `init_point` **de la
 * suscripción** (`?preapproval_id=`), nunca al del plan (`?preapproval_plan_id=`), que es idéntico
 * para todos los tenants. Mandar a alguien al init_point del plan es mandarlo a un checkout sin
 * referencia, y de vuelta no se sabe quién pagó.
 *
 * **Que esto sobreviva el checkout hosteado es el experimento 4 de ADR-008 y NO está verificado**
 * (B3). Lo que sí es nuestro y sí está testeado es el codec: que lo que se escribe se pueda leer,
 * y que un valor manipulado no se lea como válido.
 *
 * ── Por qué el plan viaja adentro ────────────────────────────────────────────────────────────
 * Porque el `preapproval_plan_id` de MP y nuestro `plan_tier` son dos vocabularios distintos, y
 * traducir de vuelta exigiría un mapa env → plan en el camino del webhook. El plan que el tenant
 * eligió se decide **una vez**, en el alta del preapproval, y viaja con la referencia. Se valida
 * al leerlo: un `plan` que no es `base` ni `negocio` invalida la referencia entera en vez de caer
 * a un default — un default acá sería regalar `negocio` o cobrar de más.
 */

const PREFIX = 'istock';
const VERSION = 'v1';
const SEPARATOR = ':';

export interface ExternalReference {
  readonly tenantId: string;
  readonly plan: PaidPlanTier;
}

/** `istock:v1:<tenantId>:<plan>`. Corto y sin espacios: viaja en un campo de texto de MP. */
export function encodeExternalReference(ref: ExternalReference): string {
  return [PREFIX, VERSION, ref.tenantId, ref.plan].join(SEPARATOR);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * `null` ante cualquier duda. Es un identificador que vuelve **de afuera**: la referencia decide a
 * qué tenant se le activa un plan pago, así que se valida con la misma vara que un id de request.
 * El `tenant_id` se exige con forma de UUID acá, y **además** el efecto lo vuelve a acotar por
 * `tenant_id` en el `where` (`CLAUDE.md` §2, defensa en profundidad).
 */
export function decodeExternalReference(raw: string | null): ExternalReference | null {
  if (raw === null) return null;

  const parts = raw.split(SEPARATOR);
  if (parts.length !== 4) return null;

  const [prefix, version, tenantId, plan] = parts;
  if (prefix !== PREFIX || version !== VERSION) return null;
  if (tenantId === undefined || !UUID.test(tenantId)) return null;
  if (plan === undefined || !isPaidPlanTier(plan)) return null;

  return { tenantId, plan };
}
