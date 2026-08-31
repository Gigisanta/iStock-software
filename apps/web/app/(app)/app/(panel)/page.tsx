import { Suspense } from 'react';
import Link from 'next/link';
import { storefrontHostForSlug, storefrontUrlForSlug } from '../../_lib/env';
import { requireTenant } from '../../_lib/session';
import { trialSubscriptionCta, type TrialSubscriptionCta } from '../../_lib/subscription-cta';
import { trialDaysLeft } from '../../_lib/tenants/queries';
import { CopyLinkButton } from './_ui/copy-link-button';
import { Card, PageTitle } from './_ui/section';

/**
 * Inicio del panel.
 *
 * Lo primero que se ve es el **link de la vidriera**, no un gráfico de ventas. El producto es que
 * ese link llegue a un estado de Instagram; todo lo demás del panel existe para alimentarlo. Un
 * dashboard con métricas antes de que haya un solo equipo cargado es decoración.
 *
 * Las tarjetas dicen "todavía no" con todas las letras. En el esqueleto eso es la información más
 * útil que hay: evita que el dueño busque durante diez minutos un botón que no existe.
 */

export default function PanelHomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <PanelHome />
    </Suspense>
  );
}

async function PanelHome() {
  // Autorización adentro de la página, no en el layout ni en el proxy (ADR-007).
  const { tenant, identity, role } = await requireTenant();

  const daysLeft = trialDaysLeft(tenant.trialEndsAt);
  const subscriptionCta = trialSubscriptionCta(daysLeft);
  const storefront = storefrontUrlForSlug(tenant.slug);
  const firstName = identity.fullName ?? identity.email.split('@')[0] ?? '';

  return (
    <>
      <PageTitle>Hola{firstName === '' ? '' : `, ${firstName}`}</PageTitle>

      {tenant.plan === 'trial' && subscriptionCta !== null ? (
        <SubscriptionPrompt cta={subscriptionCta} />
      ) : null}

      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Tu vidriera
        </p>
        <a
          href={storefront}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block break-all text-lg font-semibold underline-offset-2 hover:underline"
        >
          {storefrontHostForSlug(tenant.slug)}
        </a>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          Este es el link que pegás en tu estado. Todavía no muestra equipos porque no cargaste
          ninguno.
        </p>
        <div className="mt-3">
          <CopyLinkButton url={storefront} />
        </div>
      </Card>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Tu día a día
      </h2>

      <div className="mt-2 grid grid-cols-2 gap-3">
        <Tile href="/app/stock" title="Stock" note="Cargá tus equipos y sus fotos" />
        <Tile href="/app/canjes" title="Canjes" note="Todavía no" />
        <Tile href="/app/ajustes" title="Ajustes" note="Ver los datos de tu negocio" />
        <div className="flex min-h-[92px] flex-col justify-between rounded-2xl border border-dashed border-neutral-300 bg-white p-4 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
          <span className="text-base font-semibold">Vendedores</span>
          <span className="text-xs">Sumar gente: en camino</span>
        </div>
      </div>

      <p className="mt-6 text-xs text-neutral-500 dark:text-neutral-400">
        Entraste como {role === 'owner' ? 'dueño' : 'vendedor'}.
      </p>
    </>
  );
}

function SubscriptionPrompt({ cta }: { cta: TrialSubscriptionCta }) {
  return (
    <aside
      aria-labelledby="subscription-prompt-title"
      className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-4 dark:border-amber-800/60 dark:bg-amber-950/30"
    >
      <h2 id="subscription-prompt-title" className="text-base font-semibold">
        {cta.title}
      </h2>
      <p className="mt-1 text-sm">{cta.message}</p>
      {cta.reassurance === null ? null : (
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">{cta.reassurance}</p>
      )}
      <nav aria-label="Elegí tu plan" className="mt-3 grid gap-2 sm:grid-cols-2">
        {cta.plans.map((plan) => (
          <Link
            key={plan.tier}
            href={plan.href}
            className="rounded-xl bg-neutral-900 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {plan.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

function Tile({ href, title, note }: { href: '/app/stock' | '/app/canjes' | '/app/ajustes'; title: string; note: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-[92px] flex-col justify-between rounded-2xl border border-neutral-200 bg-white p-4 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
    >
      <span className="text-base font-semibold">{title}</span>
      <span className="text-xs text-neutral-500 dark:text-neutral-400">{note}</span>
    </Link>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-3 pt-2" aria-hidden="true">
      <div className="h-9 w-48 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-40 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-24 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
    </div>
  );
}
