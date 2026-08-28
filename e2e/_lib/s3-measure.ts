/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Las DOS líneas que `scripts/accept-s3.sh` no puede producir solo. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El gate de S3 (M2 y M5) **no mide**: lee. Su párrafo lo dice sin vueltas —*"DOS MEDICIONES LAS
 * EMITE `qa-agent`, NO ESTE SCRIPT, y a proposito: necesitan un browser real y un contador de
 * queries"*— y falla si las líneas no están. Este módulo es el que las escribe, y existe separado
 * de los dos specs por dos motivos que no son de estilo:
 *
 * 1. **El formato es un contrato con un parser de `sed`.** Un espacio de más y M2 imprime *"la
 *    linea MEDIDO s3 imagen cambio de formato"*. Escrito una sola vez, cambia una sola vez.
 * 2. **El veredicto tiene que poder verse fallar sin levantar un browser.** Un test que nunca se
 *    vio en rojo no prueba nada, y probar el rojo de "el browser eligió `detail`" implicaría
 *    romper a propósito el `sizes` de la vidriera — o sea, editar el código bajo test, que es
 *    exactamente lo que `qa-agent` no hace. Con la decisión acá adentro, la polaridad negativa se
 *    ejercita alimentando la función con una medición de `detail` y viendo que el veredicto sale
 *    no vacío. Lo que el browser no puede demostrar, lo demuestra el dato.
 *
 * Los veredictos devuelven **lista de problemas** en vez de tirar. El spec afirma
 * `expect(problemas).toEqual([])`, así que un rojo imprime *qué* está mal (los problemas) y no
 * sólo *que* está mal.
 *
 * ── Nada de acá importa del código bajo test ─────────────────────────────────────────────────
 * Ni el techo, ni el viewport, ni los anchos. Están escritos a mano, duplicados a propósito de
 * `_lib/photo.ts` y de `packages/media`, por la misma razón que los techos de `_lib/media.ts`:
 * si el test leyera la constante que audita, subirla pondría el test en verde y el guard dejaría
 * de guardar. La divergencia entre las dos copias **es** la señal.
 */

/**
 * El teléfono con el que se mide. `CLAUDE.md` §0.11 (mobile-first) más el formato que fija el
 * gate: `viewport=390x844 dpr=3`. Es un iPhone 12/13/14 y es el equipo que tiene en la mano la
 * persona parada frente al local.
 */
export const S3_VIEWPORT = { width: 390, height: 844 } as const;
export const S3_DPR = 3;

/**
 * Techo de la imagen de la grilla: **200 KiB = 204.800 B**, el número literal que el gate lee y
 * el que `TEST_MATRIX.md` llama "card <200KB".
 *
 * No es el techo de `packages/media` (150 KiB para el objeto `card`) y no tiene por qué serlo:
 * aquél acota lo que el pipeline **genera**, éste acota lo que el browser **baja**, que incluye
 * headers de respuesta y cualquier cosa que se meta en el medio. Un `card` de 50.692 B con 150 KB
 * de otra cosa encima rompe éste y no aquél, y ésa es la falla que P3 vino a hacer visible.
 */
export const S3_IMAGE_CAP_BYTES = 204_800;

/** Anchos declarados de las variantes públicas, a mano. Ver el encabezado. */
export const CARD_WIDTH_PX = 800;
export const DETAIL_WIDTH_PX = 1600;

// ── qué variante eligió el browser ────────────────────────────────────────────────────────────

export type ChosenVariant = 'thumb' | 'card' | 'detail' | 'desconocida';

/** Las tres keys públicas de una foto, tal como salen de `listing_photos`. */
export interface PhotoKeys {
  readonly thumbKey: string;
  readonly cardKey: string;
  readonly detailKey: string;
}

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La URL pública NO dice qué variante es, y eso es una feature — pero deja ciego al gate
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ADR-006: la key es `v1/{ab}/{sha256_32}.webp`, content-addressed, **sin sufijo de variante**.
 * De la URL de una `card` no se puede derivar la de su `detail` ni la del master, y ése es
 * justamente el punto (`CLAUDE.md` §2: "URL pública de foto desde la que se pueda **derivar** la
 * key del master → rechazo").
 *
 * Consecuencia: el chequeo que hace el gate sobre la línea —`grep -q 'elegido=[^ ]*detail'`— **no
 * puede acertar nunca** si `elegido` es la URL cruda, porque ninguna URL pública contiene la
 * palabra `detail`. Una regla que no puede fallar no es una regla.
 *
 * Por eso la variante se resuelve acá, cruzando la URL que el browser eligió contra las tres keys
 * de la base (que es el único lugar donde vive esa correspondencia), y la línea publica el
 * resultado como fragmento: `elegido=<url>#variante=card`. La URL queda intacta antes del `#`, y
 * el `grep` del gate vuelve a tener algo que encontrar el día que la vidriera sirva `detail` en la
 * grilla.
 */
export function variantOfUrl(url: string, keys: PhotoKeys): ChosenVariant {
  if (url.includes(keys.cardKey)) return 'card';
  if (url.includes(keys.detailKey)) return 'detail';
  if (url.includes(keys.thumbKey)) return 'thumb';
  return 'desconocida';
}

// ── línea 1 · el byte que el browser eligió ───────────────────────────────────────────────────

export interface ImageMeasurement {
  /** URL exacta que el browser pidió (`currentSrc` del `<img>`). */
  readonly url: string;
  /** Variante resuelta contra `listing_photos`. Ver `variantOfUrl`. */
  readonly variant: ChosenVariant;
  /**
   * Bytes que **viajaron** por el cable: cuerpo codificado + headers de respuesta. No es
   * `decodedBodySize` y no es `content-length` — es lo que la pila de red del browser contó.
   */
  readonly transferSize: number;
}

/**
 * La línea que lee M2. **El formato es del gate, no de este archivo.**
 *
 * ```
 * MEDIDO s3 imagen · viewport=390x844 dpr=3 · elegido=<url> · transferSize=<N>B · techo=204800B
 * ```
 */
export function imageMedidoLine(measurement: ImageMeasurement): string {
  return (
    `MEDIDO s3 imagen · viewport=${String(S3_VIEWPORT.width)}x${String(S3_VIEWPORT.height)} ` +
    `dpr=${String(S3_DPR)} · elegido=${measurement.url}#variante=${measurement.variant} · ` +
    `transferSize=${String(measurement.transferSize)}B · techo=${String(S3_IMAGE_CAP_BYTES)}B`
  );
}

/**
 * Todo lo que está mal con la medición, en castellano. Vacío = la grilla cumple.
 *
 * Las tres reglas son distintas y ninguna implica a las otras:
 *
 * - **`transferSize` en 0 es una medición inválida, no una medición buena.** Un recurso servido
 *   desde el cache del browser reporta 0 bytes transferidos, y publicar ese 0 sería afirmar que la
 *   vidriera no gasta datos. Se falla en vez de reportar 0. (Instrucción explícita del LEAD.)
 * - **La variante importa aunque el número dé bien.** Con una foto chica, `detail` puede entrar
 *   holgado bajo el techo; el día que el dueño suba una foto pesada, revienta. El gate hace este
 *   mismo chequeo sobre la línea, y acá se hace otra vez para que el rojo aparezca en la suite y
 *   no dos pasos más tarde.
 * - **El techo es el techo.** Escrito a mano, no leído de la impl.
 */
export function imageBudgetProblems(measurement: ImageMeasurement): readonly string[] {
  const problems: string[] = [];

  if (measurement.transferSize <= 0) {
    problems.push(
      `transferSize=${String(measurement.transferSize)}: no viajó un solo byte, así que no hay ` +
        'nada medido. Casi siempre es el cache del browser (contexto reusado) o un 404. Reportar ' +
        '0 sería afirmar que la grilla no gasta datos.',
    );
  }

  if (measurement.variant === 'detail') {
    problems.push(
      'el browser eligió la variante `detail` (1600px) para una card de la grilla: eso es P3 ' +
        'exactamente. A 390px CSS con DPR 3 la card pide ~527px de recurso y `card` (800w) le ' +
        'sobra; que gane `detail` significa `sizes` ausente o mal escrito.',
    );
  }

  if (measurement.variant === 'desconocida') {
    problems.push(
      `la URL que bajó el browser (${measurement.url}) no es ninguna de las tres keys de esa foto ` +
        'en `listing_photos`: la grilla está sirviendo un objeto que no salió del pipeline.',
    );
  }

  if (measurement.transferSize > S3_IMAGE_CAP_BYTES) {
    problems.push(
      `bajó ${String(measurement.transferSize)} B y el techo de la grilla son ` +
        `${String(S3_IMAGE_CAP_BYTES)} B.`,
    );
  }

  return problems;
}

// ── línea 2 · queries contra Postgres ─────────────────────────────────────────────────────────

export interface DbHitsMeasurement {
  /** Path público medido, tal como lo pide el visitante (`/p/{slug}`). */
  readonly route: string;
  /** Sentencias que el server le mandó a Postgres en la **primera** visita (cache frío). */
  readonly first: number;
  /** Sentencias en una visita servida desde el cache. El objetivo es **cero**. */
  readonly cached: number;
}

/**
 * ```
 * MEDIDO s3 db-hits · ruta=<path> · primera=<N> · cacheada=<N>
 * ```
 */
export function dbHitsMedidoLine(measurement: DbHitsMeasurement): string {
  return (
    `MEDIDO s3 db-hits · ruta=${measurement.route} · ` +
    `primera=${String(measurement.first)} · cacheada=${String(measurement.cached)}`
  );
}

/**
 * `CLAUDE.md` §3: **el 95% de los hits no toca Postgres.** Eso son dos afirmaciones, y las dos
 * tienen que ser verdad para que la línea signifique algo:
 *
 * - **`cacheada` tiene que ser 0.** Una query por pageview es la diferencia entre ~USD 0,012 y
 *   ~USD 2,59 por tenant por mes, y es la razón por la que la vidriera usa `cacheLife('max')` con
 *   invalidación por evento en vez de `revalidate: 60`.
 * - **`primera` NO puede ser 0.** Un contador que no cuenta nada da 0 en las dos columnas y
 *   "pasa". El caso frío **tiene** que pegarle a Postgres —tiene que resolver tenant, TC, puntos
 *   de retiro, equipo, fotos y modelo— y si no lo hace, lo que está roto es la medición, no la
 *   vidriera. El gate hace este mismo chequeo (*"primera=0: el contador de queries no esta
 *   contando nada, la medicion es vacua"*) y acá se hace otra vez, adentro de la suite.
 */
export function dbHitsProblems(measurement: DbHitsMeasurement): readonly string[] {
  const problems: string[] = [];

  if (measurement.first <= 0) {
    problems.push(
      'primera=0: el contador no vio ninguna sentencia en la visita con cache frío. La medición ' +
        'es vacua — un contador roto da 0 en las dos columnas y el gate lo leería como éxito.',
    );
  }

  if (measurement.cached !== 0) {
    problems.push(
      `cacheada=${String(measurement.cached)}: la vidriera servida desde el cache igual le pega a ` +
        'Postgres. Con eso el 95% sin Postgres de `CLAUDE.md` §3 no se cumple y el costo por ' +
        'pageview deja de ser cero.',
    );
  }

  return problems;
}
