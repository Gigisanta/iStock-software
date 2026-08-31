import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  selectedPlanFromSearchParams,
  SUBSCRIPTION_REDIRECTS,
} from '../../../(app)/_lib/auth/selected-plan';
import { exchangeSupabaseCodeForSession } from '../../../(app)/_lib/auth/supabase-driver';

const codeSchema = z.string().trim().min(1).max(2048);

function invalidLink(): never {
  redirect('/ingresar?error=link_invalido');
}

/**
 * Entrada del magic link de Supabase. El código se canjea acá, en server, para que las cookies
 * SSR queden sincronizadas. El plan sólo puede elegir uno de los dos destinos constantes.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const codeValues = url.searchParams.getAll('code');
  const code = codeValues.length === 1 ? codeSchema.safeParse(codeValues[0]) : null;
  const planValues = url.searchParams.getAll('plan');
  const planInput =
    planValues.length === 0
      ? {}
      : { plan: planValues.length === 1 ? planValues[0] : planValues };
  const selectedPlan = selectedPlanFromSearchParams(planInput);

  if (code === null || !code.success) invalidLink();

  try {
    await exchangeSupabaseCodeForSession(code.data);
  } catch {
    invalidLink();
  }

  redirect(selectedPlan === null ? '/app' : SUBSCRIPTION_REDIRECTS[selectedPlan]);
}
