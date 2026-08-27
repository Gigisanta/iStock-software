import { DomainError, normalizeWaPhone } from '@istock/domain';

/**
 * Normalización **argentina** del teléfono de WhatsApp, en el borde del panel.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────────────────────────
 * `normalizeWaPhone()` de `@istock/domain` valida forma E.164 genérica: 8–15 dígitos, sin cero
 * inicial. Es correcto para el dominio, que no puede asumir un país. Pero eso deja pasar
 * `2995551234` tal cual, y `https://wa.me/2995551234` **no abre ningún chat**.
 *
 * Verificado a mano contra `packages/domain/src/wa.ts` (2026-08-27):
 *
 *   entrada               normalizeWaPhone      wa.me
 *   2995551234        →   2995551234            roto
 *   542995551234      →   542995551234          roto (le falta el 9 de móvil)
 *   0299 15 555 1234  →   DomainError           —
 *
 * El botón de WhatsApp **es** el producto (`PRODUCT.md` §Ficha pública). Un número que se guarda
 * sin código de país no se nota el día del alta: se nota semanas después, cuando el dueño pegó el
 * link en un estado y nadie le escribe. Por eso el borde del panel no puede aceptar lo que el
 * dominio acepta.
 *
 * ── Qué hace ──────────────────────────────────────────────────────────────────────────────────
 * Convierte lo que un reseller del Alto Valle escribe de verdad en el número que necesita `wa.me`:
 * `549` + característica + número (10 dígitos nacionales).
 *
 *   "299 555-1234"        → 5492995551234
 *   "0299 555 1234"       → 5492995551234   (le sacamos el 0)
 *   "542995551234"        → 5492995551234   (le agregamos el 9 de móvil)
 *   "+54 9 299 555-1234"  → 5492995551234
 *
 * Lo que **no** adivina: el `15`. `0299 15 555 1234` son 12 dígitos y la característica argentina
 * puede tener 2, 3 o 4 dígitos, así que sacar el `15` requiere adivinar dónde termina la
 * característica. Adivinar mal es guardar un número que no existe. Se rechaza con un mensaje que
 * dice exactamente qué sacar.
 *
 * Un número que empieza con `+` y no es `+54` se toma como internacional y sólo se le valida la
 * forma E.164: no le inventamos prefijos a un país que no conocemos.
 *
 * ── NOTA para el LEAD ─────────────────────────────────────────────────────────────────────────
 * Esto **debería vivir en `packages/domain`** junto a `normalizeWaPhone`, y está pedido en el
 * reporte: `packages/ai` (el chatbot arma el mismo link) y la vidriera van a necesitar la misma
 * regla, y tres copias divergen. `app-agent` no escribe en `packages/*`. Mientras tanto vive acá,
 * en el único lugar donde hoy se guarda un teléfono.
 *
 * Módulo **puro**: sin `server-only`, sin I/O, sin `process.env`. Es unit-testeable tal cual por
 * `qa-agent`, que es el dueño de los archivos de test.
 */

export type WaPhoneResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: string };

/** 10 dígitos nacionales: característica (2–4) + abonado. Es lo que pide `wa.me` después del 549. */
const AR_NATIONAL_LENGTH = 10;

const ASK_FOR_TEN_DIGITS =
  'Tienen que ser 10 números: la característica y el número, sin el 0 y sin el 15. ' +
  'Ejemplo: 299 555 1234.';

export function normalizeArWaPhone(raw: string): WaPhoneResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, reason: 'Poné el WhatsApp donde te escriben los clientes.' };

  const digits = trimmed.replace(/\D/gu, '');
  if (digits === '') return { ok: false, reason: ASK_FOR_TEN_DIGITS };

  // Internacional explícito: `+` con un código de país que no es el nuestro. No se toca.
  if (trimmed.startsWith('+') && !digits.startsWith('54')) return finish(digits);

  let national = digits;

  if (national.startsWith('54')) {
    national = national.slice(2);
    // El `9` de móvil que `wa.me` exige. Se saca acá y se vuelve a poner al final, así el
    // resultado es el mismo escriba `54…`, `549…` o nada.
    if (national.startsWith('9')) national = national.slice(1);
  } else if (national.startsWith('0')) {
    // El 0 de larga distancia. Lo escribe medio país y no va nunca en un número internacional.
    national = national.replace(/^0+/u, '');
  }

  if (national.length !== AR_NATIONAL_LENGTH) {
    if (national.length === AR_NATIONAL_LENGTH + 2 && national.includes('15')) {
      return {
        ok: false,
        reason:
          'Sacale el 15: el número para WhatsApp va sin el 15. ' +
          'Ejemplo: 0299 15 555 1234 se escribe 299 555 1234.',
      };
    }
    return { ok: false, reason: ASK_FOR_TEN_DIGITS };
  }

  return finish(`549${national}`);
}

/**
 * El chequeo final lo hace el dominio, siempre. Esta función arma el número; la forma E.164 la
 * decide un solo lugar en todo el repo, y no es este archivo.
 */
function finish(candidate: string): WaPhoneResult {
  try {
    return { ok: true, value: normalizeWaPhone(candidate) };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, reason: ASK_FOR_TEN_DIGITS };
    throw error;
  }
}
