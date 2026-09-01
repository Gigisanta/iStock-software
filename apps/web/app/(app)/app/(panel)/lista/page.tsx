import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { buildStockList, type StockList } from '@istock/domain';
import { storefrontUrlForSlug } from '../../../_lib/env';
import { logError } from '../../../_lib/log';
import { requireTenant } from '../../../_lib/session';
import { buildStockListInput, resolveFx } from '../../../_lib/stock-list/build-input';
import {
  STOCK_LIST_MAX_UNITS,
  listPublishedUnitsForStockList,
} from '../../../_lib/stock-list/queries';
import { loadFxSettings } from '../../../_lib/tenants/queries';
import { CopyButton } from '../_ui/copy-button';
import { Card, PageTitle } from '../_ui/section';

/**
 * `/app/lista` — el texto que el dueño pega en un estado de Instagram o en una difusión.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Qué reemplaza, que es lo que decide cómo se ve
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hoy el dueño escribe esa lista a mano, todas las noches, en el teclado del teléfono o copiando
 * de un Excel. Entonces esta pantalla no es un reporte: es **un botón por bloque y el texto
 * arriba**. Entra al panel desde el teléfono, toca una vez, y lo tiene en el portapapeles. Todo lo
 * que se interponga entre esos dos hechos sobra.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Un botón por bloque, y por qué NO hay un "copiar todo"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `buildStockList` corta en bloques porque 200 equipos no entran ni en un estado ni en un mensaje
 * de WhatsApp (techo real, 4096). Un botón que junte los N bloques devolvería exactamente el blob
 * que el dominio se tomó el trabajo de no devolver, y la persona lo cortaría con el dedo por el
 * medio de un link. Se pega de a uno porque se publica de a uno.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Server Component
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lo único que manda JavaScript al cliente son los botones de copiar (`CopyButton`), que tocan el
 * portapapeles. El texto se arma en el server y viaja renderizado: `CLAUDE.md` §3, RSC por
 * default. Autorización adentro de la página con `requireTenant()`, no en el layout ni en el
 * proxy (ADR-007) — y **sin gate de plan**: la lista es de los dos planes, Base es *"sin
 * chatbot"*, no *"sin lista"*.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Costo
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Dos queries en el peor caso (unidades + TC), tres sólo si se toca el techo de 100. Cero
 * imágenes: esta pantalla es texto. No hay cache y no debe haberla — el dueño entra justo después
 * de cargar un equipo y una lista de hace cinco minutos le haría publicar stock viejo.
 */

export const metadata: Metadata = { title: 'Lista para estados' };

export default function StockListPage() {
  return (
    <Suspense fallback={<StockListSkeleton />}>
      <StockListContent />
    </Suspense>
  );
}

async function StockListContent() {
  const { ctx, tenant } = await requireTenant();

  // Secuencial y no `Promise.all`: el pool del panel es `max: 1` (`_lib/db/connection.ts`), así
  // que las encolaría igual y la forma concurrente sólo agregaría ruido.
  const published = await listPublishedUnitsForStockList(ctx);
  const fx = resolveFx(await loadFxSettings(ctx));

  return (
    <>
      <PageTitle hint="El texto de tu stock, listo para pegar en un estado de Instagram o en una difusión de WhatsApp.">
        Lista para estados
      </PageTitle>

      {published.rows.length === 0 ? (
        <EmptyState />
      ) : (
        <StockListBlocks
          businessName={tenant.name}
          slug={tenant.slug}
          published={published}
          fx={fx}
          tenantId={tenant.id}
        />
      )}
    </>
  );
}

interface StockListBlocksProps {
  readonly businessName: string;
  readonly slug: string;
  readonly published: Awaited<ReturnType<typeof listPublishedUnitsForStockList>>;
  readonly fx: ReturnType<typeof resolveFx>;
  readonly tenantId: string;
}

function StockListBlocks({ businessName, slug, published, fx, tenantId }: StockListBlocksProps) {
  /**
   * `now` se calcula **una vez** para toda la lista: `@istock/domain` tiene `Date.now()` prohibido
   * y el encabezado se repite en cada bloque. Dos bloques fechados distinto es un bug visible en
   * el único dato de frescura que lleva el texto.
   */
  const now = new Date();

  let list: StockList;
  try {
    list = buildStockList(
      buildStockListInput({
        businessName,
        slug,
        storefrontBaseUrl: storefrontUrlForSlug(slug),
        rows: published.rows,
        fx,
        now,
      }),
    );
  } catch {
    /**
     * `buildStockList` tira ante datos que no se pueden publicar: el nombre del negocio en blanco
     * o de más de 120 caracteres, o un equipo con el título vacío. Se prefiere fallar a truncar
     * (lo dice su docblock), y acá se prefiere **una tarjeta** a un 500: el resto del panel sigue
     * andando y el dueño lee qué mirar.
     *
     * El `Error` no se loguea: sus mensajes citan el input crudo —el nombre del negocio, el título
     * del equipo, la URL— y eso es contenido de negocio en los logs de Vercel para siempre
     * (`CLAUDE.md` §2). Van el id del tenant y cuántas unidades había, nada más.
     */
    logError('stock_list.build_failed', 'domain_stock_list_invalid', {
      tenantId,
      units: published.rows.length,
    });
    return (
      <Card>
        <p className="text-base font-semibold">No pudimos armar la lista</p>
        <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300">
          Suele ser el nombre del negocio (muy largo o vacío) o un equipo publicado con el título en
          blanco. Revisalo y volvé a entrar.
        </p>
        <div className="mt-3">
          <Link href="/app/stock" className="text-sm font-semibold underline underline-offset-2">
            Ver mi stock
          </Link>
        </div>
      </Card>
    );
  }

  const truncated = published.total > list.unitCount;

  return (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {list.unitCount === 1 ? '1 equipo' : `${String(list.unitCount)} equipos`}
        {' · '}
        {list.blocks.length === 1 ? '1 bloque' : `${String(list.blocks.length)} bloques`}
      </p>

      {fx === null ? (
        <Note>
          Todavía no tenemos la cotización sincronizada, así que la lista sale sólo en dólares.
          Volvé a intentarlo en unos minutos para verla con los dos precios.
        </Note>
      ) : null}

      {truncated ? (
        <Note>
          Tenés {String(published.total)} equipos publicados y la lista arma los primeros{' '}
          {String(STOCK_LIST_MAX_UNITS)}. Están primero los disponibles.
        </Note>
      ) : null}

      <ul className="mt-4 space-y-4">
        {list.blocks.map((block) => (
          <li key={block.index}>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                {block.total === 1
                  ? 'La lista'
                  : `Bloque ${String(block.index)} de ${String(block.total)}`}
                {' · '}
                {block.unitCount === 1 ? '1 equipo' : `${String(block.unitCount)} equipos`}
              </p>

              {/*
                El texto se muestra entero y tal cual se copia. No es decoración: es el único
                camino que le queda al dueño si el portapapeles no está disponible (ver
                `copy-button.tsx`), y además es lo que le deja ver qué va a publicar antes de
                publicarlo. `whitespace-pre-wrap` conserva los renglones del dominio; `break-words`
                evita que un link largo empuje la pantalla a lo ancho en un teléfono.
              */}
              <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-neutral-50 p-3 text-[13px] leading-relaxed text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
                {block.text}
              </pre>

              {block.overBudget ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  Este equipo solo ocupa más de lo recomendado para un estado. Lo dejamos igual:
                  nunca sacamos un equipo de tu lista.
                </p>
              ) : null}

              <div className="mt-3">
                <CopyButton
                  value={block.text}
                  label={
                    block.total === 1
                      ? 'Copiar la lista'
                      : `Copiar bloque ${String(block.index)} de ${String(block.total)}`
                  }
                />
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
        Cada bloque entra en una publicación. Copiá uno, pegalo, y si querés seguí con el
        siguiente. Los links van a la ficha de cada equipo, con las fotos y el botón de WhatsApp.
      </p>
    </>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800/60 dark:bg-amber-950/30">
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center dark:border-neutral-700 dark:bg-neutral-900">
      <p className="text-base font-semibold">Todavía no publicaste ningún equipo</p>
      <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300">
        Cargá uno con sus fotos y publicalo: acá te armamos el texto para pegar en tu estado.
      </p>
      <div className="mt-4">
        <Link
          href="/app/stock"
          className="flex min-h-[52px] w-full items-center justify-center rounded-xl bg-neutral-900 px-6 text-base font-semibold text-white dark:bg-white dark:text-neutral-900"
        >
          Ir a mi stock
        </Link>
      </div>
    </div>
  );
}

function StockListSkeleton() {
  return (
    <div className="space-y-3 pt-2" aria-hidden="true">
      <div className="h-9 w-56 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-4 w-32 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-64 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="h-64 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
    </div>
  );
}
