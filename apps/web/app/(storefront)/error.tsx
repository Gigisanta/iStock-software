'use client';

/**
 * **El backstop de la vidriera: ningún throw de render vuelve a quedar como un stream abierto.**
 *
 * ## Por qué existe (hallazgo HIGH del adversary de S1, reproducido con `curl`)
 * `(storefront)` no tenía `error.tsx` ni `global-error.tsx`, en ningún nivel. Bajo
 * `cacheComponents` + PPR eso no da un 500: el shell parcial **ya salió con `200`**, así que un
 * throw durante el resume deja el body abierto para siempre. Medido: `200`, 8661 bytes, `no-store`
 * —el CDN nunca lo absorbe—, `curl` cortando por timeout y el error loggeado 12 veces. En Vercel
 * eso es hasta 300 s de Active CPU facturados por **una** request anónima, y el disparador era una
 * URL que cualquiera puede escribir.
 *
 * La causa concreta ya está arreglada en su raíz (el slug se valida **antes** de `cacheTag()`, ver
 * `s/[slug]/page.tsx` y `_lib/tenant.ts`). Este archivo no arregla esa causa: arregla la
 * **consecuencia**, que es lo que la convertía en un problema de plata en vez de un 500. La próxima
 * excepción de render va a venir de otro lado —una columna nueva que llega `null`, un `JSON.parse`
 * de un campo del dueño— y tiene que cerrar el stream igual.
 *
 * La doc de Cache Components lo dice con todas las letras (`01-getting-started/08-caching.md`):
 * *"Just as `<Suspense>` contains async access, an **error boundary** contains failures ... the
 * `error.js` file convention for route-level boundaries."*
 *
 * ## Qué NO cubre, para que nadie se confíe
 * 1. **No cubre `(storefront)/layout.tsx`.** Un `error.js` envuelve `page`, `loading`, `not-found` y
 *    los layouts *anidados*, pero **no** el layout de su propio segmento. El layout de la vidriera
 *    es síncrono y sin I/O justamente por esto; que siga así.
 * 2. **No cubre `generateMetadata`.** La metadata resuelve en su propio boundary. Por eso la guarda
 *    del slug está duplicada dentro de `generateMetadata` y no sólo en el cuerpo de la página.
 * 3. **No cubre el layout raíz.** Eso es `app/global-error.tsx`, que está fuera de `(storefront)` y
 *    por lo tanto fuera de esta columna.
 *
 * ## Cero fuga de detalle al HTML (`CLAUDE.md` §2)
 * No se renderiza `error.message` **nunca**, ni siquiera en dev. En producción Next ya reemplaza el
 * mensaje de un error de Server Component por uno genérico, pero en dev lo serializa entero al
 * cliente — y en dev es cuando un mensaje trae la query, el slug de otro tenant o un fragmento de
 * fila. Lo único que sale al DOM es `digest`, que es un **hash** del error: sirve para cruzarlo con
 * los logs del server y no dice nada de lo que pasó. Tampoco se loggea nada acá: el server ya lo
 * loggeó con ese mismo digest, y un `console.error` del lado del visitante no le agrega
 * información a nadie.
 *
 * ## Costo: este archivo no importa NADA, y es a propósito
 * Es el **único** `'use client'` de la vidriera, así que su árbol de imports es lo único de
 * `packages/*` que puede terminar en el bundle del browser de un visitante anónimo. Por eso no
 * importa ni `@istock/domain`: la primera versión traía `STOREFRONT_DOMAIN` para nombrar el dominio
 * en el texto, y eso enganchaba el barrel del paquete entero —`fx`, `wa`, `imei`, `dto`— al chunk
 * del cliente por una constante de 9 caracteres. Tree-shaking *debería* limpiarlo; "debería" no es
 * un presupuesto. El texto se reescribió para no necesitar el dato (el visitante ya está parado en
 * ese dominio: no hace falta decírselo). Cero imports, cero `useEffect`, cero estado.
 * La vidriera sigue sin hacer un solo fetch de cliente. Ver la nota sobre `web-lint` W001 abajo.
 *
 * ⚠️ **`web-lint` W001 prohíbe `'use client'` en todo `(storefront)`** y `apps/web/scripts/` no es
 * mi columna, así que no lo toco. La regla, tal como está escrita, hace imposible el archivo que la
 * doc de Next exige para tener un error boundary de ruta: los boundaries **tienen** que ser Client
 * Components. Lo que W001 quiere proteger —"la vidriera no manda JS de datos"— este archivo no lo
 * viola. Preferí romper la regla a la vista antes que esquivarla (mover el `'use client'` a
 * `apps/web/lib/` y re-exportarlo desde acá pondría el lint en verde sin cambiar un byte de lo que
 * se sirve, que es exactamente cómo una regla deja de guardar). La corrección le corresponde al
 * owner de `web-lint.mjs`: exceptuar `error.tsx` / `global-error.tsx` por nombre de archivo, que es
 * una lista cerrada y chica, no un marcador libre.
 */
export default function StorefrontError({
  error,
  retry,
}: {
  readonly error: Error & { digest?: string };
  readonly retry: () => void;
}) {
  return (
    <main data-storefront="error" className="flex min-h-[70dvh] flex-col justify-center">
      {/* Una pantalla de error no se indexa jamás, ni siquiera bajo la URL de una vidriera real. */}
      <meta name="robots" content="noindex, nofollow" />

      <p className="storefront-kicker">
        Algo falló de nuestro lado
      </p>
      <h1>
        No pudimos mostrar esta vidriera
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        Fue un problema nuestro, no del link que te pasaron. Probá de nuevo en un momento; si
        seguís viendo esto, escribile al vendedor por WhatsApp y contale que la página no carga.
      </p>

      <button
        type="button"
        onClick={() => {
          retry();
        }}
        className="mt-6 min-h-12 w-full rounded-xl border border-neutral-300 px-4 text-base font-medium sm:w-auto sm:self-start sm:px-8 dark:border-neutral-700"
      >
        Reintentar
      </button>

      {/*
        `digest` es un hash del error, no el error. Va chiquito y al final: no le sirve al visitante,
        le sirve al que atiende el WhatsApp para que podamos cruzarlo con los logs del server.
      */}
      {error.digest !== undefined && (
        <p className="mt-6 font-mono text-xs text-neutral-400">código {error.digest}</p>
      )}
    </main>
  );
}
