import { z } from 'zod';
import { paymentMethodSchema, salePriceSchema } from '../../../_lib/sales/schema';

/**
 * El **borde** de `setListingStatusAction`: `FormData` → una petición de transición ya validada.
 *
 * Vive afuera de `actions.ts` por una restricción del runtime y por una del oficio. La de runtime:
 * un módulo `'use server'` sólo puede exportar funciones `async`, así que un schema exportado desde
 * allá no compila —el mismo motivo por el que `status-action-state.ts` existe—. La del oficio: un
 * borde que no se puede importar no se puede testear, y este borde es donde se cumple D2.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El destino es una allowlist de TRES, y la venta pide dos datos más
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Desde `/app/stock` se publica, se despublica y se marca vendido. `reserved` y los laterales
 * tienen su propio flujo (S6): dejar entrar el enum entero sería habilitar transiciones cuyos
 * efectos esta acción no ejecuta. `checkTransition()` igual las atajaría, pero la allowlist es más
 * barata y más explícita.
 *
 * Hasta S7 el enum era de dos, y el comentario decía que dejar entrar `sold` "sería habilitar
 * marcar vendido sin registrar la venta". Era cierto **entonces**: `transitionUnit()` descartaba
 * `createsSale`. Ahora no puede — `to: 'sold'` sin datos de venta **no compila** (D5).
 *
 * Es una unión discriminada y no un objeto plano con dos campos opcionales: con opcionales,
 * `to: 'sold'` sin precio pasaría el borde y el error aparecería recién abajo, que es exactamente
 * la forma del defecto que S7 cierra. Así, el parseo devuelve —ya estrechado— lo que
 * `TransitionRequest` pide.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  D2 · lo que este borde NO lee: el costo
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `sales.margin_usd` es una columna **generada** a partir de `price_usd - cost_usd`: escribir el
 * costo es escribir el margen. Por eso el costo no viene del request **ni siquiera como campo que
 * Zod descarta**: `formFields()` enumera las cinco claves que se leen y `costUsd` no es una. Un
 * `POST` que lo mande no encuentra quién lo lea; el valor se copia de `listings.cost_usd` adentro
 * de la transacción (`_lib/sales/record-sale.ts`).
 *
 * La distinción con el ALTA es a propósito y no es una inconsistencia: en `stock/nuevo/actions.ts`
 * el costo **sí** entra por el formulario, porque ahí el dueño está diciendo lo que pagó, y
 * prohibirlo sería prohibir cargar stock. El invariante no es "el costo nunca cruza un borde", es
 * "el costo nunca cruza el borde **de la venta**".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `after` no es una URL
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Viaja como `'stay' | 'stock'` y `actions.ts` lo mapea a paths escritos allá adentro. Un
 * `redirectTo` de texto libre en un form es un open redirect, y en una Server Action además es uno
 * que el navegador sigue sin preguntar. `catch('stay')` hace que basura en el campo no rompa la
 * operación: se hace igual y se queda.
 */

const commonFields = {
  listingId: z.uuid('Ese equipo no existe.'),
  after: z.enum(['stay', 'stock']).catch('stay'),
};

export const statusActionSchema = z.discriminatedUnion('to', [
  z.object({ ...commonFields, to: z.enum(['available', 'draft']) }),
  z.object({
    ...commonFields,
    to: z.literal('sold'),
    /** D3: lo **realmente cobrado**, que puede no ser el precio publicado. Sale en centavos. */
    priceUsdCents: salePriceSchema,
    paymentMethod: paymentMethodSchema,
  }),
]);

export type StatusActionInput = z.infer<typeof statusActionSchema>;

/**
 * Las **cinco** claves que se leen del `FormData`, enumeradas en un solo lugar y de un vistazo.
 *
 * `priceUsd` (el `name` del input) mapea a `priceUsdCents` (la clave del schema) porque el input es
 * texto en dólares —"620,50", como lo escribe alguien parado en el mostrador— y lo que sale del
 * parseo son centavos enteros. Los dos nombres dicen la verdad sobre su lado del borde.
 */
function formFields(formData: FormData): Record<string, unknown> {
  return {
    listingId: formData.get('listingId'),
    to: formData.get('to'),
    after: formData.get('after') ?? 'stay',
    priceUsdCents: formData.get('priceUsd'),
    paymentMethod: formData.get('paymentMethod'),
  };
}

const UNIDENTIFIED = 'No pudimos identificar el equipo. Recargá la pantalla.';

/**
 * Qué mostrarle a quien mandó el formulario cuando el borde rechaza.
 *
 * Los campos de la venta los tipea una persona, así que su mensaje es accionable ("Poné a cuánto lo
 * vendiste") y tiene que llegar tal cual. `listingId`, `to` y `after` viajan en hidden: si están
 * mal no hay nada que corregir tipeando —es una pantalla vieja o un `POST` armado a mano— y el
 * texto correcto es el genérico. Devolver el mensaje crudo de Zod para esos tres sería mostrarle a
 * alguien el nombre de un campo interno para que "lo arregle".
 */
function borderErrorText(error: z.ZodError): string {
  const typed = error.issues.find((issue) => {
    const field = issue.path[0];
    return field === 'priceUsdCents' || field === 'paymentMethod';
  });
  return typed?.message ?? UNIDENTIFIED;
}

export type ParsedStatusForm =
  | { readonly ok: true; readonly data: StatusActionInput }
  | { readonly ok: false; readonly error: string };

/** El borde entero, en una función: lo que se lee, lo que se valida y qué se dice cuando no pasa. */
export function parseStatusForm(formData: FormData): ParsedStatusForm {
  const parsed = statusActionSchema.safeParse(formFields(formData));
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, error: borderErrorText(parsed.error) };
}
