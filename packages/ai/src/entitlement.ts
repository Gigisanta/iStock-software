/**
 * Quién tiene chat — o mejor dicho, **quién no lo decide acá**.
 *
 * ## En plan Base el widget está AUSENTE del DOM
 * No hay paywall, no hay "mejorá tu plan", no hay botón deshabilitado. **El comprador final no es
 * nuestro cliente y no tiene por qué enterarse de que existen planes** (`docs/CHATBOT.md`
 * §Entitlement). Renderizar el widget y bloquearlo del lado del servidor sería un fallo de producto
 * *y* de seguridad: le cuenta a un visitante anónimo qué contrató el vendedor.
 *
 * Eso lo decide `apps/web`. Lo que vive acá es la **segunda mitad**: aunque el widget no exista,
 * `/api/chat` sigue siendo una URL que alguien puede llamar a mano. `assertChatEntitled` es la
 * defensa que no depende de que el DOM se haya renderizado bien.
 *
 * ## El soft cap protege la factura, no al comprador
 * 40 mensajes por tenant por día. Después: sólo el botón de WhatsApp. El contador **no vive acá**
 * (necesita almacenamiento y esto es TS sin I/O): acá vive la decisión, que es lo que se testea.
 * Lo que sí vive acá desde el 2026-08-28 es la **forma del parte** (`TenantUsageToday`), para que
 * "todavía no hay contador" sea un valor con nombre y no un `0` escrito para poder compilar.
 * El contador de tokens por tenant va en ruta autenticada, nunca en la vidriera
 * (`ARCHITECTURE.md` §Seguridad: los contadores del WAF son por región y el límite global efectivo
 * es N×límite).
 */

import { z } from 'zod';
import { AiError } from './errors';

/**
 * El techo por IP de `/api/chat` vive en `config/firewall-rules.json` (regla `chatbot-rl`, del
 * LEAD) y lo aplica el WAF de Vercel. **`packages/ai` no lo aplica ni lo conoce**, y por eso acá no
 * hay constante.
 *
 * La había —`RATE_LIMIT_PER_IP = { max: 8, windowMinutes: 10 }`— y se borró el 2026-08-28 con su
 * test. No estaba mal escrita: estaba **vieja**, porque el WAF ya decía 20/600s. Una copia de un
 * valor cuya fuente está en otro archivo no se sincroniza sola, y la segunda fuente es siempre la
 * vieja. Encima nadie la importaba salvo su propio test, así que lo único que ese test certificaba
 * era que la copia existía, nunca que fuera cierta.
 *
 * Y aunque estuviera al día no serviría de techo de la factura: un límite por IP y un cupo por
 * tenant son **ejes distintos**. Lo que acota el gasto de un tenant es el soft cap de acá abajo.
 */

/** Soft cap por tenant y por día. Llegado el tope, sólo queda el botón de WhatsApp. */
export const SOFT_CAP_MESSAGES_PER_TENANT_PER_DAY = 40;

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Este paquete NO decide quién tiene chat. Exige que alguien ya lo haya decidido.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Hasta el 2026-08-28 acá vivía `chatEnabled(plan)`, un `switch` sobre el plan que devolvía `true`
 * para `trial` **incondicionalmente**. El defecto no era que se olvidara de mirar el vencimiento:
 * era que **la firma no recibía la fecha**, así que estructuralmente no podía mirarlo. Un tenant
 * con el trial vencido hace dos meses conservaba la feature más cara del producto y la única con
 * costo marginal por uso. Contradecía ADR-018 y contradecía
 * `apps/web/app/(billing)/_lib/entitlements.ts`, que sí evalúa `trial_ends_at`.
 *
 * El arreglo obvio —agregarle `trialEndsAt` al `switch`— era el peor: dejaba tres mapas
 * plan→feature en el repo (éste, `(billing)/_lib/plans.ts` y `(app)/_lib/entitlements.ts`) y le
 * daba a `packages/ai` una opinión sobre facturación. **Este paquete es TS puro sin I/O: no tiene
 * la fila del tenant, no tiene el reloj de la suscripción y no debería tener voto.** Quien tiene la
 * fila decide; acá se exige el veredicto.
 *
 * La forma es **estructuralmente compatible** con el `EntitlementVerdict` de `(billing)`, a
 * propósito: ese módulo pasa su veredicto tal cual, sin adaptador y sin que `packages/ai` importe
 * nada de `apps/web`. Si mañana el vocabulario de motivos crece, acá no hay que tocar nada.
 */
export const chatEntitlementSchema = z.union([
  z.object({ ok: z.literal(true), limit: z.number().int().nonnegative().nullish() }),
  z.object({ ok: z.literal(false), reason: z.string().min(1).max(60) }),
]);
export type ChatEntitlement = z.infer<typeof chatEntitlementSchema>;

/**
 * Tira si el tenant no tiene chat. Se llama en el servidor **antes** de armar ningún prompt: sin
 * entitlement no se gasta ni el armado.
 *
 * **Falla cerrado.** Ausencia de veredicto es "no tiene chat", nunca "tiene": un `undefined` que se
 * cuela por un refactor, un JSON que llegó sin el campo o un llamador que todavía no cablearon
 * terminan en `AI_NOT_ENTITLED`, que cuesta un handoff. El default opuesto cuesta la feature más
 * cara del producto regalada, y en silencio.
 */
export function assertChatEntitled(entitlement: ChatEntitlement | null | undefined): void {
  const parsed = chatEntitlementSchema.safeParse(entitlement);
  if (!parsed.success) {
    throw new AiError(
      'AI_NOT_ENTITLED',
      'no llegó un veredicto de entitlement válido. Este paquete no decide quién tiene chatbot: ' +
        'lo decide quien tiene la fila del tenant. Sin veredicto, no hay chat.',
    );
  }
  if (!parsed.data.ok) {
    throw new AiError(
      'AI_NOT_ENTITLED',
      `el tenant no tiene chatbot (${parsed.data.reason}). En Base el widget ni siquiera existe en ` +
        'el DOM: si esta llamada ocurrió, llegó por fuera de la vidriera.',
    );
  }
}

/** ¿Ya se consumió el cupo diario del tenant? `count` = mensajes de hoy, antes de este. */
export function softCapReached(count: number, cap: number = SOFT_CAP_MESSAGES_PER_TENANT_PER_DAY): boolean {
  return count >= cap;
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El contador es el techo de la factura, así que su AUSENCIA tiene que ser un valor con nombre.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Hasta el 2026-08-28 `ChatInput` pedía `messagesToday: number`. La constante existía, el predicado
 * existía y el gate de `chat.ts` existía; **el contador no**. El modo de falla no era hipotético y
 * lo midió `cost-auditor`: el día que alguien cablee `/api/chat` va a necesitar compilar, el
 * contador todavía no va a existir, y `messagesToday: 0` **compila, pasa los tests, pasa la eval y
 * apaga el cap sin que nada se ponga rojo**. Un cero fabricado es indistinguible de un cero real
 * cuando los dos son el mismo `number`.
 *
 * ## La cuenta, y por qué el WAF no la reemplaza
 * **El costo por mensaje no se escribe acá.** Lo emite `pnpm --filter @istock/ai eval` en el bloque
 * generado de `README.md`, y esta línea llegó a tener una copia vieja (`USD 0,00008032`, de una
 * corrida anterior a que el corpus ejerciera tools) al lado del número generado — el mismo defecto
 * de dos fuentes que `evals/report-md.ts` existe para no repetir. Lo que se escribe acá es la
 * **forma** de la cuenta, que no cambia cuando cambia la tarifa:
 *
 * - Con contador: `costo por mensaje × 40 × 30` = el gasto máximo de un tenant al tope del cap.
 *   Son centavos al mes contra un plan Negocio de USD 35. El cap hace su trabajo.
 * - Sin contador: **no hay techo por tenant**. El único límite que queda es el del WAF, que es
 *   `chatbot-rl` en `config/firewall-rules.json`: **20 requests / 600 s, y el eje es la IP**.
 *   Eso es 2 req/min = 86.400 mensajes/mes **por IP**, todos llegando al modelo (un abusador no
 *   pregunta cosas que derivan gratis, así que no le aplica la tasa mezclada sino la facturada).
 *
 * Con la tarifa medida el 2026-08-28 —USD 0,1257 por mil mensajes facturados, bloque generado del
 * README— eso da **~USD 11/mes por IP**, contra los ~USD 34 netos que deja un plan Negocio después
 * de Mercado Pago. Tres IPs y el tenant es deficitario **sin que nadie viole ninguna regla**, y el
 * multiplicador real es peor: `ARCHITECTURE.md` §Seguridad dice que los contadores del WAF son por
 * región, así que el límite global efectivo es N×20/600s.
 *
 * La conclusión no depende del número exacto y por eso se escribe la forma: **un límite por IP no
 * puede acotar un costo por tenant, son ejes distintos**. El techo de la factura es el contador, y
 * el contador todavía no existe (ADR C1). Por eso `requireMeasuredUsage` falla cerrado en vez de
 * asumir cero — es lo único que hoy impide que la ausencia del contador se pague en la factura.
 *
 * ## Por qué un tipo con marca y no un `number` "bien documentado"
 * `messagesToday` no es un número: es **un parte de un contador**, y un parte tiene dos estados
 * posibles —midió, o no hay contador—. Modelarlo como `number` deja el segundo estado sin
 * representación, y un estado sin representación se codifica igual: con el valor más inocente que
 * haya a mano. Acá el más inocente es el que apaga el cap.
 *
 * La marca es un `unique symbol` **declarado y no exportado**: fuera de este módulo el nombre no
 * existe, así que no se puede escribir un literal de esta forma ni con `kind` correcto. Los dos
 * constructores de abajo son la única puerta. Falsificar sigue siendo posible con un `as`, y eso es
 * a propósito: ningún sistema de tipos evita una mentira deliberada. Lo que sí evita es la
 * **omisión**, que es el modo de falla real — el que ocurre por apuro y no por decisión.
 *
 * ## Este paquete sigue sin tener el contador
 * Igual que con `ChatEntitlement`: acá vive la decisión, no el estado. El contador necesita
 * almacenamiento por tenant/día en un camino anónimo de vidriera y eso es el ADR C1, que todavía no
 * está escrito. Mientras no exista, el cableado honesto es `usageUnmeasured(...)`, que **falla
 * ruidoso** (`AI_USAGE_UNMEASURED`) en vez de contestar gratis.
 */
declare const USAGE_EVIDENCE: unique symbol;

/** El contador midió. `messagesToday` = mensajes de hoy de este tenant, sin contar el actual. */
export interface MeasuredUsage {
  /** Marca fantasma: no existe en runtime y no se puede nombrar afuera. */
  readonly [USAGE_EVIDENCE]: 'measured';
  readonly kind: 'measured';
  readonly messagesToday: number;
}

/** No hay contador. No es "cero mensajes": es "no sé", y no saber cuesta la factura. */
export interface UnmeasuredUsage {
  readonly [USAGE_EVIDENCE]: 'unmeasured';
  readonly kind: 'unmeasured';
  readonly reason: string;
}

/** Parte del contador diario del tenant. Sólo lo producen `usageMeasured` / `usageUnmeasured`. */
export type TenantUsageToday = MeasuredUsage | UnmeasuredUsage;

/**
 * Afirma que el contador midió, y cuánto.
 *
 * Quien llama esto está **firmando** que el número salió de un contador real. Un `usageMeasured(0)`
 * escrito para que compile no es un atajo: es la misma mentira que antes se escribía sola.
 */
export function usageMeasured(messagesToday: number): MeasuredUsage {
  if (!Number.isInteger(messagesToday) || messagesToday < 0) {
    throw new AiError(
      'AI_INPUT_INVALID',
      `un parte de contador tiene que ser un entero >= 0 y llegó ${JSON.stringify(messagesToday)}. ` +
        'Un contador que devuelve basura no es un contador: si no se pudo medir, usá usageUnmeasured().',
    );
  }
  return { kind: 'measured', messagesToday } as MeasuredUsage;
}

/**
 * Declara que **no hay contador**. Compila; `answerChat` tira `AI_USAGE_UNMEASURED` al primer
 * request. Ruidoso a propósito: un cableado sin medidor tiene que aparecer en Sentry el primer día,
 * no en la factura del mes siguiente.
 *
 * El motivo se exige de 12 caracteres para arriba por la misma razón que `web-lint:sin-tenant` pide
 * 30: una excepción se declara y se explica, y la alternativa a explicarla no es "sin excepción",
 * es la excepción invisible.
 */
export function usageUnmeasured(reason: string): UnmeasuredUsage {
  const trimmed = reason.trim();
  if (trimmed.length < 12 || trimmed.length > 160) {
    throw new AiError(
      'AI_INPUT_INVALID',
      'declarar que no hay contador exige un motivo de 12 a 160 caracteres. Sin motivo escrito, ' +
        'nadie sabe si falta cablear el contador o si se cayó el que había.',
    );
  }
  return { kind: 'unmeasured', reason: trimmed } as UnmeasuredUsage;
}

/**
 * Devuelve los mensajes de hoy, o tira. **Falla cerrado**, igual que `assertChatEntitled`: ausencia
 * de parte es "no medido", nunca "cero". Los dos defaults cuestan algo; el opuesto cuesta el único
 * vector del producto con costo por uso, sin techo y en silencio.
 *
 * Acepta `unknown` porque el borde real es JS: un route handler puede pasar lo que sea y la marca
 * de tipos no viaja hasta ahí.
 */
export function requireMeasuredUsage(usage: TenantUsageToday | null | undefined): number {
  const candidate = usage as { kind?: unknown; messagesToday?: unknown; reason?: unknown } | null | undefined;
  if (candidate?.kind === 'measured' && Number.isInteger(candidate.messagesToday)) {
    return candidate.messagesToday as number;
  }
  const why =
    candidate?.kind === 'unmeasured' && typeof candidate.reason === 'string'
      ? candidate.reason
      : 'no llegó un parte de contador válido';
  throw new AiError(
    'AI_USAGE_UNMEASURED',
    `sin contador de mensajes del tenant no hay chat (${why}). El soft cap de ` +
      `${SOFT_CAP_MESSAGES_PER_TENANT_PER_DAY}/día es el techo de la factura y no puede depender de un ` +
      'número escrito a mano en el call site. El parte se construye con usageMeasured() / usageUnmeasured().',
  );
}
