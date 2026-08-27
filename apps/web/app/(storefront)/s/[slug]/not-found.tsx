import { STOREFRONT_DOMAIN } from '@istock/domain';

/**
 * 404 de la vidriera. Se muestra cuando el subdominio **no corresponde a ningún tenant activo**.
 *
 * Es un **404 real** (status 404), no un redirect al home de marketing: un redirect le dice a
 * Google que ese subdominio existe y le dice al visitante que se equivocó de producto, cuando lo
 * que pasó es que se equivocó de dirección.
 *
 * Esta respuesta **se cachea**, verificado y no supuesto: con `generateStaticParams` presente en
 * `page.tsx`, un slug inexistente devuelve `404` con `x-nextjs-cache: MISS` la primera vez,
 * `x-nextjs-cache: HIT` desde la segunda, y `Cache-Control: s-maxage=2592000,
 * stale-while-revalidate=28944000` en las dos. Un escaneo de subdominios cuesta **una** query de
 * Postgres por slug, no una por request.
 *
 * La contrapartida está escrita en `page.tsx` y es un requisito operativo, no un detalle: el alta
 * de un tenant tiene que invalidar `storefront:{slug}` y `tenant-config:{slug}` de su propio slug,
 * o este 404 queda cacheado hasta 30 días y la vidriera nace muerta.
 *
 * Cero `set-cookie`, cero JS de cliente, cero fetch. Es HTML estático.
 */
export default function StorefrontNotFound() {
  return (
    <main className="flex min-h-[70dvh] flex-col justify-center">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Error 404</p>
      <h1 className="mt-2 text-2xl font-semibold leading-tight sm:text-3xl">
        No hay ninguna vidriera en esta dirección
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        Revisá el link: cada negocio tiene su propia dirección con la forma{' '}
        <span className="font-mono text-neutral-900 dark:text-neutral-100">
          nombre.{STOREFRONT_DOMAIN}
        </span>
        . Si te lo pasó el vendedor por WhatsApp, pedile que te lo reenvíe completo.
      </p>
    </main>
  );
}
