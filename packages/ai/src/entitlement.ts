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
 * El contador de tokens por tenant va en ruta autenticada, nunca en la vidriera
 * (`ARCHITECTURE.md` §Seguridad: los contadores del WAF son por región y el límite global efectivo
 * es N×límite).
 */

import { z } from 'zod';
import { AiError } from './errors';

/** Rate limit de la vidriera. Se aplica en el WAF de Vercel, no en la app (fragmenta el cache ISR). */
export const RATE_LIMIT_PER_IP = { max: 8, windowMinutes: 10 } as const;

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
