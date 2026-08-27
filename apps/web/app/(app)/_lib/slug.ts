import { z } from 'zod';
import {
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
  isReservedSlug,
  normalizeSlug,
} from './slug-format';

/**
 * Schema de Zod del slug: el **borde** del panel. Traduce las reglas de `@istock/domain` a
 * mensajes por campo en castellano, que es lo único que el dominio no puede dar (tira
 * `DomainError`, no un texto para un mostrador).
 *
 * Vive separado de `slug-format.ts` por una razón de bytes, no de gusto: el formulario de alta es
 * un Client Component y necesita `suggestSlug()` para proponer un link mientras la persona escribe
 * el nombre del negocio. Si esa función viviera en el mismo módulo que el schema, importarla
 * arrastraría **Zod entero al bundle del navegador** para validar del lado que no vale — la
 * validación que cuenta es la del server, que corre igual.
 *
 * `slug-format.ts` es puro (re-exporta `@istock/domain`) y se puede importar de los dos lados.
 * Este archivo, sólo del server.
 *
 * La lista de reservados **no se declara acá ni en `slug-format.ts`**: `isReservedSlug()` es la
 * misma función que usa el proxy para decidir que `www.maat.work` no es una vidriera. Dos listas
 * dejan entrar un slug que se puede registrar y que nunca sirve un negocio.
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
        (value) => !isReservedSlug(value),
        'Ese link está reservado por el sistema. Probá con otro.',
      ),
  );

export type Slug = z.infer<typeof slugSchema>;
