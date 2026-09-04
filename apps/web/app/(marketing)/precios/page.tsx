import Link from 'next/link';
import type { Metadata } from 'next';

/**
 * Precios. `PRODUCT.md` §Planes es la fuente: Trial 14 días · Base ~USD 19 · Negocio ~USD 35.
 *
 * El "~" no es cosmético y por eso está también en la pantalla. El precio final en pesos depende
 * del plan de suscripción configurado en Mercado Pago; se confirma antes de pagar y no se inventa
 * un tipo de cambio desde esta página.
 */

export const metadata: Metadata = {
  title: 'Precios',
  description: 'Prueba de 14 días. Plan Base desde USD 19 por mes. Plan Negocio desde USD 35.',
};

interface Plan {
  readonly id: string;
  readonly name: string;
  readonly price: string;
  readonly period: string;
  readonly pitch: string;
  readonly features: readonly string[];
  readonly missing: readonly string[];
  readonly highlighted: boolean;
}

const PLANS: readonly Plan[] = [
  {
    id: 'trial',
    name: 'Prueba',
    price: 'Gratis',
    period: '14 días',
    pitch: 'Todo lo del plan Negocio, sin tarjeta.',
    features: ['Todas las funciones', 'Sin tarjeta', 'Sin compromiso'],
    missing: [],
    highlighted: false,
  },
  {
    id: 'base',
    name: 'Base',
    price: '~USD 19',
    period: 'por mes',
    pitch: 'Para el que quiere vidriera y stock ordenado.',
    features: [
      'Stock por unidad y por lote',
      'Vidriera en tu-negocio.maat.work',
      'Botón de WhatsApp con el mensaje armado',
      'Precio en dólares y en pesos con cotización oficial diaria',
      '1 punto de retiro',
      'Canje presencial',
      'Texto listo para estados de IG y WhatsApp',
    ],
    missing: ['Sin chatbot en la vidriera', 'Sin reservas', 'Sin margen ni costo por equipo'],
    highlighted: true,
  },
  {
    id: 'negocio',
    name: 'Negocio',
    price: '~USD 35',
    period: 'por mes',
    pitch: 'Para el que ya vende volumen y necesita control.',
    features: [
      'Todo lo del plan Base',
      'Chatbot en la vidriera que contesta con tu stock',
      'Reservas con vencimiento automático',
      'Costo y margen por equipo (sólo lo ve el dueño)',
      'Hasta 3 puntos de retiro',
    ],
    missing: [],
    highlighted: false,
  },
];

export default function PricingPage() {
  return (
    <section className="pricing-page">
      <div className="pricing-header">
        <h1>Precios</h1>
        <p>
          Un solo negocio por cuenta. El precio es por negocio, no por vendedor: sumás a los chicos
          que atienden sin pagar de más.
        </p>

        <p className="pricing-note">
          <strong>Probá 14 días sin tarjeta.</strong> Después elegís Base o Negocio y completás la
          suscripción en Mercado Pago. El monto final se muestra antes de confirmar.
        </p>
      </div>

      <div className="pricing-grid">
        {PLANS.map((plan) => (
          <article
            key={plan.id}
            data-plan={plan.id}
            className={`flex flex-col rounded-2xl border p-6 ${
              plan.highlighted
                ? 'border-neutral-900 dark:border-white'
                : 'border-neutral-200 dark:border-neutral-800'
            }`}
          >
            <h2>{plan.name}</h2>
            <p className="pricing-price">
              {plan.price}{' '}
              <span>{plan.period}</span>
            </p>
            <p>{plan.pitch}</p>

            <ul className="pricing-features">
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
              {plan.missing.map((item) => (
                <li key={item} className="pricing-features--muted">{item}</li>
              ))}
            </ul>

            <Link
              href={plan.id === 'trial' ? '/ingresar' : `/ingresar?plan=${plan.id}`}
              className={`mt-6 inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold ${
                plan.highlighted
                  ? 'bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200'
                  : 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900'
              }`}
            >
              {plan.id === 'trial' ? 'Empezar la prueba' : `Elegir ${plan.name}`}
            </Link>
          </article>
        ))}
      </div>

      <div className="mt-10 space-y-4 text-sm text-neutral-600 dark:text-neutral-300">
        <p>
          <strong className="font-semibold text-neutral-900 dark:text-neutral-100">
            ¿Por qué los precios están en dólares con un “~” adelante?
          </strong>{' '}
            Porque mostramos una referencia simple en USD y dejamos que Mercado Pago confirme el
            monto local del plan antes de cobrar. Así el precio que ves al contratar no depende de
            un número inventado en la vidriera.
        </p>
        <p>
          <strong className="font-semibold text-neutral-900 dark:text-neutral-100">
            ¿Una vidriera con mi diseño?
          </strong>{' '}
          Se hace, pero es un trabajo aparte y se cotiza aparte. Ningún plan la incluye.
        </p>
        <p>
          <strong className="font-semibold text-neutral-900 dark:text-neutral-100">
            ¿Cuánto sale por vendedor?
          </strong>{' '}
          Nada. El precio es por negocio, no por usuario. Sumás a los chicos que atienden y ellos no
          ven ni el costo ni el margen de ningún equipo.
        </p>
      </div>
    </section>
  );
}
