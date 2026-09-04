import { z } from 'zod';
import { parseUsdToCents } from '../../../_lib/listings/parse-money';

const priceUsdSchema = z.preprocess(
  (raw) => raw ?? '',
  z
    .string({ error: 'Poné el precio en dólares.' })
    .transform((raw, ctx) => {
      const parsed = parseUsdToCents(raw);
      if (!parsed.ok) {
        ctx.addIssue({ code: 'custom', message: parsed.reason });
        return z.NEVER;
      }
      if (parsed.cents <= 0) {
        ctx.addIssue({ code: 'custom', message: 'El precio tiene que ser mayor a cero.' });
        return z.NEVER;
      }
      return parsed.cents;
    }),
);

export const priceActionSchema = z.object({
  listingId: z.uuid('Ese equipo no existe.'),
  priceUsd: priceUsdSchema,
});

export type PriceActionInput = z.infer<typeof priceActionSchema>;

const UNREADABLE = 'No pudimos identificar el equipo. Recargá la pantalla.';

export type ParsedPriceForm =
  | { readonly ok: true; readonly data: PriceActionInput }
  | { readonly ok: false; readonly error: string };

/** Lee sólo las dos claves del formulario; cualquier dato agregado a mano queda fuera. */
export function parsePriceForm(formData: FormData): ParsedPriceForm {
  const parsed = priceActionSchema.safeParse({
    listingId: formData.get('listingId'),
    priceUsd: formData.get('priceUsd'),
  });

  if (parsed.success) return { ok: true, data: parsed.data };

  const issue = parsed.error.issues.find((candidate) => candidate.path[0] === 'priceUsd');
  return { ok: false, error: issue?.message ?? UNREADABLE };
}
