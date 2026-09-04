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
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El copy sólo puede afirmar lo que la vidriera puede sostener
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Hasta S6 el texto de `reserved` decía *«si la reserva se cae, avisamos»*. **No existe nada que
 * avise.** No hay lista de espera, no hay notificación, no se guarda un solo dato del visitante:
 * la vidriera es anónima y cacheada, no tiene DB propia y no la va a tener. Era una promesa hecha
 * a un desconocido que nadie iba a poder cumplir, y el que quedaba mal no éramos nosotros — era el
 * reseller, en su propio dominio.
 *
 * Peor de lo que parece: una reserva vencida cuyo barrido falla deja la unidad en `reserved`. El
 * cron ya tiene techo, contador de intentos y devuelve 500 con una unidad abandonada, pero el caso
 * *«esto quedó reservado más de lo esperable»* sigue existiendo y se resuelve a mano. Con el copy
 * viejo, esa ficha le prometía un aviso a cada visitante que la abriera, una vez por pageview.
 *
 * La regla que queda, y que el test hace fallar: **ningún texto de acá compromete una acción futura
 * nuestra.** Puede describir el presente (*"otra persona lo reservó"*), puede describir cómo
 * funciona el mundo (*"una reserva a veces se cae"*) y puede pedirle algo al visitante
 * (*"decíselo"*). No puede decir "avisamos", "te escribimos" ni "quedás anotado".
 *
 * Corolario sobre el botón: la degradación del CTA a *«Preguntar por WhatsApp si se libera»* era el
 * mismo error por otra vía. `CLAUDE.md` §1 da **un** botón `wa.me` por ficha y ese botón es el que
 * vende; un CTA que se disculpa convierte la única conversación del producto en una consulta tibia
 * que arranca perdida. El visitante que igual quiere ese equipo tiene que poder decirlo en un
 * mensaje que el vendedor pueda contestar — y decidir él si la seña se cae o no, que es lo único
 * que efectivamente puede pasar.
 *
 * Lo que **no** cambia, y es la mitad que protege al que ya señó: el badge sigue diciendo
 * `Reservado` —ni "disponible", ni "no disponible", ni "vendido"— y el payload público no crece.
 * Quién reservó y hasta cuándo son datos del panel: que la ficha diga que está reservado es todo
 * lo que un visitante anónimo puede saber.
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
        ctaLabel: 'Lo quiero por WhatsApp',
      };
    case 'reserved':
      // Dos frases y ninguna promesa. Ver el bloque «El copy sólo puede afirmar lo que la vidriera
      // puede sostener», arriba: acá se dice qué pasa (otra persona lo reservó), qué NO va a pasar
      // (no hay lista de espera) y qué puede hacer el visitante ahora (decirlo). Nada de esto
      // necesita que después ocurra algo nuestro para seguir siendo verdad.
      return {
        label: 'Reservado',
        detail:
          'Otra persona lo reservó y una reserva a veces se cae. No hay lista de espera: si lo ' +
          'querés igual, decíselo ahora al vendedor.',
        tone: 'reserved',
        // El CTA no se disculpa: es el mismo verbo que `available` con un «igual» adelante. El
        // estado ya lo dijo el badge dos veces (color y texto) — repetirlo acá sólo serviría para
        // que el visitante que igual lo quiere se sienta un colado.
        ctaLabel: 'Lo quiero igual por WhatsApp',
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
  available: 'bg-neutral-900 text-white ring-neutral-900/20 dark:bg-white dark:text-neutral-900',
  reserved: 'bg-neutral-200 text-neutral-800 ring-neutral-500/20 dark:bg-neutral-800 dark:text-neutral-100',
  sold: 'bg-white text-neutral-700 ring-neutral-500/20 dark:bg-neutral-950 dark:text-neutral-300',
};
