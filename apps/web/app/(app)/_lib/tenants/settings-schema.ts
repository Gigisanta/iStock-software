import { z } from 'zod';
import { RESERVATION_DEFAULT_MINUTES, RESERVATION_MINUTE_OPTIONS } from '@istock/domain';
import { normalizeArWaPhone } from '../wa-phone';

const businessNameSchema = z
  .string({ error: 'Poné el nombre de tu negocio.' })
  .transform((raw) => raw.trim().replace(/\s+/gu, ' '))
  .pipe(
    z
      .string()
      .min(2, 'El nombre necesita al menos 2 caracteres.')
      .max(60, 'El nombre no puede pasar de 60 caracteres.'),
  );

const waPhoneSchema = z
  .string({ error: 'Poné el WhatsApp donde te escriben los clientes.' })
  .transform((raw, ctx) => {
    const result = normalizeArWaPhone(raw);
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: result.reason });
      return z.NEVER;
    }
    return result.value;
  });

const pickupText = (label: string, max: number) =>
  z
    .string({ error: `Completá ${label}.` })
    .transform((raw) => raw.trim().replace(/\s+/gu, ' '))
    .pipe(z.string().min(2, `Completá ${label}.`).max(max, `${label} es demasiado largo.`));

const paymentMethodsSchema = z
  .string()
  .transform((raw) => {
    const unique = new Set<string>();
    for (const method of raw.split(/[\n,]/u)) {
      const normalized = method.trim().replace(/\s+/gu, ' ');
      if (normalized !== '') unique.add(normalized);
    }
    return [...unique];
  })
  .pipe(
    z
      .array(z.string().min(2, 'Cada medio de pago necesita al menos 2 caracteres.').max(50, 'Un medio de pago es demasiado largo.'))
      .max(8, 'Podés cargar hasta 8 medios de pago.'),
  );

const reservationMinutesSchema = z.preprocess(
  (raw) => raw ?? '',
  z
    .string({ error: 'Elegí cuánto dura una reserva.' })
    .transform((raw) => (raw === '' ? String(RESERVATION_DEFAULT_MINUTES) : raw))
    .refine((raw) => RESERVATION_MINUTE_OPTIONS.some((option) => String(option) === raw), {
      message: 'Elegí una duración de 30 minutos, 1 hora, 1 hora y media o 2 horas.',
    })
    .transform((raw) => Number.parseInt(raw, 10)),
);

export const updateTenantSettingsSchema = z.object({
  name: businessNameSchema,
  waPhone: waPhoneSchema,
  paymentMethods: paymentMethodsSchema,
  acceptsTradeIn: z.boolean(),
  reservationMinutes: reservationMinutesSchema,
  pickupName: pickupText('el nombre del punto de retiro', 80),
  pickupAddress: pickupText('la dirección o indicación de retiro', 160),
  pickupHours: pickupText('el horario de retiro', 120),
});

export type UpdateTenantSettingsInput = z.infer<typeof updateTenantSettingsSchema>;

export type TenantSettingsFormValues = {
  readonly name: string;
  readonly waPhone: string;
  readonly paymentMethods: string;
  readonly acceptsTradeIn: boolean;
  readonly reservationMinutes: string;
  readonly pickupName: string;
  readonly pickupAddress: string;
  readonly pickupHours: string;
};

export function parseTenantSettingsForm(values: TenantSettingsFormValues) {
  return updateTenantSettingsSchema.safeParse(values);
}
