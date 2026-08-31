import 'server-only';
import type { SelectedPlan } from './selected-plan';

/**
 * Puerto de autenticación. **Una interfaz, dos drivers**: `supabase` (SSR real) y `local` (cookie
 * firmada + Postgres local, sólo desarrollo).
 *
 * El puerto existe por una razón concreta, no por purismo: sin credenciales de Supabase el panel
 * tenía que quedar sin escribirse o escribirse contra un mock que después se tira. Con el puerto,
 * lo que se escribe una vez es el **flujo** —quién sos, a qué tenant pertenecés, con qué rol— y lo
 * que cambia cuando llegue B2 es un solo archivo.
 *
 * Lo que el puerto **no** hace, a propósito:
 * - No decide autorización. Eso pasa dentro de cada Server Function (`_lib/session.ts`).
 *   `ARCHITECTURE.md`: *"El proxy no es un control de acceso"*, y por la misma razón tampoco lo es
 *   una capa de auth genérica.
 * - No devuelve el tenant. El tenant sale de `memberships`, que es la fuente de verdad (ADR-005),
 *   y se re-lee en cada request porque **el claim queda stale hasta 3600 s**.
 */

export type MembershipRole = 'owner' | 'seller';

/** Quién es la persona. Nada de esto es autorización. */
export interface AuthIdentity {
  /** = `auth.users.id` de Supabase. Es el `sub` del JWT y lo que lee `auth.uid()`. */
  readonly userId: string;
  readonly email: string;
  readonly fullName: string | null;
}

export interface SignInInput {
  readonly email: string;
  /** Plan elegido antes del login; sólo se usa para construir un callback cerrado. */
  readonly selectedPlan: SelectedPlan | null;
}

export type SignInResult =
  | { readonly ok: true; readonly status: 'signed_in'; readonly identity: AuthIdentity }
  | { readonly ok: true; readonly status: 'link_sent' }
  | { readonly ok: false; readonly code: AuthErrorCode; readonly message: string };

export type AuthErrorCode =
  | 'DRIVER_NOT_CONFIGURED'
  | 'INVALID_EMAIL'
  | 'RATE_LIMITED'
  | 'BACKEND_UNAVAILABLE';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export interface AuthDriver {
  readonly name: 'local' | 'supabase';

  /**
   * `true` si el driver da de alta usuarios sin verificar el mail. La UI **tiene que decirlo**:
   * una pantalla de login que miente sobre lo que hace es una promesa falsa, y las promesas
   * falsas están prohibidas incluso en el skeleton.
   */
  readonly isDevelopmentOnly: boolean;

  /** Identidad del request actual, o `null` si no hay sesión. Nunca tira por falta de sesión. */
  currentIdentity(): Promise<AuthIdentity | null>;

  signIn(input: SignInInput): Promise<SignInResult>;

  signOut(): Promise<void>;

  /**
   * Propaga `app_metadata.tenant_id` al proveedor de identidad después de crear el tenant.
   *
   * **`app_metadata`, jamás `user_metadata`** (`CLAUDE.md` §2, lint `0015` de Supabase, severidad
   * ERROR): el usuario puede escribir su propio `user_metadata`, así que un `tenant_id` ahí es
   * escalación de tenant directa. La firma de este método no acepta otro destino.
   */
  syncTenantClaim(userId: string, tenantId: string): Promise<void>;
}

/**
 * Claims tal como los ve Postgres en `request.jwt.claims`. Es **exactamente** la forma que
 * emula `scripts/pg-local.sh` y la que produce el Custom Access Token Hook de Supabase.
 *
 * El tipo no tiene `user_metadata`. No es un olvido: si el campo no existe, nadie puede meter
 * `tenant_id` ahí por descuido.
 */
export interface JwtClaims {
  readonly sub: string;
  readonly role: 'authenticated';
  readonly app_metadata: { readonly tenant_id: string };
}

export function buildJwtClaims(userId: string, tenantId: string): JwtClaims {
  return { sub: userId, role: 'authenticated', app_metadata: { tenant_id: tenantId } };
}
