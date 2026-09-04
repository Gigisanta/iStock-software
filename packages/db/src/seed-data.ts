/**
 * Datos del seed demo. **Determinista**: cero `Math.random`, cero `Date.now`. Este archivo no lee
 * el reloj; la única lectura del reloj real vive en `seed.ts` (`runNow`) y alcanza a los tres
 * **plazos** que se documentan más abajo, no a los datos.
 *
 * Por qué importa: un seed con azar hace que el gate de aceptación ("8 iPhones + 2 accesorios +
 * 1 `reserved`") pase o falle según el humor de la corrida, y hace que un test de vidriera no
 * pueda afirmar nada sobre lo que ve. Los UUID son constantes escritas a mano; el "ahora" de todo
 * hecho pasado es una constante; las keys de R2 se derivan por SHA-256 del slug (una función, no
 * un dado) y respetan la forma de ADR-006 (`v1/{ab}/{32hex}.webp` la pública, `originals/{tenant}/{listing}/{32hex}.webp`
 * el master), porque un dato de demo con forma inválida es un bug esperando a que alguien lo lea.
 *
 * Modelos y colores salen de `docs/research/apple-catalog-ar.md` (R6, PASS): nombres de color tal
 * cual los escribe Apple es-LAMR, que es la forma que copia el mercado argentino, y capacidades
 * que **existieron de fábrica**.
 */

import { createHash } from 'node:crypto';
import { CENTS_PER_UNIT, type Cents, type Condition, type ListingStatus } from '@istock/domain';

/**
 * Instante fijo del seed. **Todo HECHO PASADO se fecha desde acá**: `created_at`, `published_at`,
 * `sold_at`, `accepted_at`, `last_message_at`. Un hecho pasado congelado es exactamente lo que
 * hace determinista al seed y no se degrada nunca: que la venta demo haya sido el 27/08/2026 sigue
 * siendo verdad mañana.
 *
 * **Un PLAZO no se fecha desde acá.** Ver `LIVE_DEADLINES` abajo: es la distinción que faltaba y
 * la que rompió la reserva del demo.
 */
export const SEED_NOW = new Date('2026-08-27T15:00:00.000Z');

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  `LIVE_DEADLINES` — las tres columnas del seed que NO se fechan contra `SEED_NOW`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Un `created_at` es un **hecho**: congelarlo es correcto y es lo que hace determinista al seed.
 * Un `expires_at` es un **plazo**: sólo significa algo comparado con el reloj de quien lo lee, así
 * que congelarlo no lo hace determinista, lo hace **falso con retraso**.
 *
 * Las tres columnas del seed que son plazos:
 *
 *   · `reservations.expires_at`   → la reserva del demo
 *   · `tenants.trial_ends_at`     → el trial del tenant demo
 *   · `subscriptions.trial_ends_at`
 *
 * Las tres se calculan en `seed.ts` desde **el reloj de la corrida** (`runNow`), no desde
 * `SEED_NOW`. El resto del seed —ids, textos, precios, keys de R2 y todos los hechos pasados—
 * sigue siendo constante: la corrida es determinista *dado* `runNow`, que es el máximo
 * determinismo que un dato con vencimiento admite.
 *
 * ── Qué costaba no distinguirlas ──────────────────────────────────────────────────────────────
 * La reserva del demo nacía vencida (S6 trajo el cron cada 5 min que barre `expires_at <= now()`),
 * así que la primera corrida real del cron liberaba la única unidad `reserved` del demo y no volvía
 * nunca. En silencio: el seed OK, los tests verdes, y el badge "Reservado" del `/demo` desaparecido
 * minutos después. Los dos `trial_ends_at` tenían la misma enfermedad en estado latente: apagan
 * entitlements (`trialIsAlive`) el día que `SEED_NOW + 14d` queda atrás.
 */

/**
 * Cuánto vive la reserva del demo desde que corre el seed. **72 h**, y el número tiene dos límites
 * que lo aprietan por arriba y por abajo:
 *
 * · **Por abajo**: tiene que sobrevivir una sesión de demo entera y a alguien que sembró ayer y
 *   vuelve hoy. Un margen de minutos —lo que había— es justamente el bug. 72 h es el mínimo que
 *   además cubre el caso "sembré el viernes, muestro el lunes", que es el patrón real de trabajo.
 *
 * · **Por arriba**: el producto reserva 30–120 min (`CHECK reservations_minutes_range`). Un
 *   vencimiento a semanas o meses deja de parecer una reserva y le miente al que mira sobre cómo
 *   funciona la feature. 72 h es el más corto que cumple lo de arriba, y "el más corto que sirve"
 *   es la única forma no arbitraria de elegir acá.
 *
 * ── El precio que sí se paga, escrito para que nadie lo descubra solo ─────────────────────────
 * La fila de la reserva demo es **la única del producto donde `expires_at ≠ created_at + minutes`**:
 * dice `minutes = 120` (el máximo legal, así que la fila pasa el CHECK y sigue siendo una reserva
 * válida) pero la mecha dura 72 h. Consecuencia visible: el panel del demo muestra la cuenta
 * regresiva de `reservationCountdown()`, o sea "quedan 72 h" en vez de "quedan 2 h". Es un número
 * raro y es a propósito; la alternativa —una fila coherente de 120 min— es la que se apaga sola
 * antes del final del día y vuelve a traer el bug que este comentario documenta.
 *
 * **Salida de esta deuda, y es concreta**: el día que S13 (`/demo`) tenga un re-seed programado,
 * este valor baja a `RESERVATION_MAX_MINUTES` y la fila queda coherente. Ahí el que refresca la
 * reserva es el job, que es su trabajo, y no la mecha, que es un parche honesto mientras tanto.
 */
export const DEMO_RESERVATION_FUSE_HOURS = 72;

/**
 * Minutos declarados de la reserva demo. El máximo que permite el producto: entre las cuatro
 * opciones legales, la más larga es la que menos contradice la mecha de 72 h de arriba.
 */
export const DEMO_RESERVATION_MINUTES = 120;

/** Días de trial del tenant demo. Es el mismo número que usa `createTenant()` en el panel. */
export const DEMO_TRIAL_DAYS = 14;

export const SEED_TENANT_ID = '00000000-0000-4000-8000-000000000001';
export const SEED_OWNER_ID = '00000000-0000-4000-8000-000000000010';
export const SEED_SELLER_ID = '00000000-0000-4000-8000-000000000011';

/**
 * Teléfono del tenant demo. **Placeholder**: el número real es el blocker B6 (humano).
 * Se puede pisar con `SEED_DEMO_WA_PHONE` sin tocar código.
 */
export const SEED_DEMO_WA_PHONE_FALLBACK = '5492990000000';

export interface SeedModel {
  readonly id: string;
  readonly slug: string;
  readonly displayName: string;
  readonly releaseYear: number;
  readonly storageOptionsGb: readonly number[];
  readonly colors: readonly string[];
}

/** Catálogo Apple inicial para que una instalación nueva no deje el selector vacío. */
export const SEED_MODELS: readonly SeedModel[] = [
  { id: '00000000-0000-4000-8000-000000000101', slug: 'iphone-11', displayName: 'iPhone 11', releaseYear: 2019, storageOptionsGb: [64, 128, 256], colors: ['Negro', 'Blanco', 'Verde', 'Amarillo', 'Morado', '(PRODUCT)RED'] },
  { id: '00000000-0000-4000-8000-000000000102', slug: 'iphone-12', displayName: 'iPhone 12', releaseYear: 2020, storageOptionsGb: [64, 128, 256], colors: ['Negro', 'Blanco', 'Verde', 'Azul', 'Morado', '(PRODUCT)RED'] },
  { id: '00000000-0000-4000-8000-000000000103', slug: 'iphone-13', displayName: 'iPhone 13', releaseYear: 2021, storageOptionsGb: [128, 256, 512], colors: ['Medianoche', 'Blanco estelar', 'Azul', 'Rosa', 'Verde', '(PRODUCT)RED'] },
  { id: '00000000-0000-4000-8000-000000000104', slug: 'iphone-13-pro', displayName: 'iPhone 13 Pro', releaseYear: 2021, storageOptionsGb: [128, 256, 512, 1024], colors: ['Grafito', 'Oro', 'Plata', 'Azul Sierra', 'Verde alpino'] },
  { id: '00000000-0000-4000-8000-000000000105', slug: 'iphone-14', displayName: 'iPhone 14', releaseYear: 2022, storageOptionsGb: [128, 256, 512], colors: ['Medianoche', 'Morado', 'Blanco estelar', 'Azul', 'Amarillo', '(PRODUCT)RED'] },
  // R6: iPhone 14 Pro NUNCA tuvo 64 GB. Arranca en 128.
  { id: '00000000-0000-4000-8000-000000000106', slug: 'iphone-14-pro', displayName: 'iPhone 14 Pro', releaseYear: 2022, storageOptionsGb: [128, 256, 512, 1024], colors: ['Negro espacial', 'Plata', 'Oro', 'Morado oscuro'] },
  { id: '00000000-0000-4000-8000-000000000107', slug: 'iphone-15', displayName: 'iPhone 15', releaseYear: 2023, storageOptionsGb: [128, 256, 512], colors: ['Negro', 'Azul', 'Verde', 'Amarillo', 'Rosa'] },
  // R6: iPhone 15 Pro Max NUNCA tuvo 128 GB. Arranca en 256.
  { id: '00000000-0000-4000-8000-000000000108', slug: 'iphone-15-pro-max', displayName: 'iPhone 15 Pro Max', releaseYear: 2023, storageOptionsGb: [256, 512, 1024], colors: ['Titanio negro', 'Titanio blanco', 'Titanio azul', 'Titanio natural'] },
  { id: '00000000-0000-4000-8000-000000000109', slug: 'iphone-xr', displayName: 'iPhone XR', releaseYear: 2018, storageOptionsGb: [64, 128, 256], colors: ['Negro', 'Blanco', 'Azul', 'Amarillo', 'Coral', '(PRODUCT)RED'] },
  { id: '00000000-0000-4000-8000-000000000110', slug: 'iphone-se-2a-gen', displayName: 'iPhone SE 2ª gen', releaseYear: 2020, storageOptionsGb: [64, 128, 256], colors: ['Negro', 'Blanco', '(PRODUCT)RED'] },
  { id: '00000000-0000-4000-8000-000000000111', slug: 'iphone-11-pro', displayName: 'iPhone 11 Pro', releaseYear: 2019, storageOptionsGb: [64, 256, 512], colors: ['Gris espacial', 'Plata', 'Oro', 'Verde medianoche'] },
  { id: '00000000-0000-4000-8000-000000000112', slug: 'iphone-11-pro-max', displayName: 'iPhone 11 Pro Max', releaseYear: 2019, storageOptionsGb: [64, 256, 512], colors: ['Gris espacial', 'Plata', 'Oro', 'Verde medianoche'] },
  { id: '00000000-0000-4000-8000-000000000113', slug: 'iphone-12-mini', displayName: 'iPhone 12 mini', releaseYear: 2020, storageOptionsGb: [64, 128, 256], colors: ['Negro', 'Blanco', 'Verde', 'Azul', 'Morado', '(PRODUCT)RED'] },
  { id: '00000000-0000-4000-8000-000000000114', slug: 'iphone-12-pro', displayName: 'iPhone 12 Pro', releaseYear: 2020, storageOptionsGb: [128, 256, 512], colors: ['Plata', 'Grafito', 'Oro', 'Azul pacífico'] },
  { id: '00000000-0000-4000-8000-000000000115', slug: 'iphone-12-pro-max', displayName: 'iPhone 12 Pro Max', releaseYear: 2020, storageOptionsGb: [128, 256, 512], colors: ['Plata', 'Grafito', 'Oro', 'Azul pacífico'] },
  { id: '00000000-0000-4000-8000-000000000116', slug: 'iphone-13-mini', displayName: 'iPhone 13 mini', releaseYear: 2021, storageOptionsGb: [128, 256, 512], colors: ['Medianoche', 'Blanco estelar', 'Azul', 'Rosa', 'Verde', '(PRODUCT)RED'] },
  { id: '00000000-0000-4000-8000-000000000117', slug: 'iphone-13-pro-max', displayName: 'iPhone 13 Pro Max', releaseYear: 2021, storageOptionsGb: [128, 256, 512, 1024], colors: ['Grafito', 'Oro', 'Plata', 'Azul Sierra', 'Verde alpino'] },
  { id: '00000000-0000-4000-8000-000000000118', slug: 'iphone-se-3a-gen', displayName: 'iPhone SE 3ª gen', releaseYear: 2022, storageOptionsGb: [64, 128, 256], colors: ['Medianoche', 'Blanco estelar', '(PRODUCT)RED'] },
  { id: '00000000-0000-4000-8000-000000000119', slug: 'iphone-14-plus', displayName: 'iPhone 14 Plus', releaseYear: 2022, storageOptionsGb: [128, 256, 512], colors: ['Medianoche', 'Morado', 'Blanco estelar', 'Azul', 'Amarillo', '(PRODUCT)RED'] },
  { id: '00000000-0000-4000-8000-000000000120', slug: 'iphone-14-pro-max', displayName: 'iPhone 14 Pro Max', releaseYear: 2022, storageOptionsGb: [128, 256, 512, 1024], colors: ['Negro espacial', 'Plata', 'Oro', 'Morado oscuro'] },
  { id: '00000000-0000-4000-8000-000000000121', slug: 'iphone-15-plus', displayName: 'iPhone 15 Plus', releaseYear: 2023, storageOptionsGb: [128, 256, 512], colors: ['Negro', 'Azul', 'Verde', 'Amarillo', 'Rosa'] },
  { id: '00000000-0000-4000-8000-000000000122', slug: 'iphone-15-pro', displayName: 'iPhone 15 Pro', releaseYear: 2023, storageOptionsGb: [128, 256, 512, 1024], colors: ['Titanio negro', 'Titanio blanco', 'Titanio azul', 'Titanio natural'] },
  { id: '00000000-0000-4000-8000-000000000123', slug: 'iphone-16', displayName: 'iPhone 16', releaseYear: 2024, storageOptionsGb: [128, 256, 512], colors: ['Negro', 'Blanco', 'Rosa', 'Verde azulado', 'Ultramarino'] },
  { id: '00000000-0000-4000-8000-000000000124', slug: 'iphone-16-plus', displayName: 'iPhone 16 Plus', releaseYear: 2024, storageOptionsGb: [128, 256, 512], colors: ['Negro', 'Blanco', 'Rosa', 'Verde azulado', 'Ultramarino'] },
  { id: '00000000-0000-4000-8000-000000000125', slug: 'iphone-16e', displayName: 'iPhone 16e', releaseYear: 2025, storageOptionsGb: [128, 256, 512], colors: ['Negro', 'Blanco'] },
  { id: '00000000-0000-4000-8000-000000000126', slug: 'iphone-16-pro', displayName: 'iPhone 16 Pro', releaseYear: 2024, storageOptionsGb: [128, 256, 512, 1024], colors: ['Titanio negro', 'Titanio blanco', 'Titanio natural', 'Titanio del desierto'] },
  { id: '00000000-0000-4000-8000-000000000127', slug: 'iphone-16-pro-max', displayName: 'iPhone 16 Pro Max', releaseYear: 2024, storageOptionsGb: [256, 512, 1024], colors: ['Titanio negro', 'Titanio blanco', 'Titanio natural', 'Titanio del desierto'] },
  { id: '00000000-0000-4000-8000-000000000128', slug: 'iphone-17', displayName: 'iPhone 17', releaseYear: 2025, storageOptionsGb: [256, 512], colors: ['Negro', 'Blanco', 'Azul neblina', 'Salvia', 'Lavanda'] },
  { id: '00000000-0000-4000-8000-000000000129', slug: 'iphone-air', displayName: 'iPhone Air', releaseYear: 2025, storageOptionsGb: [256, 512, 1024], colors: ['Negro espacial', 'Blanco nube', 'Oro claro', 'Azul cielo'] },
  { id: '00000000-0000-4000-8000-000000000130', slug: 'iphone-17-pro', displayName: 'iPhone 17 Pro', releaseYear: 2025, storageOptionsGb: [256, 512, 1024], colors: ['Plata', 'Naranja cósmico', 'Azul profundo'] },
  { id: '00000000-0000-4000-8000-000000000131', slug: 'iphone-17-pro-max', displayName: 'iPhone 17 Pro Max', releaseYear: 2025, storageOptionsGb: [256, 512, 1024, 2048], colors: ['Plata', 'Naranja cósmico', 'Azul profundo'] },
  { id: '00000000-0000-4000-8000-000000000132', slug: 'iphone-17e', displayName: 'iPhone 17e', releaseYear: 2026, storageOptionsGb: [256, 512], colors: ['Negro', 'Blanco', 'Rosa pálido'] },
];

export interface SeedListing {
  readonly id: string;
  readonly slug: string;
  readonly kind: 'unit' | 'lot';
  readonly modelSlug: string | null;
  readonly title: string;
  readonly storageGb: number | null;
  readonly color: string | null;
  readonly condition: Condition;
  readonly batteryPct: number | null;
  readonly screenOriginal: boolean | null;
  readonly icloudStatusText: string | null;
  readonly warrantyText: string | null;
  readonly provenanceText: string | null;
  readonly description: string;
  /** Centavos de USD. `numeric(12, 2)` en Postgres. */
  readonly priceUsdCents: number;
  /** SENSITIVE. Centavos de USD. El seller no lo ve. */
  readonly costUsdCents: number;
  readonly supplier: string | null;
  readonly internalNotes: string | null;
  /** 15 dígitos. Sólo en `unit`. **Nunca** sale del panel. */
  readonly imei: string | null;
  readonly qty: number;
  readonly status: ListingStatus;
}

/**
 * Dólares enteros → `Cents` (centavos enteros, `packages/domain/src/money.ts`).
 *
 * DEFECTO CORREGIDO 2026-08-28: `SEED_LISTINGS` escribía los montos como un literal tipo
 * `62_000_00`. Un humano lo lee como "62.000 con 00 centavos"; el tipo `Cents` lo interpreta
 * como 6.200.000 centavos = USD 62.000 — **cien veces** el precio que se quiso escribir (USD 620,
 * el mismo que cita CLAUDE.md §1 en el mensaje canónico de WhatsApp). El literal de centavos con
 * grouping de a tres dígitos es indistinguible a simple vista de un literal con dos ceros de
 * centavos pegados al final: esa ambigüedad es la causa raíz, no un typo puntual.
 *
 * Por eso ningún campo de `SEED_LISTINGS` vuelve a escribir centavos a mano: se escribe el precio
 * en **dólares enteros**, tal como lo diría el dueño del local, y `usd()` hace la multiplicación
 * por `CENTS_PER_UNIT`. Si el próximo renglón necesita centavos (ej. `18.50`), `usd()` tira
 * `DomainError` en vez de truncar en silencio — mejor romper el seed que publicar mal un precio.
 */
function usd(dollars: number): Cents {
  if (!Number.isInteger(dollars)) {
    throw new Error(`usd(): esperaba dólares enteros, recibí ${String(dollars)}`);
  }
  return dollars * CENTS_PER_UNIT;
}

/**
 * 8 iPhones + 2 accesorios. Estados: 6 `available` + 1 `reserved` + 1 `sold` entre los iPhones,
 * y los 2 accesorios `available`. **Exactamente uno** en `reserved`, que es el gate de D4.
 *
 * Los IMEI son inválidos por Luhn a propósito en un caso (`imei-luhn-malo`) para que el warning
 * NO bloqueante de `packages/domain` tenga contra qué probarse: ADR-009 exige poder cargar un
 * equipo con IMEI mal grabado, justamente para marcarlo y no venderlo.
 */
export const SEED_LISTINGS: readonly SeedListing[] = [
  {
    id: '00000000-0000-4000-8000-000000000201', slug: 'iphone-14-pro-256-grafito', kind: 'unit',
    modelSlug: 'iphone-14-pro', title: 'iPhone 14 Pro 256 GB Negro espacial', storageGb: 256,
    color: 'Negro espacial', condition: 'used_excellent', batteryPct: 89, screenOriginal: true,
    icloudStatusText: 'Libre de iCloud, verificado en el local',
    warrantyText: '90 días de garantía del local', provenanceText: 'Compra directa a cliente en Cipolletti',
    description: 'Impecable, sin detalles en pantalla. Se entrega con caja y cable.',
    priceUsdCents: usd(620), costUsdCents: usd(520), supplier: 'Canje mostrador',
    internalNotes: 'Entró por canje, chequear Face ID antes de entregar.',
    imei: '353915107912345', qty: 1, status: 'available',
  },
  {
    id: '00000000-0000-4000-8000-000000000202', slug: 'iphone-13-128-medianoche', kind: 'unit',
    modelSlug: 'iphone-13', title: 'iPhone 13 128 GB Medianoche', storageGb: 128,
    color: 'Medianoche', condition: 'tester_a_plus', batteryPct: 92, screenOriginal: true,
    icloudStatusText: 'Libre de iCloud', warrantyText: '30 días de garantía del local',
    provenanceText: 'Importado, ingreso declarado',
    description: 'Tester A+: batería 92%, pantalla original, Face ID OK.',
    priceUsdCents: usd(430), costUsdCents: usd(365), supplier: 'Mayorista Buenos Aires',
    internalNotes: 'Lote de 5, quedan 1.', imei: '354398765432101', qty: 1, status: 'available',
  },
  {
    id: '00000000-0000-4000-8000-000000000203', slug: 'iphone-15-128-negro', kind: 'unit',
    modelSlug: 'iphone-15', title: 'iPhone 15 128 GB Negro', storageGb: 128, color: 'Negro',
    condition: 'sealed', batteryPct: 100, screenOriginal: true,
    icloudStatusText: 'Sellado de fábrica', warrantyText: '1 año Apple',
    provenanceText: 'Importado, caja cerrada',
    description: 'Sellado, caja cerrada. Precio de contado.',
    priceUsdCents: usd(710), costUsdCents: usd(630), supplier: 'Mayorista Buenos Aires',
    internalNotes: null, imei: '356938035643809', qty: 1, status: 'available',
  },
  {
    id: '00000000-0000-4000-8000-000000000204', slug: 'iphone-12-64-azul', kind: 'unit',
    modelSlug: 'iphone-12', title: 'iPhone 12 64 GB Azul', storageGb: 64, color: 'Azul',
    condition: 'used_with_detail', batteryPct: 79, screenOriginal: false,
    icloudStatusText: 'Libre de iCloud', warrantyText: '30 días del local',
    provenanceText: 'Canje presencial en Neuquén',
    description: 'Pantalla cambiada por service, funciona perfecto. Detalle estético en la tapa.',
    priceUsdCents: usd(255), costUsdCents: usd(200), supplier: 'Canje mostrador',
    internalNotes: 'Módulo alternativo, avisarlo siempre.', imei: '351824059334455', qty: 1, status: 'available',
  },
  {
    id: '00000000-0000-4000-8000-000000000205', slug: 'iphone-11-128-blanco', kind: 'unit',
    modelSlug: 'iphone-11', title: 'iPhone 11 128 GB Blanco', storageGb: 128, color: 'Blanco',
    condition: 'used_excellent', batteryPct: 84, screenOriginal: true,
    icloudStatusText: 'Libre de iCloud', warrantyText: '30 días del local',
    provenanceText: 'Canje presencial en Cipolletti',
    description: 'Muy buen estado general, batería 84%.',
    priceUsdCents: usd(210), costUsdCents: usd(165), supplier: 'Canje mostrador',
    internalNotes: null, imei: '352099001122334', qty: 1, status: 'available',
  },
  {
    id: '00000000-0000-4000-8000-000000000206', slug: 'iphone-13-pro-256-verde-alpino', kind: 'unit',
    modelSlug: 'iphone-13-pro', title: 'iPhone 13 Pro 256 GB Verde alpino', storageGb: 256,
    color: 'Verde alpino', condition: 'used_excellent', batteryPct: 87, screenOriginal: true,
    icloudStatusText: 'Libre de iCloud', warrantyText: '90 días del local',
    provenanceText: 'Compra a cliente conocido',
    // IMEI con dígito verificador malo a propósito: Luhn es warning, NO gate de alta (ADR-009).
    description: 'Color difícil de conseguir. Impecable.',
    priceUsdCents: usd(550), costUsdCents: usd(470), supplier: 'Canje mostrador',
    internalNotes: 'IMEI no valida Luhn: revisar grabado antes de publicar en otro lado.',
    imei: '353915107912341', qty: 1, status: 'available',
  },
  {
    id: '00000000-0000-4000-8000-000000000207', slug: 'iphone-15-pro-max-256-titanio-natural', kind: 'unit',
    modelSlug: 'iphone-15-pro-max', title: 'iPhone 15 Pro Max 256 GB Titanio natural', storageGb: 256,
    color: 'Titanio natural', condition: 'open_box', batteryPct: 100, screenOriginal: true,
    icloudStatusText: 'Libre de iCloud, sin cuenta', warrantyText: 'Garantía Apple vigente',
    provenanceText: 'Open box, abierto sólo para probar',
    description: 'Open box, cero uso. Se entrega con caja y accesorios.',
    priceUsdCents: usd(1180), costUsdCents: usd(1040), supplier: 'Mayorista Buenos Aires',
    internalNotes: null, imei: '357123456789012', qty: 1, status: 'reserved',
  },
  {
    id: '00000000-0000-4000-8000-000000000208', slug: 'iphone-14-128-azul', kind: 'unit',
    modelSlug: 'iphone-14', title: 'iPhone 14 128 GB Azul', storageGb: 128, color: 'Azul',
    condition: 'used_excellent', batteryPct: 91, screenOriginal: true,
    icloudStatusText: 'Libre de iCloud', warrantyText: '90 días del local',
    provenanceText: 'Canje presencial en Neuquén',
    description: 'Vendido el 26/08. Queda de referencia de precio.',
    priceUsdCents: usd(470), costUsdCents: usd(390), supplier: 'Canje mostrador',
    internalNotes: 'Vendido a cliente de Plottier.', imei: '358240051111222', qty: 1, status: 'sold',
  },
  // ── Accesorios: `lot`. Sin IMEI (lo impide un CHECK, no la buena voluntad del código). ──
  {
    id: '00000000-0000-4000-8000-000000000209', slug: 'cargador-20w-usbc', kind: 'lot',
    modelSlug: null, title: 'Cargador 20W USB-C (compatible)', storageGb: null, color: 'Blanco',
    condition: 'sealed', batteryPct: null, screenOriginal: null,
    icloudStatusText: null, warrantyText: '30 días del local', provenanceText: 'Compra mayorista',
    description: 'Carga rápida, compatible con iPhone 8 en adelante.',
    priceUsdCents: usd(18), costUsdCents: usd(11), supplier: 'Mayorista accesorios',
    internalNotes: null, imei: null, qty: 24, status: 'available',
  },
  {
    id: '00000000-0000-4000-8000-000000000210', slug: 'vidrio-templado-iphone-14', kind: 'lot',
    modelSlug: null, title: 'Vidrio templado iPhone 14 / 14 Pro', storageGb: null, color: 'Transparente',
    condition: 'sealed', batteryPct: null, screenOriginal: null,
    icloudStatusText: null, warrantyText: 'Colocación incluida', provenanceText: 'Compra mayorista',
    description: 'Se coloca en el local sin cargo.',
    priceUsdCents: usd(9), costUsdCents: usd(4), supplier: 'Mayorista accesorios',
    internalNotes: null, imei: null, qty: 40, status: 'available',
  },
];

/**
 * Key pública **opaca y content-addressed** (ADR-006): `v1/{ab}/{sha256_32}.webp`.
 * Sin `tenant_id`, sin `listing_id` y **sin sufijo de variante** → desde la URL de `card` no se
 * puede derivar la del `master`. Determinista: es un hash, no un random.
 */
export function seedMediaKey(listingSlug: string, index: number, variant: string): string {
  const hash = createHash('sha256').update(`istock-seed/${listingSlug}/${String(index)}/${variant}`).digest('hex');
  return `v1/${hash.slice(0, 2)}/${hash.slice(0, 32)}.webp`;
}

/** UUID canónico en minúsculas. El master es jerárquico y los dos segmentos son UUID o no es. */
const SEED_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Key del master (ADR-006): `originals/{tenant_id}/{listing_id}/{sha256_32}.webp`.
 *
 * El master vive en el bucket **PRIVADO** `istock-originals` y su key nunca sale del server; por
 * eso —y sólo por eso— acá sí es jerárquica: habilita auditoría e inventario por tenant.
 *
 * Recibe los dos UUID **como objeto y no como dos posicionales** a propósito: dos strings con la
 * misma forma, adyacentes, se invierten sin que nada se ponga rojo, y una key con tenant y listing
 * cruzados sigue matcheando el regex. El nombre del campo es el único chequeo posible.
 *
 * Determinista igual que antes: el hash sale del slug + índice, no de un byte real, porque el seed
 * no sube nada a R2. Lo que se arregló es la **forma**: emitía `originals/{2hex}/{32hex}.jpg`, que
 * no matchea `isMasterObjectKey` de `packages/media` ni en segmentos ni en extensión. Nadie la leía
 * todavía, así que el bug estaba latente y verde: el día que un job de GC filtre por esa forma,
 * ignora en silencio todas las filas del demo.
 */
export function seedMasterKey(params: {
  readonly tenantId: string;
  readonly listingId: string;
  readonly listingSlug: string;
  readonly index: number;
}): string {
  const tenantId = params.tenantId.toLowerCase();
  const listingId = params.listingId.toLowerCase();
  if (!SEED_UUID_RE.test(tenantId) || !SEED_UUID_RE.test(listingId)) {
    throw new Error('seedMasterKey: tenantId y listingId tienen que ser UUID');
  }
  const hash = createHash('sha256')
    .update(`istock-seed-master/${params.listingSlug}/${String(params.index)}`)
    .digest('hex');
  return `originals/${tenantId}/${listingId}/${hash.slice(0, 32)}.webp`;
}

export function hoursAfter(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 3_600_000);
}

export function daysAfter(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}
