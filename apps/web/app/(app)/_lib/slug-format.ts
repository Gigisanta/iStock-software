/**
 * Validación del slug del tenant. El slug es **tres cosas a la vez**, y por eso no se valida
 * "para que quede lindo":
 *
 * 1. Un **subdominio**: `{slug}.maat.work`.
 * 2. Un **cache tag**: `storefront:{slug}` (`ARCHITECTURE.md` §Cache). Los tags están scopeados a
 *    proyecto, no a dominio → un slug que colisiona purga la vidriera de otro.
 * 3. Un **segmento de path** en el rewrite del proxy: `/s/{slug}`.
 *
 * El regex es **el mismo** que la constraint `tenants_slug_format` de Postgres y el mismo que usa
 * `assertSlug()` de `@istock/domain`. Tres copias del mismo regex es una de más, pero acá el
 * borde necesita mensajes en castellano por campo y el dominio tira `DomainError`. Lo que no
 * puede pasar es que **diverjan**: si cambia uno, cambian los tres.
 *
 * NOTA para el LEAD: `RESERVED_SLUGS` debería vivir en `@istock/domain`, porque `proxy.ts`
 * (storefront-agent) necesita exactamente la misma lista para no rutear `www.maat.work` a un
 * tenant. Está pedido en el reporte; no lo escribo yo porque `packages/domain` no es mío.
 */

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 32;

/** Idéntico a `tenants_slug_format` en `packages/db/src/schema/tenants.ts`. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/u;

/**
 * Subdominios que no pueden ser de un tenant. Tres familias:
 * - **infraestructura** que ya existe o va a existir en `*.maat.work` (`www`, `api`, `cdn`, `img`);
 * - **rutas del producto** que confundirían al dueño (`app`, `panel`, `demo`, `precios`);
 * - **nombres con los que se hace phishing** contra nuestros propios usuarios (`login`, `pagos`,
 *   `soporte`, `seguridad`). Este tercer grupo es el que se olvida y es el que duele.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // infraestructura
  'www', 'api', 'cdn', 'img', 'imgs', 'image', 'images', 'static', 'assets', 'media', 'files',
  'mail', 'email', 'smtp', 'imap', 'pop', 'ftp', 'ns', 'ns1', 'ns2', 'dns', 'mx', 'vpn',
  'proxy', 'edge', 'origin', 'db', 'database', 'redis', 'cache', 'ws', 'wss', 'grafana',
  // plataforma y marca
  'maat', 'maatwork', 'istock', 'vercel', 'supabase', 'cloudflare', 'r2', 'mercadopago', 'mp',
  // producto y rutas del panel
  'app', 'apps', 'panel', 'dashboard', 'admin', 'administrador', 'root', 'system', 'internal',
  'demo', 'test', 'testing', 'dev', 'develop', 'staging', 'stage', 'preview', 'sandbox',
  'beta', 'alpha', 'next', 'new', 'old', 'legacy', 'status', 'health', 'metrics',
  's', 'p', 'store', 'storefront', 'shop', 'tienda', 'vidriera', 'catalogo', 'catalog',
  'precios', 'pricing', 'planes', 'plans', 'blog', 'docs', 'doc', 'ayuda', 'help', 'faq',
  'contacto', 'contact', 'about', 'nosotros', 'legal', 'terminos', 'terms', 'privacidad',
  'privacy', 'cookies',
  // superficie de phishing contra nuestros propios usuarios
  'login', 'logout', 'signin', 'signup', 'register', 'registro', 'ingresar', 'salir',
  'auth', 'oauth', 'sso', 'account', 'cuenta', 'perfil', 'profile', 'password', 'reset',
  'verify', 'verificar', 'confirm', 'confirmar', 'seguridad', 'security', 'soporte', 'support',
  'billing', 'pagos', 'pago', 'checkout', 'invoice', 'factura', 'webhook', 'webhooks', 'cron',
]);

/** `"  MiTienda "` → `"mitienda"`. Se normaliza antes de validar, no después. */
export function normalizeSlug(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase();
}

/**
 * Sugerencia a partir del nombre del negocio: `"Norte Cel Cipolletti"` → `"norte-cel-cipolletti"`.
 * Es **sólo** una ayuda de UI. Lo que se guarda es lo que pasa por `slugSchema`, siempre.
 */
export function suggestSlug(businessName: string): string {
  const base = businessName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/gu, '');

  return SLUG_PATTERN.test(base) && !RESERVED_SLUGS.has(base) ? base : '';
}
