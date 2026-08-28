import type { PublicStatus } from '@istock/domain';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Badge honesto: `reserved` NUNCA dice "disponible"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La tentación es un booleano: `available ? 'disponible' : 'no disponible'`. Con eso `reserved`
 * cae del lado equivocado o del lado inútil, y las dos opciones cuestan plata real:
 *
 * - Si `reserved` se muestra **disponible**, la persona manda el WhatsApp, el dueño contesta "ya
 *   está reservado" y el producto quema la única bala que tiene: la primera conversación. Es la
 *   mentira que el ICP ya sufre con los estados de Instagram desactualizados — literalmente el
 *   problema que venimos a resolver.
 * - Si `reserved` se esconde, el catálogo se ve más chico de lo que es y se pierde la señal
 *   "esto se vende" que es la que empuja a preguntar por el siguiente.
 *
 * Por eso son **tres** estados con tres textos, y la función es total sobre `PublicStatus`: el
 * `switch` sin `default` hace que agregar un estado público nuevo sea un error de compilación y no
 * un badge en blanco en producción.
 *
 * `sold` se sigue mostrando porque `PUBLIC_STATUSES` de `@istock/domain` lo incluye: el equipo
 * vendido es prueba social y la ficha vieja sigue teniendo URL. Lo que **no** hace es ofrecerlo
 * como si estuviera a la venta — el botón cambia de promesa, no desaparece (ver `ctaLabel`).
 */

export type StatusTone = 'available' | 'reserved' | 'sold';

export interface StatusBadge {
  /** Texto en español rioplatense, el que ve el visitante. */
  readonly label: string;
  /** Frase corta que explica el estado sin jerga. Vacía para `available`: no hay nada que aclarar. */
  readonly detail: string;
  /** Clave de estilo. No es el `status` crudo por diseño: la vista no debe leer el enum de negocio. */
  readonly tone: StatusTone;
  /**
   * Texto del **único** botón de WhatsApp de la ficha.
   *
   * Los tres estados abren la conversación, y eso lo decide el dominio, no esta pantalla:
   * `buildWaMessage` de `@istock/domain` tiene un mensaje distinto para cada uno de los tres,
   * incluido `sold` (*"¿Te queda alguno parecido?"*). Esconder el botón en `reserved` o en `sold`
   * sería contradecir el texto que el dominio ya escribió, y tirar a la basura los dos leads más
   * baratos que tiene el negocio: el que espera que se caiga una reserva y el que quiere el mismo
   * equipo que otro ya se llevó. Lo que cambia es **qué promete el botón**, no si existe.
   */
  readonly ctaLabel: string;
}

export function statusBadge(status: PublicStatus): StatusBadge {
  switch (status) {
    case 'available':
      return {
        label: 'Disponible',
        detail: '',
        tone: 'available',
        ctaLabel: 'Lo quiero — escribir por WhatsApp',
      };
    case 'reserved':
      return {
        label: 'Reservado',
        detail: 'Alguien lo está por comprar. Preguntá igual: si la reserva se cae, avisamos.',
        tone: 'reserved',
        ctaLabel: 'Preguntar por WhatsApp si se libera',
      };
    case 'sold':
      return {
        label: 'Vendido',
        detail: 'Este equipo ya se vendió. Queda publicado como referencia de precio.',
        tone: 'sold',
        ctaLabel: 'Preguntar por WhatsApp si entra otro igual',
      };
  }
}

/**
 * Clases de Tailwind por tono. Vive acá y no en el JSX para que el mapeo estado → color sea
 * testeable: el bug de "reservado en verde" es exactamente igual de caro que el de "reservado dice
 * disponible", y en una vidriera mirada de reojo en la calle el color se lee **antes** que el texto.
 */
export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  available: 'bg-emerald-100 text-emerald-900 ring-emerald-600/20',
  reserved: 'bg-amber-100 text-amber-900 ring-amber-600/30',
  sold: 'bg-zinc-200 text-zinc-700 ring-zinc-500/20',
};
