import {
  TRADEIN_CONDITION_OPTIONS,
  TRADEIN_FIELDS,
  TRADEIN_LIMITS,
} from '../_lib/tradein-form';
import { TRADEIN_ENDPOINT_PATH } from '../_lib/routes';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El formulario de canje. HTML puro: `<form method="post">` y nada más.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **Cero JavaScript de cliente, y no por austeridad.** `web-lint` W001 prohíbe `"use client"` en
 * toda la vidriera, así que no hay adónde colgar un `onSubmit`. Lo que queda es lo que el
 * navegador ya sabe hacer solo, que además es lo único que funciona en la calle con 4G malo: un
 * POST nativo. Sin hidratación, sin bundle, sin spinner que se quede girando cuando la conexión se
 * corta a mitad de camino.
 *
 * La validación que la persona ve es la **nativa**: `required`, `maxlength`, `min`, `max`,
 * `inputmode`. Los números salen de `TRADEIN_LIMITS`, que es el mismo objeto del que sale el Zod
 * del handler — por eso el formulario no puede dejar escribir algo que el server rechaza sin
 * explicación. Si divergieran, el modo de falla sería "toqué Enviar y volví a la misma pantalla".
 *
 * ## Cuatro decisiones de mobile que son presupuesto, no estética
 * 1. **Una columna siempre.** Se llena con el pulgar, parado, con el teléfono en la otra mano.
 * 2. **`inputmode` en los tres campos numéricos**, para que salga el teclado de números y no el
 *    alfabético con la fila de arriba.
 * 3. **`autocomplete="name"` y `autocomplete="tel"`**: los dos campos obligatorios se llenan de un
 *    toque con lo que el navegador ya tiene guardado.
 * 4. **Los campos opcionales dicen que son opcionales**, en la etiqueta y no en un asterisco. Un
 *    canje sin GB de memoria ni porcentaje de batería es un canje perfectamente válido: mucha
 *    gente no sabe esos datos de su propio teléfono, y la evaluación de verdad es presencial.
 *
 * ## Lo que este formulario NO pregunta
 * - **Ningún identificador de hardware.** `CLAUDE.md` §8: eso no aparece en la vidriera, ni en un
 *   log, ni en el contexto del chatbot. El dueño lo anota en el panel cuando el equipo está en el
 *   mostrador, que es el único momento en que puede verificarlo.
 * - **Ningún precio.** Lo que el reseller ofrece pagar es el costo de la unidad que va a nacer del
 *   canje y lo escribe el dueño (`CLAUDE.md` §0.9). Pedirle al visitante que ponga un número acá
 *   sería dejar que escriba un costo de stock desde afuera, y además arruina la conversación: el
 *   precio de un canje se cierra mirando el equipo.
 * - **Ningún mail.** Lo que sigue es un WhatsApp, y pedir un dato que no se va a usar es pedir un
 *   dato personal de más.
 */

/** Clases compartidas de los controles. Un solo string: si divergen, el formulario se ve roto. */
const FIELD_CLASS =
  'mt-1 min-h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-base ' +
  'text-neutral-900 placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 ' +
  'dark:text-neutral-100 dark:placeholder:text-neutral-500';

const LABEL_CLASS = 'block text-sm font-medium text-neutral-700 dark:text-neutral-300';

const HINT_CLASS = 'mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400';

export function TradeinForm({ tenantName }: { readonly tenantName: string }) {
  const L = TRADEIN_LIMITS;

  return (
    <form
      // Path relativo: bajo `{slug}.maat.work` el proxy lo reescribe a `/s/{slug}/api/tradein`. El
      // slug del tenant no va acá porque ya está en el host — mismo argumento que la grilla.
      action={TRADEIN_ENDPOINT_PATH}
      method="post"
      className="mt-6 space-y-5"
      data-storefront="tradein-form"
    >
      <div>
        <label htmlFor="canje-nombre" className={LABEL_CLASS}>
          Tu nombre
        </label>
        <input
          id="canje-nombre"
          name={TRADEIN_FIELDS.customerName}
          type="text"
          required
          maxLength={L.customerName.max}
          autoComplete="name"
          enterKeyHint="next"
          placeholder="Cómo te llamás"
          className={FIELD_CLASS}
        />
      </div>

      <div>
        <label htmlFor="canje-wa" className={LABEL_CLASS}>
          Tu WhatsApp
        </label>
        <input
          id="canje-wa"
          name={TRADEIN_FIELDS.customerWaPhone}
          type="tel"
          required
          inputMode="tel"
          maxLength={L.customerWaPhone.max}
          autoComplete="tel"
          enterKeyHint="next"
          placeholder="299 415 3388"
          aria-describedby="canje-wa-ayuda"
          className={FIELD_CLASS}
        />
        <p id="canje-wa-ayuda" className={HINT_CLASS}>
          Es el número al que te van a escribir. Poné el que usás en WhatsApp.
        </p>
      </div>

      <div>
        <label htmlFor="canje-modelo" className={LABEL_CLASS}>
          Qué equipo entregás
        </label>
        <input
          id="canje-modelo"
          name={TRADEIN_FIELDS.modelText}
          type="text"
          required
          maxLength={L.modelText.max}
          enterKeyHint="next"
          placeholder="iPhone 12, Samsung A54, Motorola G84…"
          className={FIELD_CLASS}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="canje-gb" className={LABEL_CLASS}>
            Memoria (GB)
            <span className="ml-1 font-normal text-neutral-500">· opcional</span>
          </label>
          <input
            id="canje-gb"
            name={TRADEIN_FIELDS.storageGb}
            type="number"
            inputMode="numeric"
            min={L.storageGb.min}
            max={L.storageGb.max}
            step={1}
            placeholder="128"
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label htmlFor="canje-bateria" className={LABEL_CLASS}>
            Batería (%)
            <span className="ml-1 font-normal text-neutral-500">· opcional</span>
          </label>
          <input
            id="canje-bateria"
            name={TRADEIN_FIELDS.batteryPct}
            type="number"
            inputMode="numeric"
            min={L.batteryPct.min}
            max={L.batteryPct.max}
            step={1}
            placeholder="87"
            className={FIELD_CLASS}
          />
        </div>
      </div>

      <div>
        <label htmlFor="canje-color" className={LABEL_CLASS}>
          Color
          <span className="ml-1 font-normal text-neutral-500">· opcional</span>
        </label>
        <input
          id="canje-color"
          name={TRADEIN_FIELDS.color}
          type="text"
          maxLength={L.color.max}
          placeholder="Negro, grafito, azul…"
          className={FIELD_CLASS}
        />
      </div>

      <div>
        <label htmlFor="canje-estado" className={LABEL_CLASS}>
          Cómo está
          <span className="ml-1 font-normal text-neutral-500">· opcional</span>
        </label>
        {/*
          Las mismas cinco condiciones del catálogo, con las etiquetas de la ficha (`usado
          excelente`) y no las de WhatsApp (`usado A`): acá le habla a alguien que está describiendo
          su propio teléfono, no a un reseller. Son dos registros a propósito, `CLAUDE.md` §1.
          El valor vacío es legítimo y es el default: nadie tiene que elegir un estado para su
          equipo si no sabe cuál poner.
        */}
        <select
          id="canje-estado"
          name={TRADEIN_FIELDS.declaredCondition}
          defaultValue=""
          className={FIELD_CLASS}
        >
          <option value="">No sé / prefiero que lo vean</option>
          {TRADEIN_CONDITION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="canje-notas" className={LABEL_CLASS}>
          Algo más que quieras aclarar
          <span className="ml-1 font-normal text-neutral-500">· opcional</span>
        </label>
        <textarea
          id="canje-notas"
          name={TRADEIN_FIELDS.notes}
          maxLength={L.notes.max}
          rows={3}
          placeholder="Pantalla cambiada, funda incluida, tiene la caja…"
          className={FIELD_CLASS}
        />
      </div>

      {/*
        El botón NO lleva `name`: el esquema del handler es `.strict()`, así que una clave de más en
        el body haría fallar el envío entero. Es una trampa clásica de los formularios sin JS.
      */}
      <button
        type="submit"
        className="min-h-12 w-full rounded-xl bg-neutral-900 px-4 text-base font-semibold text-white dark:bg-white dark:text-neutral-900"
      >
        Enviar el canje
      </button>

      <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        Tu nombre y tu teléfono los ve {tenantName} y nadie más. El valor del canje se define
        mirando el equipo en el local: esto es para arrancar la conversación con los datos puestos.
      </p>
    </form>
  );
}
