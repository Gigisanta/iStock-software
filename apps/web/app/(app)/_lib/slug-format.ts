/**
 * El **formato del slug del tenant, visto desde el panel**. Este archivo ya no decide nada: es un
 * adaptador de una línea sobre `@istock/domain`.
 *
 * ## Por qué dejó de tener su propia lista
 * El slug es tres cosas a la vez — subdominio (`{slug}.maat.work`), cache tag
 * (`storefront:{slug}`) y segmento de path del rewrite (`/s/{slug}`) — y por eso lo miran dos
 * owners distintos: `(app)` decide **qué se puede registrar** y `(storefront)` decide **qué
 * subdominio sirve una vidriera**. Mientras la lista de reservados estuvo escrita dos veces, las
 * dos copias **ya habían divergido**: el proxy mandaba `not-a-tenant.maat.work` a marketing (es
 * el slug semilla del prerender) y este formulario dejaba registrar ese mismo nombre. Quien lo
 * registrara pagaba un plan y su vidriera no existía nunca.
 *
 * Ese bug no rompe el build, no rompe un test unitario de nadie y no tira ningún error en
 * producción: aparece con el primer cliente. La única defensa real es que **la lista sea una sola
 * y que "una sola" sea una propiedad del grafo de imports**, no una promesa de code review.
 * `packages/domain` es el único paquete que los cuatro owners del slug pueden importar (TS puro,
 * cero I/O), así que la lista vive ahí (`packages/domain/src/reserved-slugs.ts`) y acá se importa.
 *
 * ## Por qué este archivo sigue existiendo
 * Por bytes en el navegador, no por gusto. El formulario de alta es un Client Component y necesita
 * `suggestSlug()` mientras la persona escribe el nombre del negocio. `_lib/slug.ts` — que es el
 * borde de verdad — arrastra **Zod entero al bundle** si se lo importa desde el cliente. Este
 * módulo es puro y se puede importar de los dos lados; el otro, sólo del server.
 *
 * No agregues nada acá: si falta un nombre reservado, se agrega en `@istock/domain`, que lo cierra
 * en las dos caras de una sola vez.
 */

export {
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
  isReservedSlug,
  isSlugShaped,
  isUsableSlug,
  normalizeSlug,
  suggestSlug,
} from '@istock/domain';
