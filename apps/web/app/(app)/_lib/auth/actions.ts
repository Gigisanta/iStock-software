'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { authDriver } from './driver';
import type { AuthFormState } from './form-state';
import { AuthError } from './types';

/**
 * Server Actions de sesión.
 *
 * **La validación y la autorización viven acá adentro, no en `proxy.ts`.** ADR-007: un `matcher`
 * que excluye un path también saltea las Server Functions de ese path, así que un guard en el
 * proxy protegería la página y dejaría la acción abierta. Toda acción de este repo se valida sola.
 *
 * `redirect()` funciona tirando una excepción especial. Por eso **nada de `try/catch` alrededor**:
 * un catch se la come y la navegación no ocurre.
 */

const signInSchema = z.object({
  email: z
    .string({ error: 'Escribí tu mail.' })
    .transform((raw) => raw.trim().toLowerCase())
    .pipe(z.email('Ese mail no parece válido.').max(254)),
});

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  // Zod en el borde: `formData.get()` devuelve `FormDataEntryValue | null`, o sea `unknown` útil.
  const parsed = signInSchema.safeParse({ email: formData.get('email') });
  const typed = typeof formData.get('email') === 'string' ? String(formData.get('email')) : '';

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Revisá el mail.', email: typed };
  }

  let result: Awaited<ReturnType<ReturnType<typeof authDriver>['signIn']>>;
  try {
    result = await authDriver().signIn({ email: parsed.data.email });
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message, email: typed };
    return {
      error: 'No pudimos conectarnos. Probá de nuevo en un minuto.',
      email: typed,
    };
  }

  if (!result.ok) return { error: result.message, email: typed };

  redirect('/app');
}

export async function signOutAction(): Promise<void> {
  await authDriver().signOut();
  redirect('/');
}
