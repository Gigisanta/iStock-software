/**
 * Boundary de `notFound()` **de la ficha**, más cerca que el de `s/[slug]/`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Por qué existe habiendo uno arriba: son dos misses distintos y decían lo mismo
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `s/[slug]/not-found.tsx` renderiza `<StorefrontMiss />`, cuyo texto contesta *"no hay ninguna
 * vidriera en esta dirección"*. Es la respuesta correcta para un **subdominio** que no existe, y la
 * respuesta equivocada acá: la vidriera existe, la persona la está mirando, lo que no existe (o ya
 * no es público) es **un equipo**. Mandarla a un texto que dice que el negocio no existe es
 * empujarla a cerrar la pestaña justo cuando el link del estado de WhatsApp funcionó.
 *
 * El caso real y frecuente no es un id inventado: es un link que el dueño pegó hace tres semanas y
 * el equipo se vendió y se despublicó. Por eso el texto no se disculpa, ofrece el resto del stock.
 *
 * ── Cero botón de WhatsApp ────────────────────────────────────────────────────────────────────
 * No hay equipo ni precio que nombrar, así que no hay mensaje que escribir (`CLAUDE.md` §1). El
 * camino es volver a la vidriera y elegir otro.
 *
 * ── Nota operativa ────────────────────────────────────────────────────────────────────────────
 * ADR-011 midió que bajo `cacheComponents` + PPR un `notFound()` renderiza **cero DOM visible** en
 * la raíz de la vidriera. Acá el shell del tenant ya resolvió antes del throw, así que la
 * expectativa es distinta — pero la afirmación la hace el server vivo de `scripts/accept-s3.sh`,
 * no este comentario. Si el LEAD mide 0 bytes también acá, la salida es la misma que tomó ADR-011:
 * dejar de lanzar y devolver este contenido como render normal de la página.
 */
export default function ListingNotFound() {
  return (
    <main>
      <h1 className="mt-6 text-xl font-semibold leading-tight">
        Este equipo ya no está publicado
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        Puede que se haya vendido o que el local lo haya dado de baja. El resto del stock sigue
        acá, con fotos, condición, batería, garantía y precio.
      </p>
      <p className="mt-5">
        <a
          href="/"
          className="inline-flex min-h-[3rem] items-center rounded-xl border border-neutral-300 px-4 text-sm font-semibold dark:border-neutral-700"
        >
          Ver el resto de la vidriera
        </a>
      </p>
    </main>
  );
}
