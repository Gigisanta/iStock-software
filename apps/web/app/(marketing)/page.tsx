import Link from 'next/link';
import { FeatureShowcase } from './_ui/feature-showcase';

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
 * El bloque de estado actual tampoco es humildad decorativa: el panel deja crear la cuenta, cargar
 * equipos y publicar la vidriera. La suscripción se completa fuera del sitio, en Mercado Pago.
 */

const STEPS = [
  {
    title: 'Cargás el equipo una vez',
    body:
      'Fotos con el celular, condición, batería, GB, color y precio en dólares. El precio en pesos ' +
      'se actualiza solo con la cotización oficial diaria.',
  },
  {
    title: 'Tenés tu vidriera',
    body:
      'Queda en tu-negocio.maat.work. La pegás en un estado de Instagram o en tu bio y listo. No ' +
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
  'Precio en dólares y en pesos, con cotización oficial actualizada diariamente.',
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
  ['Carrito y cobro online', 'La venta la cerrás vos por WhatsApp, como la cerrás ahora. La vidriera no cobra al cliente.'],
  ['Punto de venta / caja', 'No es un POS ni un sistema de taller.'],
  ['Landing a medida', 'La vidriera es la misma plantilla para todos. Un diseño propio se cotiza aparte.'],
] as const;

const PROOF_POINTS = [
  '14 días sin tarjeta',
  'Modelo, GB y color elegidos',
  'Vidriera en .maat.work',
  'WhatsApp con contexto',
] as const;

export default function MarketingHomePage() {
  return (
    <>
      <section className="marketing-hero">
        <div className="marketing-hero-copy">
          <p className="marketing-eyebrow">Para revendedores de celulares</p>
          <h1>Tu stock, listo para vender.</h1>
          <p className="marketing-lede">
            Una vidriera simple para mostrar tus equipos y recibir consultas con el WhatsApp ya escrito.
          </p>

          <div className="marketing-actions">
            <Link href="/ingresar">Probar gratis</Link>
            <Link href="/precios">Ver precios</Link>
          </div>
        </div>

        <aside
          className="marketing-hero-side"
          aria-label="Vista previa real de una vidriera con equipos publicados"
        >
          <figure className="marketing-preview">
            <div className="preview-browserbar" aria-hidden="true">
              <span className="preview-url">tu-negocio.maat.work</span>
            </div>
            <img
              className="marketing-preview-image"
              src="/marketing/storefront-preview.png"
              alt="Tres equipos publicados en una vidriera online"
              width="896"
              height="390"
              fetchPriority="high"
              decoding="async"
            />
            <figcaption className="marketing-preview-caption">
              <span>Vidriera pública</span>
              <strong>Stock visible. Conversaciones con contexto.</strong>
            </figcaption>
          </figure>
        </aside>
      </section>

      <section className="marketing-proof-rail" aria-label="Lo esencial de iStock">
        <div className="marketing-proof-track">
          {[0, 1].map((set) => (
            <ul
              key={set}
              className="marketing-proof-set"
              aria-hidden={set === 1 ? 'true' : undefined}
            >
              {PROOF_POINTS.map((point) => (
                <li key={point}>
                  <span className="marketing-proof-mark" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          ))}
        </div>
      </section>

      <FeatureShowcase />

      <section className="marketing-band">
        <div className="marketing-band-inner">
          <h2>Cómo funciona</h2>
          <ol className="marketing-workflow">
            {STEPS.map((step) => (
              <li key={step.title}>
                <div>
                  <h3>{step.title}</h3>
                  <span>{step.body}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="marketing-audience">
        <h2>Para quién es</h2>
        <p>
          Para el que mueve entre 20 y 200 equipos, atiende por WhatsApp, toma equipos en canje y
          hoy lleva el stock en una planilla. Si vendés dos celulares por mes, no te hace falta. Si
          tenés una cadena con depósito y facturación integrada, todavía no somos para vos.
        </p>
      </section>

      <section className="marketing-scope">
        <div className="marketing-scope-grid">
          <div>
            <h2>Lo que iStock hace</h2>
            <ul>
              {INCLUDED.map((item) => (
                <li key={item}>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2>Lo que iStock no hace</h2>
            <ul>
              {NOT_INCLUDED.map(([title, detail]) => (
                <li key={title}>
                  <span>
                    <strong>{title}.</strong> {detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="marketing-callout">
        <div className="marketing-callout-inner">
          <h2>Listo para empezar</h2>
          <div>
            <p>
              Creás tu cuenta, cargás equipos con fotos y publicás tu vidriera en minutos. El cliente
              ve la información completa y te escribe por WhatsApp con el mensaje ya armado.
            </p>
            <p>
              La prueba dura 14 días sin tarjeta. Cuando termina, elegís Base o Negocio y completás el
              pago de forma segura en Mercado Pago; nunca recibimos datos de tu tarjeta.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
