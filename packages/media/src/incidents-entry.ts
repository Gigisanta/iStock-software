/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Entrypoint del subpath `@istock/media/incidents`. **Superficie liviana, sin `sharp`.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Por qué existe
 * `apps/web` enchufa el canal de incidentes en su bootstrap (`instrumentation.ts` →
 * `_lib/observability/media-incidents.ts`). Para llegar a `setMediaIncidentReporter` tenía que
 * importar el **barrel** del paquete, y el barrel arrastra `./upload → ./pipeline → sharp`: el
 * binario nativo de libvips se carga **antes de que el server atienda la primera request**, en
 * *toda* instancia — también en las que nunca van a servir una foto. Medido en esta máquina:
 * importar `@istock/media` resuelve ~266 módulos y carga 2 objetos nativos
 * (`sharp-darwin-arm64.node` + `libvips-cpp.dylib`); importar este subpath resuelve 3 archivos y
 * **cero** objetos nativos. La medición vive en `./subpath-isolation.test.ts` y corre en cada
 * `pnpm --filter @istock/media test`, con un control que falla si el medidor se queda ciego.
 *
 * ## La regla que hace que esto siga siendo cierto
 * **Este archivo, y todo lo que alcance en tiempo de ejecución, no puede importar nada que no sea
 * TypeScript puro de este paquete.** Hoy el grafo runtime completo es
 * `incidents-entry.ts → incidents.ts → types.ts`, y ninguno de los tres importa un paquete de
 * `node_modules` ni un builtin de Node. Un `import` nuevo acá —o en `incidents.ts`, o en
 * `types.ts`— rompe el test de aislamiento, que es el punto: el aislamiento es una propiedad
 * medida, no una intención escrita en un docblock.
 *
 * ## Qué NO se exporta, y a propósito
 * - **`keyPrefix`.** El barrel tampoco lo exporta: es la herramienta interna con la que `url.ts`
 *   trunca antes de reportar. Que `apps/web` vuelva a recortar el prefijo por su cuenta
 *   (`clampKeyPrefix`) es duplicación **deliberada**: la garantía de que la key entera no sale no
 *   puede depender de una constante que vive en otra columna. Exportar `keyPrefix` invitaría a
 *   borrar esa segunda barrera.
 * - **Todo lo demás.** Nada de keys, URLs, budgets, storage ni env. Quien necesita eso importa
 *   `@istock/media` y paga `sharp`, que es exactamente el trade que este subpath viene a evitar.
 *
 * ## La forma del incidente no cambia
 * Sigue saliendo `code` + `reason` + **prefijo** de key + variante. La key completa no sale nunca:
 * una key inválida puede ser la del master (`originals/{tenant}/{listing}/…`) y de una URL pública
 * no se puede derivar la del original (`CLAUDE.md` §2). Este archivo re-exporta; no
 * reinterpreta.
 */

export {
  reportMediaIncident,
  resetMediaIncidentReporter,
  setMediaIncidentReporter,
} from './incidents';
export type { MediaIncident, MediaIncidentCode, MediaIncidentReporter } from './incidents';

/**
 * `Variant` es parte del tipo de `MediaIncident` (`variant: Variant | null`), así que sin él el
 * subpath no se puede tipar del otro lado. `VARIANTS` / `isVariant` viajan con él porque un sink
 * que sanitiza el incidente necesita validar la variante que recibió sin volver al barrel — que
 * es justo el import que este subpath elimina. Los tres viven en `./types`, que es TS puro.
 */
export { VARIANTS, isVariant } from './types';
export type { Variant } from './types';
