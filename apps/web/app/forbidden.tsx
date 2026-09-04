import Link from 'next/link';

export default function Forbidden() {
  return (
    <main className="account-shell" data-auth="forbidden">
      <section className="account-panel" aria-labelledby="forbidden-title">
        <Link href="/" className="marketing-brand marketing-logo" aria-label="iStock">
          <img src="/brand/logo-horizontal.svg" alt="" width="140" height="28" />
        </Link>
        <p className="mt-8 text-sm font-semibold uppercase tracking-[0.16em]">Acceso restringido</p>
        <h1 id="forbidden-title" className="mt-3">
          No tenés permiso para ver esta pantalla
        </h1>
        <p className="mt-3">
          Esta sección es sólo para la persona dueña del negocio. Tu sesión sigue abierta y podés
          volver al panel.
        </p>
        <Link
          href="/app"
          className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-neutral-950 px-5 text-base font-semibold text-neutral-50 transition-transform duration-200 hover:-translate-y-0.5 dark:bg-neutral-100 dark:text-neutral-950"
        >
          Volver al panel
        </Link>
      </section>
    </main>
  );
}
