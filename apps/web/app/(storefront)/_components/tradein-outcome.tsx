import type { ReactNode } from 'react';

/**
 * El **casco visual** de las dos pantallas que siguen a un envío de canje (`/canje/listo` y
 * `/canje/reintentar`). Sólo la forma: cada página escribe su propio texto.
 *
 * Existe para que las dos pantallas se vean igual sin copiar seis strings de clases de Tailwind, y
 * **no** para unificar el mensaje: decir "entró" y decir "no entró" son afirmaciones distintas y
 * tienen que poder cambiar por separado. Es el mismo criterio con el que la vidriera vacía tiene
 * dos textos y no uno.
 *
 * El `<meta name="robots">` viaja **soldado al cuerpo**, además del que devuelve
 * `generateMetadata` de cada página. Mismo argumento que `_components/storefront-miss.tsx`: cuerpo
 * y metadata son dos entradas de cache distintas, así que la directiva no puede depender de qué
 * rama de metadata resolvió. Acá es `noindex, follow` — ninguna de las dos pantallas es contenido
 * que alguien deba encontrar buscando, pero el link de vuelta a la vidriera sí se sigue.
 */
export function TradeinOutcome({
  kicker,
  title,
  children,
}: {
  readonly kicker: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <main data-storefront="tradein-outcome" className="flex min-h-[70dvh] flex-col justify-center">
      <meta name="robots" content="noindex, follow" />

      <p className="storefront-kicker">{kicker}</p>
      <h1>{title}</h1>
      {children}
    </main>
  );
}
