/**
 * Datos del seed demo. **Determinista**: cero `Math.random`, cero `Date.now`.
 *
 * Por qué importa: un seed con azar hace que el gate de aceptación ("8 iPhones + 2 accesorios +
 * 1 `reserved`") pase o falle según el humor de la corrida, y hace que un test de vidriera no
 * pueda afirmar nada sobre lo que ve. Los UUID son constantes escritas a mano; el "ahora" es una
 * constante; las keys de R2 se derivan por SHA-256 del slug (una función, no un dado) y respetan
 * la forma de ADR-006 (`v1/{ab}/{32hex}.webp` la pública, `originals/{tenant}/{listing}/{32hex}.webp`
 * el master), porque un dato de demo con forma inválida es un bug esperando a que alguien lo lea.
 *
 * Modelos y colores salen de `docs/research/apple-catalog-ar.md` (R6, PASS): nombres de color tal
 * cual los escribe Apple es-LAMR, que es la forma que copia el mercado argentino, y capacidades
 * que **existieron de fábrica**.
 */

import { createHash } from 'node:crypto';
import { CENTS_PER_UNIT, type Cents, type Condition, type ListingStatus } from '@istock/domain';

/** Instante fijo del seed. Todo lo que dependa del tiempo se calcula desde acá. */
export const SEED_NOW = new Date('2026-08-27T15:00:00.000Z');

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

/** Sólo las líneas que el reseller del Alto Valle carga de verdad (top de frecuencia en R6). */
export const SEED_MODELS: readonly SeedModel[] = [
  { id: '00000000-0000-4000-8000-000000000101', slug: 'iphone-11', displayName: 'iPhone 11', releaseYear: 2019, storageOptionsGb: [64, 128, 256], colors: ['Negro', 'Blanco', 'Verde', 'Amarillo', 'Morado'] },
  { id: '00000000-0000-4000-8000-000000000102', slug: 'iphone-12', displayName: 'iPhone 12', releaseYear: 2020, storageOptionsGb: [64, 128, 256], colors: ['Negro', 'Blanco', 'Verde', 'Azul', 'Morado'] },
  { id: '00000000-0000-4000-8000-000000000103', slug: 'iphone-13', displayName: 'iPhone 13', releaseYear: 2021, storageOptionsGb: [128, 256, 512], colors: ['Medianoche', 'Blanco estelar', 'Azul', 'Rosa', 'Verde'] },
  { id: '00000000-0000-4000-8000-000000000104', slug: 'iphone-13-pro', displayName: 'iPhone 13 Pro', releaseYear: 2021, storageOptionsGb: [128, 256, 512, 1024], colors: ['Grafito', 'Oro', 'Plata', 'Azul Sierra', 'Verde alpino'] },
  { id: '00000000-0000-4000-8000-000000000105', slug: 'iphone-14', displayName: 'iPhone 14', releaseYear: 2022, storageOptionsGb: [128, 256, 512], colors: ['Medianoche', 'Morado', 'Blanco estelar', 'Azul', 'Amarillo'] },
  // R6: iPhone 14 Pro NUNCA tuvo 64 GB. Arranca en 128.
  { id: '00000000-0000-4000-8000-000000000106', slug: 'iphone-14-pro', displayName: 'iPhone 14 Pro', releaseYear: 2022, storageOptionsGb: [128, 256, 512, 1024], colors: ['Negro espacial', 'Plata', 'Oro', 'Morado oscuro'] },
  { id: '00000000-0000-4000-8000-000000000107', slug: 'iphone-15', displayName: 'iPhone 15', releaseYear: 2023, storageOptionsGb: [128, 256, 512], colors: ['Negro', 'Azul', 'Verde', 'Amarillo', 'Rosa'] },
  // R6: iPhone 15 Pro Max NUNCA tuvo 128 GB. Arranca en 256.
  { id: '00000000-0000-4000-8000-000000000108', slug: 'iphone-15-pro-max', displayName: 'iPhone 15 Pro Max', releaseYear: 2023, storageOptionsGb: [256, 512, 1024], colors: ['Titanio negro', 'Titanio blanco', 'Titanio azul', 'Titanio natural'] },
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

export function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

export function daysAfter(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}
