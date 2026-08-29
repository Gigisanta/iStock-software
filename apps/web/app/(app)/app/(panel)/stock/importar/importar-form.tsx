'use client';

import { useActionState, useId } from 'react';
import { importCsvAction } from './actions';
import { initialImportState, type ImportFormState } from './form-state';

/**
 * El formulario de import. `"use client"` justificado y acotado: hay **una** interacción real, que
 * es el estado de envío. Importar 200 equipos tarda; sin feedback la persona aprieta el botón dos
 * veces y carga el stock dos veces. Ese es el motivo, y alcanza.
 *
 * **El markup postea sin JavaScript, pero la pantalla hoy no.** Es un `<form action={...}>` común
 * con un `<input type="file">`: no hay `onSubmit` con `preventDefault` en ningún lado, así que el
 * form en sí anda con un POST pelado y lo único que se pierde es el "Importando…" y el bloqueo del
 * botón. Lo que sí depende de JS es **verlo**: `page.tsx` tiene un `<Suspense>` de tope, y con
 * `cacheComponents` eso manda el contenido real adentro de un `<div hidden>` que recoloca un script
 * inline. Sin JS el form existe y está escondido. El precedente y el remedio están escritos en
 * `stock/[id]/fotos/page.tsx` (`export const instant = false`), y acá **no** se aplica a propósito:
 * esa excepción se justificó por una ruta que puede `notFound()` desde la URL, que no es este caso,
 * y ampliarla cambia el modo de servido que fija `scripts/guard-routes.sh`. Queda dicho en vez de
 * prometido al revés: la misma promesa está escrita de más en `nuevo/nueva-unidad-form.tsx`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El resultado tiene que ser imposible de confundir con un éxito
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Es la aceptación de S10 y es lo único que este componente hace además de mandar el archivo. Con
 * errores de fila, lo **primero** que se lee es *"No importamos nada"* en rojo, antes que cualquier
 * número — y el detalle dice cuántas filas estaban bien, para que quede claro que estar bien no
 * alcanzó. Un panel que mostrara "3 de 11 listas" arriba y la lista de errores abajo se lee como
 * un éxito parcial en un celular, que es exactamente el resultado que la slice prohíbe.
 *
 * Los techos y la plantilla bajan como props desde la página en vez de importarse acá: el schema
 * arrastra Zod, y Zod no tiene nada que hacer en el bundle del navegador cuando la validación que
 * decide corre en el server.
 */

export interface ImportarFormProps {
  readonly accept: string;
  readonly maxRows: number;
}

export function ImportarForm({ accept, maxRows }: ImportarFormProps) {
  const [state, formAction, isPending] = useActionState(importCsvAction, initialImportState);
  const fileId = useId();

  return (
    <div className="mt-2 space-y-5">
      <form data-testid="form-importar-csv" action={formAction} className="space-y-4" noValidate>
        <div>
          <label htmlFor={fileId} className="block text-sm font-medium">
            Archivo CSV
          </label>
          <input
            id={fileId}
            name="archivo"
            type="file"
            accept={accept}
            required
            className="mt-1.5 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white dark:border-neutral-700 dark:bg-neutral-900 dark:file:bg-white dark:file:text-neutral-900"
          />
          <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            Hasta {maxRows} equipos por archivo. Entran todos o no entra ninguno.
          </p>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-xl bg-neutral-900 px-6 py-3.5 text-base font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
        >
          {isPending ? 'Importando…' : 'Importar equipos'}
        </button>
      </form>

      <ImportResult state={state} />
    </div>
  );
}

/**
 * El resultado. Tres formas distintas para tres cosas distintas: nada se pinta con el mismo color
 * que otra. `role="status"` para el éxito y `role="alert"` para los fallos, porque esto se lee con
 * el teléfono en la mano y a veces con el lector de pantalla prendido.
 */
function ImportResult({ state }: { state: ImportFormState }) {
  if (state.status === 'idle') return null;

  if (state.status === 'file_error') {
    return (
      <div
        role="alert"
        data-testid="import-file-error"
        className="rounded-2xl border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950"
      >
        <p className="text-base font-semibold text-red-700 dark:text-red-300">
          No pudimos leer ese archivo
        </p>
        <p className="mt-1.5 text-sm text-red-700 dark:text-red-300">{state.message}</p>
      </div>
    );
  }

  if (state.status === 'imported') {
    return (
      <div
        role="status"
        data-testid="import-ok"
        className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      >
        <p className="text-base font-semibold">
          {state.imported === 1
            ? 'Importamos 1 equipo'
            : `Importamos ${String(state.imported)} equipos`}
        </p>
        <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300">
          Quedaron como borrador. Sumales las fotos y publicalos desde el stock.
        </p>
        {state.ignoredColumns.length > 0 ? (
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            No usamos estas columnas del archivo: {state.ignoredColumns.join(', ')}.
          </p>
        ) : null}
      </div>
    );
  }

  /**
   * `row_errors`. **Lo primero que se lee es que no entró nada.** El detalle —cuántas filas
   * estaban bien— va después y en letra chica, justamente para que no se pueda leer como un éxito
   * parcial: estar bien no alcanzó, porque el import es todo o nada.
   */
  return (
    <div
      role="alert"
      data-testid="import-row-errors"
      className="rounded-2xl border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950"
    >
      <p className="text-base font-semibold text-red-700 dark:text-red-300">
        No importamos nada: quedaron {state.rowCount === 1 ? '1 fila' : `${String(state.rowCount)} filas`} sin cargar
      </p>
      <p className="mt-1.5 text-sm text-red-700 dark:text-red-300">
        {state.okCount === 0
          ? 'Corregí lo de abajo en tu planilla y volvé a subir el archivo entero.'
          : `${String(state.okCount)} de ${String(state.rowCount)} filas estaban bien, pero entran todas o ninguna. Corregí lo de abajo y volvé a subir el archivo entero.`}
      </p>

      <ul className="mt-3 space-y-2">
        {state.issues.map((issue, index) => (
          <li
            key={`${String(issue.line)}-${issue.column ?? 'fila'}-${String(index)}`}
            className="rounded-xl bg-white p-3 text-sm dark:bg-neutral-900"
          >
            <span className="font-semibold">
              Fila {issue.line}
              {issue.column === null ? '' : ` · ${issue.column}`}
            </span>
            <span className="block text-neutral-700 dark:text-neutral-300">{issue.message}</span>
          </li>
        ))}
      </ul>

      {state.issueCount > state.issues.length ? (
        <p className="mt-3 text-sm text-red-700 dark:text-red-300">
          Y {String(state.issueCount - state.issues.length)} problemas más. Arreglá estos primero y
          volvé a subirlo.
        </p>
      ) : null}
    </div>
  );
}
