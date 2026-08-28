import { VARIANT_SPECS } from '@istock/media';
import type { PublicPhotoDTO } from '@istock/domain';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `srcSet` SIN `sizes` es el bug de P3, y no se ve en ningún gate de generación
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Sin `sizes`, el browser asume `sizes="100vw"`. Un teléfono de 390 px CSS con DPR 3 pide entonces
 * **1170 px de ancho de recurso**, y con el `srcSet` de abajo eso elige `detail` (128.570 B) en vez
 * de `card` (50.692 B) — 2,5× el presupuesto de la grilla, **con el gate de S2 en verde**, porque
 * S2 mide el byte que el pipeline *generó* y no el que el browser *bajó*.
 *
 * Por eso en este módulo `sizes` no es un parámetro opcional con default: **es un argumento
 * obligatorio de `photoImgProps()`**, y no hay forma de construir el `srcSet` sin pasarlo. El
 * detector estático de `scripts/accept-s3.sh` (M1) mira el tag; esto hace que el tag no se pueda
 * escribir mal desde el principio.
 *
 * ## Los dos candidatos, y por qué son dos y no tres
 * `thumb` (200 px) no entra: en la grilla mobile la caja mide ~173 px CSS, o sea ~520 px de
 * recurso a DPR 3, y `thumb` se vería lavado. `card` (800 px) y `detail` (1600 px) son **objetos
 * ya guardados** en R2: no hay transformación on-the-fly, el costo marginal de ofrecer los dos es
 * $0, y el que elige es el browser con la información que sólo él tiene (DPR, ancho real,
 * preferencia de datos).
 *
 * Los anchos salen de `VARIANT_SPECS` de `@istock/media`, no de dos constantes escritas acá: el
 * día que `media-agent` mueva `card` a 900 px, el `srcSet` tiene que moverse solo o el browser
 * elige mal en silencio.
 */

/** Ancho real del recurso `card` en píxeles. Fuente única: `packages/media`. */
export const CARD_WIDTH = VARIANT_SPECS.card.maxEdge;
/** Ancho real del recurso `detail` en píxeles. Fuente única: `packages/media`. */
export const DETAIL_WIDTH = VARIANT_SPECS.detail.maxEdge;

/**
 * `sizes` de una card de la **grilla**. La grilla es de 2 columnas en mobile a propósito, y no sólo
 * por diseño: a 1 columna la caja mediría ~358 px CSS, o sea 1074 px de recurso a DPR 3, y el
 * browser elegiría `detail` **aunque el `sizes` estuviera bien puesto**. El layout es parte del
 * presupuesto de bytes.
 *
 * Cuenta a 390×844 DPR 3: `45vw` = 175,5 px CSS × 3 = 526 px de recurso → gana `card` (800 w).
 */
export const GRID_PHOTO_SIZES = '(min-width: 1024px) 220px, (min-width: 640px) 30vw, 45vw';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  La foto principal de la ficha: `<picture>` con DOS listas de candidatos, no una
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Con un solo `<img>` y `sizes="(min-width: 640px) 600px, 100vw"`, un teléfono de 390 px CSS con
 * DPR 3 pide 1170 px de recurso y elige `detail`: **128.570 B por la primera foto**, en la calle,
 * con 4G malo. Y sería una elección *correcta* del browser — el `sizes` describe bien el layout.
 * El problema no es el `sizes`, es haberle ofrecido `detail` como candidato a un teléfono.
 *
 * La cuenta que decide: en mobile el hero se ve a ~358 px CSS. Servirle `card` (800 px) le da
 * **2,2× de densidad**; servirle `detail` (1600 px) le da 4,4×. Nadie ve la diferencia entre 2,2×
 * y 4,4× en una pantalla de 6 pulgadas — pero sí ve los 78 KB extra, que en 4G malo son casi un
 * segundo. "Mobile-first de verdad" significa exactamente esto y no un `max-w-` distinto.
 *
 * Así que la elección se hace por **media query**, que es información del dispositivo, y no por
 * densidad, que es lo único que el algoritmo de `srcset` mira:
 *
 * ```
 *   pantalla ≥ 640 px  → <source>  candidatos: card 800w + detail 1600w   sizes: 600px
 *                                  (DPR 1 baja card · DPR 2 baja detail — ahí sí vale)
 *   pantalla < 640 px  → <img>     candidato ÚNICO: card 800w             sizes: 100vw
 *                                  (no hay forma de que un teléfono baje detail)
 * ```
 *
 * Consecuencia medible y buscada: **a 390×844 DPR 3 no existe una sola imagen de la vidriera que
 * sea `detail`** — ni en la grilla ni en la ficha. La ficha entera son 3 × 50.692 B ≈ 152 KB de
 * imagen. El `detail` sigue existiendo y se usa: lo bajan las pantallas grandes, donde la foto se
 * ve a 600 px y la densidad extra sí se nota.
 */

/** `sizes` del `<source>` de escritorio: el hero vive en una columna de 600 px. */
export const HERO_WIDE_SIZES = '600px';
/** Media query que separa "teléfono" de "pantalla grande" en el `<picture>` del hero. */
export const HERO_WIDE_MEDIA = '(min-width: 640px)';
/** `sizes` del `<img>` de teléfono: el hero es de ancho completo. */
export const HERO_PHOTO_SIZES = '100vw';

/**
 * `sizes` de las fotos 2 y 3 de la ficha, que van en una fila de tres. `30vw` = 117 px CSS × 3 =
 * 351 px → `card` (800 w) es el candidato más chico que alcanza. Acá el `<img>` común sirve: la
 * caja nunca es grande, así que ni con DPR 3 la cuenta llega a `detail`.
 */
export const SECONDARY_PHOTO_SIZES = '(min-width: 640px) 190px, 30vw';

/** Lo que `photoImgProps()` devuelve: exactamente los atributos de un `<img>` y nada más. */
export interface PhotoImgProps {
  readonly src: string;
  readonly srcSet: string;
  readonly sizes: string;
  readonly alt: string;
}

/**
 * Atributos de un `<img>` a partir de una foto del DTO público.
 *
 * `src` apunta a `card` y no a `detail`: es el fallback del browser que no entiende `srcSet`, y
 * ante la duda se paga el recurso barato.
 *
 * `sizes` es obligatorio. Ver el encabezado del módulo.
 */
export function photoImgProps(photo: PublicPhotoDTO, sizes: string): PhotoImgProps {
  return {
    src: photo.card,
    srcSet: `${photo.card} ${String(CARD_WIDTH)}w, ${photo.detail} ${String(DETAIL_WIDTH)}w`,
    sizes,
    alt: photo.alt,
  };
}

/** Los dos juegos de candidatos del hero. Ver el bloque `<picture>` del encabezado. */
export interface HeroPhotoProps {
  /** `<source>` para pantallas grandes: los dos candidatos, y el browser elige por densidad. */
  readonly wide: { readonly media: string; readonly srcSet: string; readonly sizes: string };
  /** `<img>` de teléfono: **un solo** candidato, así que `detail` no es alcanzable. */
  readonly img: PhotoImgProps;
}

export function heroPhotoProps(photo: PublicPhotoDTO): HeroPhotoProps {
  return {
    wide: {
      media: HERO_WIDE_MEDIA,
      srcSet: `${photo.card} ${String(CARD_WIDTH)}w, ${photo.detail} ${String(DETAIL_WIDTH)}w`,
      sizes: HERO_WIDE_SIZES,
    },
    img: {
      src: photo.card,
      srcSet: `${photo.card} ${String(CARD_WIDTH)}w`,
      sizes: HERO_PHOTO_SIZES,
      alt: photo.alt,
    },
  };
}
