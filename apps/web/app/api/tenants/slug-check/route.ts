import { z } from 'zod';
import { getPanelSession } from '../../../(app)/_lib/session';
import { slugSchema } from '../../../(app)/_lib/slug';
import { isSlugTaken } from '../../../(app)/_lib/tenants/create-tenant';

/**
 * `GET /api/tenants/slug-check?slug=…` — ¿está libre el link de la vidriera?
 *
 * ── Por qué exige sesión ──────────────────────────────────────────────────────────────────────
 * El dato en sí no es secreto: los slugs son subdominios públicos, cualquiera puede probar
 * `loquesea.maat.work` y ver si existe. Lo que se protege no es el dato, es la **query**. Sin
 * sesión esto es un enumerador de tenants que pega una vez a Postgres por request, gratis, desde
 * cualquier IP. `docs/research/threats.md` y `ARCHITECTURE.md` dicen lo mismo desde el otro lado:
 * lo que se defiende es lo que cuesta plata.
 *
 * ── Por qué la verificación está ACÁ y no en el proxy ─────────────────────────────────────────
 * ADR-007: el `matcher` de `proxy.ts` no es control de acceso, y además un matcher que excluye un
 * path también saltea las Server Functions de ese path. Cada handler se defiende solo.
 *
 * ── Costo ─────────────────────────────────────────────────────────────────────────────────────
 * Una query indexada (`tenants_slug_key`) por llamada. El formulario que lo consume **debouncea a
 * 600 ms y sólo pregunta si el slug ya es válido de forma**, así que escribir "nortecel" son 1–2
 * llamadas, no 8. Es la diferencia entre un endpoint de conveniencia y un martillo sobre la base.
 *
 * ── Nota de seguridad, para cuando esto crezca ────────────────────────────────────────────────
 * `CLAUDE.md` §2 prohíbe rate limiting con contador en Postgres **sobre la vidriera**. Este
 * endpoint no es la vidriera: es panel autenticado, y ahí un contador en Postgres sí es legítimo.
 * Hoy no hace falta.
 */

const querySchema = z.object({ slug: slugSchema });

export async function GET(request: Request): Promise<Response> {
  // 1. Autorización primero: no se toca la base sin sesión.
  const session = await getPanelSession();
  if (session === null) {
    return Response.json(
      { error: 'Necesitás iniciar sesión.' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  }

  // 2. Zod en el borde. `searchParams` es input del usuario igual que un body.
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({ slug: params.get('slug') ?? '' });

  if (!parsed.success) {
    return Response.json(
      {
        available: false,
        reason: parsed.error.issues[0]?.message ?? 'Ese link no sirve como dirección.',
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }

  const taken = await isSlugTaken(parsed.data.slug);

  return Response.json(
    {
      slug: parsed.data.slug,
      available: !taken,
      reason: taken ? 'Ese link ya lo está usando otro negocio.' : null,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
