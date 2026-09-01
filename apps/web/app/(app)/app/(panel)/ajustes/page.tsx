import { Suspense } from 'react';
import type { Metadata } from 'next';
import { storefrontHostForSlug, storefrontUrlForSlug } from '../../../_lib/env';
import { requireTenant } from '../../../_lib/session';
import { loadTenantSettings } from '../../../_lib/tenants/queries';
import { Card, DataRow, NotReadyYet, PageTitle } from '../_ui/section';

/**
 * Ajustes. Es la única pantalla del esqueleto que **lee datos de negocio**, y por eso es la que
 * demuestra el camino completo:
 *
 *   página → `requireTenant()` → `withTenantDb(ctx)` → `set local role authenticated`
 *          → `set_config('request.jwt.claims', …)` → `select` con `where tenant_id = …`
 *
 * O sea: RLS activa **y** filtro explícito, las dos cosas, como pide `CLAUDE.md` §2. Si mañana
 * `qa-agent` quiere probar aislamiento cruzado desde la app y no desde SQL, este es el camino que
 * tiene que romper.
 *
 * Todo se muestra de sólo lectura a propósito. Editar el nombre o el WhatsApp es una mutación que
 * cambia lo que se ve en la vidriera, así que arrastra `revalidateTag('storefront:{slug}')` y
 * merece su propia slice con su propio test. El slug directamente **no se edita nunca**: es
 * inmutable después del alta (`DOMAIN.md` §Glosario) porque ya está pegado en estados de
 * Instagram y en chats de WhatsApp que no controlamos.
 */

export const metadata: Metadata = { title: 'Ajustes' };

const PLAN_LABEL: Record<'trial' | 'base' | 'negocio', string> = {
  trial: 'Prueba',
  base: 'Base',
  negocio: 'Negocio',
};

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />}>
      <SettingsContent />
    </Suspense>
  );
}

async function SettingsContent() {
  const { ctx, role, identity } = await requireTenant();
  const settings = await loadTenantSettings(ctx);

  if (settings === null) {
    return (
      <>
        <PageTitle>Ajustes</PageTitle>
        <NotReadyYet what="No pudimos leer los datos de tu negocio. Probá de nuevo en un minuto." />
      </>
    );
  }

  return (
    <>
      <PageTitle>Ajustes</PageTitle>

      <Card>
        <dl>
          <DataRow label="Negocio" value={settings.name} />
          <DataRow
            label="Link de la vidriera"
            value={
              <a
                href={storefrontUrlForSlug(settings.slug)}
                target="_blank"
                rel="noreferrer"
                className="break-all underline-offset-2 hover:underline"
              >
                {storefrontHostForSlug(settings.slug)}
              </a>
            }
          />
          <DataRow label="WhatsApp del negocio" value={`+${settings.waPhone}`} />
          <DataRow label="Tomás equipos en canje" value={settings.acceptsTradeIn ? 'Sí' : 'No'} />
          <DataRow
            label="Medios de pago"
            value={
              settings.paymentMethods.length === 0
                ? 'Todavía no cargaste ninguno'
                : settings.paymentMethods.join(' · ')
            }
          />
          <DataRow label="Plan" value={PLAN_LABEL[settings.plan]} />
          <DataRow label="Tu rol" value={role === 'owner' ? 'Dueño' : 'Vendedor'} />
          <DataRow label="Tu cuenta" value={identity.email} />
        </dl>
      </Card>

      <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
        El link de tu vidriera no se puede cambiar: ya lo mandaste por WhatsApp y esos mensajes
        quedan para siempre.
      </p>

      <div className="mt-6">
        <NotReadyYet what="Editar estos datos y los puntos de retiro llega en la próxima entrega. La cotización se actualiza automáticamente una vez por día." />
      </div>
    </>
  );
}
