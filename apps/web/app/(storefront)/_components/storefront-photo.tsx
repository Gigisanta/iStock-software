import type { PublicPhotoDTO } from '@istock/domain';
import { heroPhotoProps, photoImgProps } from '../_lib/photo';

/**
 * La foto de la vidriera. **Un `<img>`, a mano, y no `next/image`.**
 *
 * `next/image` está prohibido por `CLAUDE.md` §3: su loader por defecto es Vercel Image
 * Optimization y pasar por ahí una foto que `packages/media` ya dejó en WebP de 800 px, guardada
 * en R2 con egress $0, es pagar dos veces por el mismo byte. Con `images.unoptimized: true` el
 * componente ni siquiera aportaría el resize; sólo el peso del runtime.
 *
 * Lo que sí hay que reponer a mano, y está repuesto:
 * - **`srcSet` + `sizes`**, obligatorios juntos. `_lib/photo.ts` los arma y explica por qué sin
 *   `sizes` el teléfono se baja `detail` (128.570 B) en lugar de `card` (50.692 B).
 * - **`aspect-[4/3]` en el contenedor** en vez de `width`/`height` en el tag. El DTO no publica
 *   las dimensiones (no son campo de ficha) y sin reserva de espacio la grilla salta cuando entra
 *   cada foto — en 4G malo eso es medio segundo de texto moviéndose bajo el dedo. La caja reserva
 *   el alto antes de que baje un solo byte.
 * - **`loading` / `decoding` / `fetchPriority`** explícitos. La primera foto de la ficha es el LCP
 *   y va `eager`; todo lo demás es `lazy`.
 */
export interface StorefrontPhotoProps {
  readonly photo: PublicPhotoDTO;
  /** Obligatorio: no hay default. Ver `_lib/photo.ts`. */
  readonly sizes: string;
  /** `true` sólo para el LCP (la foto principal de la ficha). Uno por página, no más. */
  readonly priority?: boolean;
  readonly className?: string;
}

export function StorefrontPhoto({ photo, sizes, priority = false, className }: StorefrontPhotoProps) {
  const img = photoImgProps(photo, sizes);

  return (
    <img
      src={img.src}
      srcSet={img.srcSet}
      sizes={img.sizes}
      alt={img.alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding={priority ? 'sync' : 'async'}
      fetchPriority={priority ? 'high' : 'auto'}
      className={className ?? 'h-full w-full object-cover'}
    />
  );
}

/**
 * El hueco cuando una ficha no tiene fotos. No debería existir —el gate de publicación pide 3
 * (`MIN_PHOTOS_TO_PUBLISH`)— pero una fila importada o un borrado a medias no puede dejar la
 * grilla con una caja rota: un `<img>` sin `src` en mobile es un ícono de imagen partida, y eso
 * le dice al comprador "este negocio no cuida lo que muestra".
 */
export function StorefrontPhotoPlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-100 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      Sin foto
    </div>
  );
}

/**
 * La foto principal de la ficha. Es un `<picture>`, no un `<img>`, y el motivo está entero en
 * `_lib/photo.ts`: en un teléfono `detail` **no es un candidato**, así que ninguna combinación de
 * DPR y ancho puede hacer que se baje. En pantallas grandes sí lo es.
 *
 * `priority` va siempre implícito: es el LCP de la ficha.
 */
export function StorefrontHeroPhoto({ photo }: { readonly photo: PublicPhotoDTO }) {
  const hero = heroPhotoProps(photo);
  return (
    <picture>
      <source media={hero.wide.media} srcSet={hero.wide.srcSet} sizes={hero.wide.sizes} />
      <img
        src={hero.img.src}
        srcSet={hero.img.srcSet}
        sizes={hero.img.sizes}
        alt={hero.img.alt}
        loading="eager"
        decoding="sync"
        fetchPriority="high"
        className="h-full w-full object-cover"
      />
    </picture>
  );
}
