/**
 * Estado de los formularios de sesión.
 *
 * Vive fuera de `actions.ts` por una restricción real del compilador, no por gusto: **un archivo
 * `'use server'` sólo puede exportar funciones async**. Un `export const` ahí rompe el build con
 * un mensaje que no dice esto.
 */

export interface AuthFormState {
  readonly error: string | null;
  /** Se re-muestra en el input para que la persona no lo escriba de nuevo. */
  readonly email: string;
}

export const initialAuthFormState: AuthFormState = { error: null, email: '' };
