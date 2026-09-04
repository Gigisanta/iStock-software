import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requestRootDomain, storefrontHostForSlug, storefrontUrlForPanel } from '../../../_lib/env';
import { requireTenant } from '../../../_lib/session';
import { panelStorefrontLabel, panelTenantName } from '../../../_lib/tenants/panel-identity';
import { loadTenantSettings } from '../../../_lib/tenants/queries';
import { PLAN_CATALOG } from '../../../../(billing)/_lib/plans';
import { SettingsForm } from './settings-form';
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
 * La ficha de identidad de arriba deja visible el estado actual y el formulario de abajo permite
 * al dueño corregir lo que sí cambia en el mostrador: nombre, WhatsApp, medios de pago, canje y
 * retiro. La mutación arrastra `invalidateStorefront(slug)` después del commit para que el link
 * que ya pegó en un estado muestre los datos nuevos sin esperar un TTL. El slug directamente **no
 * se edita nunca**: es inmutable después del alta (`DOMAIN.md` §Glosario) porque ya está pegado en
 * estados de Instagram y en chats de WhatsApp que no controlamos. El TC tampoco se escribe a mano:
 * lo actualiza el proceso automático diario con la referencia oficial del BCRA.
 */

export const metadata: Metadata = { title: 'Ajustes' };

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
  const domain = await requestRootDomain();

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
          <DataRow label="Negocio" value={panelTenantName(settings)} />
          <DataRow
            label="Link de la vidriera"
            value={
              <a
                href={storefrontUrlForPanel(settings, domain)}
                target="_blank"
                rel="noreferrer"
                className="break-all underline-offset-2 hover:underline"
              >
                {panelStorefrontLabel(settings, storefrontHostForSlug(settings.slug, domain))}
              </a>
            }
          />
          <DataRow label="WhatsApp del negocio" value={`+${settings.waPhone}`} />
          <DataRow label="Tomás equipos en canje" value={settings.acceptsTradeIn ? 'Sí' : 'No'} />
          <DataRow label="Duración inicial de reserva" value={`${String(settings.reservationMinutes)} minutos`} />
          <DataRow
            label="Medios de pago"
            value={
              settings.paymentMethods.length === 0
                ? 'Todavía no cargaste ninguno'
                : settings.paymentMethods.join(' · ')
            }
          />
          <DataRow label="Plan" value={PLAN_CATALOG[settings.plan].label} />
          <DataRow label="Tu rol" value={role === 'owner' ? 'Dueño' : 'Vendedor'} />
          <DataRow label="Tu cuenta" value={settings.isDemo ? 'Cuenta del panel' : identity.email} />
        </dl>
      </Card>

      {role === 'owner' ? (
        <SettingsForm settings={settings} />
      ) : (
        <p className="mt-6 rounded-2xl border border-dashed border-neutral-300 p-4 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
          Sólo la persona dueña del negocio puede cambiar estos datos.
        </p>
      )}

      <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
        El link de tu vidriera no se puede cambiar: ya lo mandaste por WhatsApp y esos mensajes
        quedan para siempre. La cotización se actualiza automáticamente una vez por día.
      </p>
    </>
  );
}
