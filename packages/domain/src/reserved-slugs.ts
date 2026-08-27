/**
 * **La** lista de slugs reservados. Una sola, acá, y en ningún otro lado.
 *
 * ## Por qué esto vive en `packages/domain` y no en el que la usa
 *
 * El slug es cuatro cosas a la vez y cada una tiene un owner distinto:
 *
 * | cara del slug | quién decide | archivo |
 * |---|---|---|
 * | ¿se puede **registrar**? | `app-agent` | `apps/web/app/(app)/_lib/slug.ts` |
 * | ¿el subdominio **es** una vidriera? | `storefront-agent` | `apps/web/app/(storefront)/_lib/host.ts` |
 * | ¿la fila entra a `tenants`? | `db-agent` | `CHECK tenants_slug_format` |
 * | ¿el `wa.me` apunta al host correcto? | `domain-agent` | `src/wa.ts` |
 *
 * Mientras la lista estuvo escrita dos veces, las dos copias **ya divergieron**: el proxy manda
 * `not-a-tenant.maat.work` a marketing (es el slug semilla del prerender) y el panel dejaba
 * registrar ese mismo nombre. Quien lo registrara pagaba un plan y su vidriera no existía nunca:
 * no falla el build, no falla un unit test, no hay error en Sentry — el link simplemente no
 * muestra su negocio. Aparece con el primer cliente.
 *
 * `scripts/guard-leaks.sh` regla 14 ya vigila que el **regex** de slug no diverja entre owners.
 * La **lista** no la vigilaba nadie. Por eso está acá: `packages/domain` es el único paquete que
 * los cuatro owners pueden importar (TS puro, cero I/O), así que es el único lugar donde "una
 * sola fuente" es una propiedad del grafo de imports y no una promesa de review.
 *
 * ## Las dos caras de la lista, y por qué no son el mismo Set
 *
 * - {@link RESERVED_SLUGS} — **nadie puede registrar esto.** Es el superset. Lo consume la
 *   validación del alta (`slugSchema`) y el `CHECK`/seed de `packages/db`.
 * - {@link RESERVED_SUBDOMAINS} — **esto nunca es una vidriera**, va a marketing. Lo consume
 *   `resolveHost()` (y por lo tanto `proxy.ts`).
 *
 * La única diferencia entre los dos es {@link TENANT_SERVED_RESERVED_SLUGS}: nombres que **sí**
 * sirven una vidriera pero que ningún cliente puede pedir. Hoy hay exactamente uno, `demo`
 * (S13): `demo.maat.work` tiene que mostrar el tenant demo, y a la vez nadie puede quedárselo.
 * Unificar las dos listas en un solo Set rompe esa asimetría **en silencio** — o el demo deja de
 * tener vidriera, o el nombre `demo` queda libre para cualquiera. Por eso la excepción es un
 * valor declarado y testeado, no un comentario.
 *
 * ## Invariante que sostiene todo lo demás
 *
 * `RESERVED_SUBDOMAINS ⊆ RESERVED_SLUGS`, y por construcción:
 * **todo subdominio que el proxy manda a marketing es imposible de registrar.**
 * Si esa inclusión se rompe, hay alguien pagando por un link muerto.
 */

/**
 * El slug que `/s/[slug]` prerenderiza en el build para que la ruta sea ISR clásico en vez de
 * *postponed* (ver `apps/web/app/(storefront)/_lib/host.ts`). No es infraestructura ni marca:
 * es un artefacto del build que **tiene que ser irregistrable**, porque quien lo registrara se
 * quedaría con la entrada estática generada en el deploy.
 *
 * Vive acá, y no sólo en `(storefront)`, por la misma razón que la lista: la constante y la lista
 * que la protege no pueden estar en dos módulos distintos de dos owners distintos.
 */
export const PRERENDER_SEED_SLUG = 'not-a-tenant';

/**
 * Reservados que **sí** resuelven a una vidriera real.
 *
 * Excepción declarada, no accidental: el tenant demo existe en la base (`tenants.is_demo`) y
 * `demo.maat.work` sirve su vidriera, pero `demo` no se registra desde el panel.
 */
export const TENANT_SERVED_RESERVED_SLUGS: ReadonlySet<string> = new Set(['demo']);

/**
 * Lista canónica. Nadie registra ninguno de estos nombres. Seis familias, y ninguna es decorativa:
 *
 * 1. **Infraestructura** que ya existe o va a existir en `*.maat.work` (`www`, `api`, `cdn`, `mx`).
 *    Si un tenant se queda con `mail`, el día que se configure el correo hay que echarlo.
 * 2. **Marca y proveedores** (`maat`, `istock`, `vercel`, `supabase`): suplantación.
 * 3. **Rutas del producto** (`app`, `precios`, `stock`, `ajustes`). Un slug que colisiona con una
 *    ruta de primer nivel no rompe el subdominio: rompe la **URL del apex** y el `revalidateTag`.
 * 4. **Entornos** (`dev`, `staging`, `preview`, `sandbox`): se usan para deploys y para demos.
 * 5. **Superficie de phishing contra nuestros propios usuarios** (`login`, `pagos`, `soporte`,
 *    `seguridad`, `factura`). Es la familia que siempre se olvida y la única que se usa para
 *    robarle la sesión a un dueño desde un dominio que parece nuestro.
 * 6. **Artefactos del build** ({@link PRERENDER_SEED_SLUG}).
 *
 * Los nombres de 1–2 caracteres (`s`, `p`, `mp`, `db`) ya los rechaza el largo mínimo del slug;
 * están igual para que la lista sea legible como intención y no dependa de otro chequeo.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // 1 · infraestructura
  'www', 'api', 'cdn', 'img', 'imgs', 'image', 'images', 'static', 'assets', 'media', 'files',
  'mail', 'email', 'smtp', 'imap', 'pop', 'ftp', 'ns', 'ns1', 'ns2', 'dns', 'mx', 'vpn',
  'proxy', 'edge', 'origin', 'db', 'database', 'redis', 'cache', 'ws', 'wss', 'grafana',
  // 2 · marca y proveedores
  'maat', 'maatwork', 'istock', 'vercel', 'supabase', 'cloudflare', 'r2', 'mercadopago', 'mp',
  // 3 · producto y rutas del panel
  'app', 'apps', 'panel', 'dashboard', 'admin', 'administrador', 'root', 'system', 'internal',
  's', 'p', 'store', 'storefront', 'shop', 'tienda', 'vidriera', 'catalogo', 'catalog',
  'stock', 'equipos', 'canjes', 'canje', 'ventas', 'reservas', 'clientes', 'ajustes',
  'onboarding', 'ingresar', 'crear-negocio', 'precios', 'pricing', 'planes', 'plans',
  'blog', 'docs', 'doc', 'ayuda', 'help', 'faq', 'contacto', 'contact', 'about', 'nosotros',
  'legal', 'terminos', 'terms', 'privacidad', 'privacy', 'cookies',
  // 4 · entornos
  'demo', 'test', 'testing', 'dev', 'develop', 'staging', 'stage', 'preview', 'sandbox',
  'beta', 'alpha', 'next', 'new', 'old', 'legacy', 'status', 'health', 'metrics',
  // 5 · superficie de phishing
  'login', 'logout', 'signin', 'signup', 'register', 'registro', 'salir',
  'auth', 'oauth', 'sso', 'account', 'cuenta', 'perfil', 'profile', 'password', 'reset',
  'verify', 'verificar', 'confirm', 'confirmar', 'seguridad', 'security', 'soporte', 'support',
  'billing', 'pagos', 'pago', 'checkout', 'invoice', 'factura', 'webhook', 'webhooks', 'cron',
  // 6 · artefactos del build
  PRERENDER_SEED_SLUG,
]);

/**
 * Los reservados que **nunca** son una vidriera: el proxy los manda a marketing sin tocar nada.
 *
 * Derivado, no escrito a mano: `RESERVED_SLUGS − TENANT_SERVED_RESERVED_SLUGS`. Agregar un nombre
 * a la lista canónica lo cierra en las dos caras de una sola vez, que es exactamente lo que no
 * pasaba cuando había dos listas.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set(
  [...RESERVED_SLUGS].filter((slug) => !TENANT_SERVED_RESERVED_SLUGS.has(slug)),
);

/**
 * ¿Este nombre está reservado y por lo tanto **no lo puede registrar nadie**?
 *
 * Lo usa la validación del alta. Recibe el slug ya normalizado (minúsculas, sin espacios): si le
 * llega `"WWW"` devuelve `false`, y por eso la normalización va **antes** de validar, nunca después.
 */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

/**
 * ¿Este subdominio **nunca** sirve una vidriera? Es la pregunta que hace el proxy, y la misma que
 * hace la DAL antes de salir a Postgres: que el proxy diga "`www` es marketing" y la capa de datos
 * igual pregunte por el tenant `www` deja abierto el camino que el proxy ya cerró.
 */
export function isReservedSubdomain(label: string): boolean {
  return RESERVED_SUBDOMAINS.has(label);
}
