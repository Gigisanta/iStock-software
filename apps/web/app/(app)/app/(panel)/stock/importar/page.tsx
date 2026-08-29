import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CONDITION_HINT,
  CSV_ACCEPT_ATTR,
  MAX_CSV_ROWS,
  REQUIRED_CSV_FIELDS,
  csvTemplate,
} from '../../../../_lib/csv-import/schema';
import { requireTenant } from '../../../../_lib/session';
import { CopyButton } from '../../_ui/copy-button';
import { PageTitle } from '../../_ui/section';
import { ImportarForm } from './importar-form';

/**
 * `/app/stock/importar` — subir el Excel que el dueño ya tenía.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Para qué existe esta pantalla
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `CLAUDE.md` §1: *"Excel + estados de IG = el enemigo real"*. El ICP tiene 20–200 equipos **ya
 * cargados en una planilla**, y pedirle que los tipee de a uno en `/app/stock/nuevo` es pedirle
 * una tarde. Esta pantalla convierte esa tarde en un archivo.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Server Component, y la plantilla NO es una ruta
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lo único que manda JavaScript al cliente es el formulario (estado de envío) y el botón de
 * copiar. La plantilla se muestra como texto con un botón de copiar en vez de servirse desde un
 * `route.ts` que la descargue: una ruta nueva es una decisión de rate limit que hay que tomar
 * (`scripts/guard-firewall.sh` censa `apps/web/app` entero) y un endpoint más que mantener, todo
 * para entregar dos renglones de texto que el dueño va a pegar en su Excel igual. Se deriva de
 * `CSV_FIELDS` con `csvTemplate()`, así que no se puede desincronizar del parser.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  El rol decide la plantilla, del lado del server
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Al `seller` no se le ofrece la columna de costo (`CLAUDE.md` §0.9). No es la defensa —un archivo
 * con esa columna subido por un seller lo rechaza `importListingsFromCsv`, en el server— es no
 * invitarlo a un error que le vamos a rebotar.
 *
 * ── Autorización adentro de la página ────────────────────────────────────────────────────────
 * `requireTenant()` acá, no en el layout: un layout no vuelve a correr al navegar entre páginas
 * hermanas (ADR-007). Y la Server Action lo verifica por su cuenta: esta página no la protege.
 *
 * ── Sin `searchParams` ───────────────────────────────────────────────────────────────────────
 * La pantalla no lee nada de la URL. Es lo que la deja servirse igual que el resto del panel
 * (`resuming/initial` en `scripts/guard-routes.sh`) y, sobre todo, `/app/*` **jamás** se hornea
 * estático: contenido autenticado en un archivo que el CDN le sirve a cualquiera es una fuga
 * cross-tenant donde RLS ni se evalúa.
 */

export const metadata: Metadata = { title: 'Importar stock' };

export default function ImportarPage() {
  return (
    <Suspense fallback={<ImportarSkeleton />}>
      <ImportarContent />
    </Suspense>
  );
}

async function ImportarContent() {
  const { role } = await requireTenant();
  const template = csvTemplate(role === 'owner');

  return (
    <>
      <PageTitle hint="Subí la planilla que ya tenés y cargamos todos los equipos de una.">
        Importar stock
      </PageTitle>

      <ImportarForm accept={CSV_ACCEPT_ATTR} maxRows={MAX_CSV_ROWS} />

      <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-base font-semibold">Cómo tiene que ser el archivo</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-neutral-600 dark:text-neutral-300">
          <li>
            La primera fila son los nombres de las columnas. Obligatorias:{' '}
            <strong className="font-semibold">{REQUIRED_CSV_FIELDS.join(', ')}</strong>.
          </li>
          <li>El orden de las columnas no importa. Las que no usemos las ignoramos y te avisamos.</li>
          <li>Condición: {CONDITION_HINT}.</li>
          <li>Precio en dólares, sin puntos de miles. Poné 620 o 620,50.</li>
          <li>El modelo va escrito igual que en la lista de modelos del alta.</li>
          <li>Si un texto tiene una coma adentro, ponelo entre comillas.</li>
          <li>Desde Excel: Guardar como → CSV. No subas el .xlsx.</li>
        </ul>

        <p className="mt-4 text-sm font-medium">Plantilla</p>
        <pre className="mt-1.5 overflow-x-auto rounded-xl bg-neutral-100 p-3 text-xs dark:bg-neutral-950">
          {template}
        </pre>
        <div className="mt-2">
          <CopyButton value={template} label="Copiar la plantilla" />
        </div>
      </section>

      <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm font-semibold">Entran todos o no entra ninguno</p>
        <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300">
          Si alguna fila tiene un error, no cargamos nada y te decimos qué fila y por qué. Corregís
          la planilla y volvés a subir el mismo archivo, sin miedo a duplicar equipos.
        </p>
      </div>

      <p className="mt-6 text-center text-sm">
        <Link href="/app/stock" className="underline underline-offset-2">
          Volver al stock
        </Link>
      </p>
    </>
  );
}

function ImportarSkeleton() {
  return (
    <div className="space-y-3 pt-2" aria-hidden="true">
      <div className="h-9 w-48 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-14 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-[52px] animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-48 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
    </div>
  );
}
