/**
 * Piezas de UI compartidas del panel. Server Components: cero JavaScript al cliente.
 *
 * `NotReadyYet` existe para que el esqueleto **no mienta**. La alternativa habitual —dibujar una
 * tabla con datos de ejemplo— hace que el dueño crea que perdió su stock cuando la tabla se
 * vacíe. Una pantalla que dice "esto todavía no está" es más barata y más honesta que una demo
 * disfrazada de producto.
 */

export function PageTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="pb-4 pt-2">
      <h1 className="text-2xl font-bold tracking-tight">{children}</h1>
      {hint === undefined ? null : (
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{hint}</p>
      )}
    </div>
  );
}

export function NotReadyYet({ what }: { what: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center dark:border-neutral-700 dark:bg-neutral-900">
      <p className="text-base font-semibold">Todavía no está lista</p>
      <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300">{what}</p>
      <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
        Te avisamos por mail apenas la habilitemos.
      </p>
    </div>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      {children}
    </div>
  );
}

/** Fila de dato en la pantalla de ajustes. Etiqueta arriba, valor abajo: entra en un teléfono. */
export function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-neutral-100 py-3 last:border-b-0 dark:border-neutral-800">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-base">{value}</dd>
    </div>
  );
}
