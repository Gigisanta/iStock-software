import { z } from 'zod';
import {
  RESERVATION_DEFAULT_MINUTES,
  RESERVATION_MAX_MINUTES,
  RESERVATION_MIN_MINUTES,
} from '@istock/domain';

/**
 * El borde de la reserva: lo que llega del `<form>` es input de cualquiera.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Fuera de rango se RECHAZA. No se clampea.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La tentación es `Math.min(120, Math.max(30, minutes))`: nunca falla, siempre guarda algo. Y por
 * eso está mal. Un `9999` guardado como `120` es una reserva que dura otra cosa que la que el
 * dueño pidió, sin cartel y sin log; el día que alguien lo note, lo que va a ver es "la reserva se
 * venció antes". Un borde que corrige en silencio no es validación, es pérdida de información.
 *
 * Además el `CHECK` de Postgres (`reservations_minutes_range`, `minutes between 30 and 120`)
 * rebotaría igual: la elección real no es "clampear o fallar", es "fallar acá con un mensaje en
 * castellano" o "fallar allá con un `23514` en inglés que arrastra la fila en el `DETAIL`".
 *
 * ── Los tres números salen del dominio ──────────────────────────────────────────────────────
 * `RESERVATION_MIN_MINUTES` / `MAX` / `DEFAULT` se importan de `@istock/domain`. Escribir `30` y
 * `120` acá sería una segunda fuente de verdad frente al `CHECK` de la migración y frente a
 * `createReservation()`, y las tres se desincronizan en el orden en que se olvidan.
 *
 * ── Todo entra como texto ───────────────────────────────────────────────────────────────────
 * Un `FormData` da `string | File | null`. El `preprocess` normaliza el `null` del campo ausente a
 * `''` y **nada más**: un `File` sigue llegando como `File` y `z.string()` lo rechaza. Convertir
 * con `String(value)` acá sería aceptar `[object File]` como duración.
 */

/**
 * Duración en minutos. Vacío = el default del dominio (60), que es lo que manda el `<select>`
 * cuando el dueño no toca nada.
 *
 * El regex corre **antes** de `parseInt` y no después, porque `parseInt('60.5')` es `60` y
 * `parseInt('6 0')` es `6`: los dos son duraciones válidas que nadie pidió. Con `^\d{1,5}$`,
 * `'60.5'`, `'sesenta'`, `'6 0'`, `' '` y `'-60'` rebotan por forma, y `'0'` / `'99999'` rebotan
 * por rango — con el mensaje que nombra los dos extremos, que es el único útil parado en un local.
 */
const minutesSchema = z.preprocess(
  (raw) => raw ?? '',
  z
    .string({ error: 'Elegí cuánto dura la reserva.' })
    .transform((raw) => (raw === '' ? String(RESERVATION_DEFAULT_MINUTES) : raw))
    .refine((raw) => /^\d{1,5}$/u.test(raw), {
      message: 'La duración va en minutos, en número entero.',
    })
    .transform((raw) => Number.parseInt(raw, 10))
    .refine(
      (minutes) => minutes >= RESERVATION_MIN_MINUTES && minutes <= RESERVATION_MAX_MINUTES,
      {
        message: `La reserva dura entre ${String(RESERVATION_MIN_MINUTES)} y ${String(RESERVATION_MAX_MINUTES)} minutos.`,
      },
    ),
);

/**
 * Etiqueta del cliente. Es lo que el dueño escribe para acordarse de quién es la seña
 * ("Juan de Cipolletti"): `commerce.ts` lo dice explícito — *"No es un CRM"*.
 *
 * Vacío se guarda como `null` y no como `''`. La columna es nullable y "no hay etiqueta" tiene una
 * sola representación; con las dos, media pantalla pregunta `!== null` y la otra media `!== ''`.
 *
 * El techo de 80 caracteres no es estético: sin techo esto se usa como campo de notas, y ahí entra
 * un teléfono, una dirección o un IMEI en un lugar que no está pensado para eso.
 */
const customerLabelSchema = z.preprocess(
  (raw) => raw ?? '',
  z
    .string({ error: 'Esa etiqueta no se entiende.' })
    .transform((raw) => raw.trim().replace(/\s+/gu, ' '))
    .pipe(z.string().max(80, 'La etiqueta no puede pasar de 80 caracteres.'))
    .transform((value): string | null => (value === '' ? null : value)),
);

/** El id viene de un `<input type="hidden">`: se valida como cualquier otro dato de afuera. */
const listingIdSchema = z.uuid('Ese equipo no existe.');

export const reserveUnitSchema = z.object({
  listingId: listingIdSchema,
  minutes: minutesSchema,
  customerLabel: customerLabelSchema,
});

export type ReserveUnitInput = z.infer<typeof reserveUnitSchema>;

/** Cancelar no necesita nada más que el equipo: la reserva activa es única por unidad. */
export const cancelReservationSchema = z.object({
  listingId: listingIdSchema,
});

export type CancelReservationInput = z.infer<typeof cancelReservationSchema>;
