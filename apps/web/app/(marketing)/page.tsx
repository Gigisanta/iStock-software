import Link from 'next/link';

/**
 * Home de marketing.
 *
 * Regla de esta página, y es un gate de aceptación: **cero promesa que el producto no cumple.**
 * El ICP es un reseller del Alto Valle que hoy trabaja con Excel y estados de Instagram, y que ya
 * escuchó a diez vendedores de software prometerle facturación, integración con MercadoLibre y un
 * bot que atiende solo. La forma de ganarle a ese ruido no es prometer más: es ser el único que
 * dice qué **no** hace. Por eso la sección "Lo que iStock no hace" existe y no se borra en el
 * primer sprint de conversión.
 *
 * El bloque de estado actual tampoco es humildad decorativa: hoy el panel deja crear la cuenta y
 * reservar el subdominio, y todavía no deja cargar equipos. Decir "cargá tu stock hoy" sería
 * exactamente la promesa falsa que la slice tiene prohibida.
 */

const STEPS = [
  {
    title: 'Cargás el equipo una vez',
    body:
      'Fotos con el celular, condición, batería, GB, color y precio en dólares. El tipo de cambio ' +
      'lo ponés vos: no usamos ninguna API de dólar, usamos el tuyo.',
  },
  {
    title: 'Tenés tu vidriera',
    body:
      'Queda en tunegocio.maat.work. La pegás en un estado de Instagram o en tu bio y listo. No ' +
      'hay carrito, no hay checkout, no hay cuenta que el cliente tenga que crearse.',
  },
  {
    title: 'Te escriben por WhatsApp',
    body:
      'El cliente toca un botón y su WhatsApp se abre con el equipo y el precio ya escritos. En ' +
      'vez de "hola, info?" te llega "vi el iPhone 14 Pro 256 a USD 620 y lo quiero".',
  },
] as const;

const INCLUDED = [
  'Stock por unidad (con IMEI) y por lote (accesorios).',
  'Vidriera pública con fotos reales, condición, batería, GB, color y garantía.',
  'Precio en dólares y en pesos, con el tipo de cambio que cargás vos.',
  'Puntos de retiro con dirección y horario.',
  'Botón de WhatsApp con el mensaje ya armado.',
  'Canje presencial: el cliente te deja los datos de su equipo antes de ir.',
  'IMEI y resultado de la consulta a ENACOM guardados en el panel, nunca en la vidriera.',
  'Texto listo para copiar y pegar en estados de Instagram y WhatsApp.',
] as const;

const NOT_INCLUDED = [
  ['Facturación ARCA/AFIP', 'No emitimos ni un comprobante. Seguí con lo que usás hoy.'],
  ['WhatsApp Business API', 'El botón abre el WhatsApp normal. No mandamos mensajes por vos.'],
  ['Sincronización con MercadoLibre', 'No publicamos ni bajamos publicaciones de ML.'],
  ['Carrito y cobro online', 'La venta la cerrás vos, como la cerrás ahora. Acá no se cobra nada.'],
  ['Punto de venta / caja', 'No es un POS ni un sistema de taller.'],
  ['Landing a medida', 'La vidriera es la misma plantilla para todos. Un diseño propio se cotiza aparte.'],
] as const;

export default function MarketingHomePage() {
  return (
    <>
      <section className="mx-auto w-full max-w-5xl px-4 py-14 sm:py-20">
        <p className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Para revendedores de celulares
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
          Tu stock, con vidriera propia y el WhatsApp ya escrito.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-neutral-600 dark:text-neutral-300">
          Cargás los equipos una vez y tenés un link para mandar. El que entra ve fotos reales,
          condición, batería y precio en dólares y en pesos. Cuando te escribe, ya sabe qué quiere.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/ingresar"
            className="inline-flex items-center justify-center rounded-xl bg-neutral-900 px-6 py-3.5 text-base font-semibold text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Empezar la prueba de 14 días
          </Link>
          <Link
            href="/precios"
            className="inline-flex items-center justify-center rounded-xl border border-neutral-300 px-6 py-3.5 text-base font-semibold hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Ver precios
          </Link>
        </div>

        <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">
          Sin tarjeta para probar. Sin instalar nada.
        </p>
      </section>

      <section className="border-y border-neutral-200 bg-neutral-50 px-4 py-12 dark:border-neutral-800 dark:bg-neutral-900/50">
        <div className="mx-auto w-full max-w-5xl">
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Cómo funciona</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white dark:bg-white dark:text-neutral-900">
                  {index + 1}
                </span>
                <h3 className="mt-3 font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-12">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Para quién es</h2>
        <p className="mt-3 max-w-2xl text-neutral-600 dark:text-neutral-300">
          Para el que mueve entre 20 y 200 equipos, atiende por WhatsApp, toma equipos en canje y
          hoy lleva el stock en una planilla. Si vendés dos celulares por mes, no te hace falta. Si
          tenés una cadena con depósito y facturación integrada, todavía no somos para vos.
        </p>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-12">
        <div className="grid gap-8 sm:grid-cols-2">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Lo que iStock hace</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-neutral-700 dark:text-neutral-200">
              {INCLUDED.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span aria-hidden="true" className="select-none font-bold text-emerald-600">
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-bold tracking-tight">Lo que iStock no hace</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-neutral-700 dark:text-neutral-200">
              {NOT_INCLUDED.map(([title, detail]) => (
                <li key={title} className="flex gap-2.5">
                  <span aria-hidden="true" className="select-none font-bold text-neutral-400">
                    ✕
                  </span>
                  <span>
                    <strong className="font-semibold">{title}.</strong> {detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-16">
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm dark:border-amber-800/60 dark:bg-amber-950/30">
          <h2 className="font-bold">En qué estado está iStock hoy</h2>
          <p className="mt-2 text-neutral-700 dark:text-neutral-200">
            Lo estamos construyendo y lo decimos de frente. Hoy podés crear tu cuenta y reservar el
            link de tu vidriera. La carga de equipos, las fotos y la vidriera pública se van
            habilitando en las próximas semanas, y te avisamos por mail cuando te toca.
          </p>
          <p className="mt-2 text-neutral-700 dark:text-neutral-200">
            Mientras tanto no cobramos nada, y no porque sea una promoción: todavía no hay forma de
            pagarnos. Cuando la haya, te lo vamos a decir antes, no después.
          </p>
        </div>
      </section>
    </>
  );
}
