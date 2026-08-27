import { z } from 'zod';
import {
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
  normalizeSlug,
} from './slug-format';

/**
 * Schema de Zod del slug. Vive separado de `slug-format.ts` por una razón de bytes, no de gusto:
 * el formulario de alta es un Client Component y necesita `suggestSlug()` para proponer un link
 * mientras la persona escribe el nombre del negocio. Si esa función viviera en el mismo módulo
 * que el schema, importarla arrastraría **Zod entero al bundle del navegador** para validar del
 * lado que no vale — la validación que cuenta es la del server, que corre igual.
 *
 * `slug-format.ts` es puro y se puede importar de los dos lados. Este archivo, sólo del server.
 */
export const slugSchema = z
  .string({ error: 'Escribí el link de tu vidriera.' })
  .transform(normalizeSlug)
  .pipe(
    z
      .string()
      .min(SLUG_MIN_LENGTH, `El link necesita al menos ${SLUG_MIN_LENGTH} caracteres.`)
      .max(SLUG_MAX_LENGTH, `El link no puede tener más de ${SLUG_MAX_LENGTH} caracteres.`)
      .regex(
        SLUG_PATTERN,
        'Sólo minúsculas, números y guiones. No puede empezar ni terminar con guión.',
      )
      .refine(
        (value) => !RESERVED_SLUGS.has(value),
        'Ese link está reservado por el sistema. Probá con otro.',
      ),
  );

export type Slug = z.infer<typeof slugSchema>;
