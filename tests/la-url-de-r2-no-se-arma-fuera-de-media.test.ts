/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  NADIE FUERA DE `packages/media` ARMA UNA URL DE R2, HABLA S3 NI BORRA UN BYTE. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Qué sostiene, y por qué no lo puede sostener un e2e
 * El e2e de S2 prueba el **síntoma** sobre la foto de esta corrida: la URL que emitió el panel no
 * trae el `tenant_id`, el master no se puede bajar, `card` pesa ≤ 150 KB. Todo cierto, y todo
 * sobre **una** foto y **un** camino. Este archivo prueba la **clase**, en milisegundos y sin
 * build: que no exista en el repo ningún *otro* lugar desde donde una key pueda armarse a mano.
 *
 * Tres reglas de `CLAUDE.md` §2 dependen de eso y ninguna es observable desde afuera hasta que ya
 * pasó:
 *
 * 1. *"URL pública de foto que contenga `tenant_id`/`listing_id`, o desde la que se pueda derivar
 *    la key del master → rechazo."* La garantía no está en la URL: está en que la **única**
 *    función que arma URLs es `variantUrl()`, que recibe el mapeo y **elige** en vez de calcular.
 *    Un `` `${base}/${photo.cardKey}` `` escrito en un componente compila, funciona y borra esa
 *    garantía sin que ningún test de runtime se entere — hasta el día que alguien escriba
 *    `` `${base}/t/${tenantId}/...` `` en la línea de al lado.
 * 2. *"Master/original en un bucket R2 público → rechazo."* Quien pueda instanciar un `S3Client`
 *    fuera del paquete puede elegir el bucket, y ahí se acabó la separación entre
 *    `istock-media` (público) e `istock-originals` (privado).
 * 3. *"Borrado de un objeto de R2 por key al borrar un listing → rechazo."* Ésta es la peor de las
 *    tres porque el daño es de **otro tenant**: la key es content-addressed
 *    (`v1/{ab}/{sha256_32}.webp` = hash del byte de salida), así que dos resellers que suban la
 *    misma foto de fábrica **comparten el objeto**. El tenant B se queda sin vidriera porque el
 *    tenant A borró un equipo. No hay error, no hay log, y el e2e de un solo tenant nunca lo ve.
 *    **Se borra el mapeo, no el byte.**
 *
 * ## Por qué el guard se prueba a sí mismo
 * Un guard cuyo detector nunca se vio disparar es un guard que puede estar roto desde hace meses:
 * el regex se rompe en un refactor, el scan deja de encontrar archivos, y el archivo sigue en
 * verde diciendo que todo está bien. Por eso abajo hay dos bloques que corren los mismos
 * detectores contra **fuentes plantadas en memoria**: los positivos tienen que dar rojo y los
 * negativos —`db.delete(listings)`, `headers.delete()`, un `<img src={variantUrl(...)}>` legítimo—
 * tienen que quedar limpios. Sin los negativos esto sería un grep que rechaza la palabra `delete`
 * y todo el mundo aprendería a esquivarlo.
 *
 * ## Alcance
 * Se escanea `apps/**`, `packages/**` (menos `packages/media`) y `scripts/**`, en `.ts`/`.tsx`/
 * `.mjs`/`.js`. **`e2e/**` y `tests/**` quedan afuera a propósito**: un test tiene que poder
 * escribir la URL prohibida para probar que está prohibida, y el `webServer` de Playwright tiene
 * que poder setear `NEXT_PUBLIC_MEDIA_BASE_URL` para que el server bajo prueba sepa a qué host
 * servir. Confundir "config del banco de pruebas" con "producto" haría el guard inaplicable.
 *
 * ## Qué NO es una infracción
 * Un subpath que `packages/media/package.json` **declara** en su `exports` es superficie pública,
 * decidida por el owner del paquete, igual que `.`. La lista de permitidos se deriva de ahí y no se
 * escribe acá; el detalle y sus dos modos de falla están sobre `deepImportPattern`.
 *
 * `qa-agent` no arregla el código bajo test. Si esto se pone rojo, el defecto es de la impl.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** El único directorio autorizado a conocer el bucket, la base del CDN y el formato de las keys. */
const MEDIA_PACKAGE = `packages${sep}media`;

const SCAN_ROOTS = ['apps', 'packages', 'scripts'] as const;
const SCANNED_EXT = /\.(?:ts|tsx|mjs|js)$/u;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage', '.turbo', 'drizzle']);

/**
 * Los tests quedan afuera del escaneo, por la misma razón por la que quedan afuera `e2e/**` y
 * `tests/**`: **un test tiene que poder escribir el string prohibido para probar que está
 * prohibido**. `packages/db/src/rls-anon-storefront.test.ts` mete un `master_key` de mentira
 * (`originals/secreto.jpg`) justamente para demostrar que `anon` no lo puede leer, y el probe de
 * S2 del LEAD (`scripts/probes/*.test.ts`) importa `packages/media/src/pipeline` a propósito para
 * medirlo sin pasar por el índice. Rechazar eso sería rechazar la evidencia.
 *
 * El costo declarado: un `S3Client` escondido en un `.test.ts` no se detecta. No llega a
 * producción, así que el riesgo es de disciplina, no de la vidriera.
 */
const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx|mjs|js)$/u;

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Excepciones declaradas. **Con fecha de vencimiento incorporada.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Una excepción silenciosa es una regla derogada. Cada entrada de acá tiene su propio test que
 * falla **cuando la excepción deja de hacer falta**: si alguien arregla el archivo y la excepción
 * queda, el guard se pone rojo pidiendo que se borre. Así el allowlist no puede crecer por inercia
 * ni sobrevivir a su motivo.
 */
const EXEMPT: ReadonlyArray<{ readonly path: string; readonly why: string }> = [
  {
    path: join('packages', 'db', 'src', 'seed-data.ts'),
    why:
      'el seed fabrica keys de demo **sin subir un byte a ningún lado** (`seedMediaKey` / ' +
      '`seedMasterKey`): el hash sale del slug y del índice, no del contenido. Por eso dispara ' +
      '`key-de-media-a-mano` —escribe el literal `originals/` y arma la key con un template— y ' +
      'por eso la infracción es inocua: no hay objeto real que dos tenants puedan compartir, no ' +
      'hay URL pública que filtre nada, y nada de esto corre en un request. Es anterior a esta ' +
      'slice y su owner es `db-agent`.\n' +
      'La **forma** ya no es parte del motivo: `seedMasterKey` emite ' +
      '`originals/{tenant_id}/{listing_id}/{sha256_32}.webp` (ADR-006) y toma los dos UUID como ' +
      'objeto, así que tenant y listing no se pueden invertir en silencio. Verificado contra el ' +
      'regex de `packages/media`. Si algún día el seed subiera bytes de verdad, esta excepción ' +
      'deja de ser inocua y hay que sacarla, no ampliarla.',
  },
];

function isExempt(relPath: string): boolean {
  return EXEMPT.some((e) => e.path === relPath);
}

// ── la superficie pública de `@istock/media`, derivada y no escrita a mano ────────────────────

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  Qué es un import profundo, y qué NO lo es
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Hasta el 2026-08-28 este archivo trataba **cualquier** `@istock/media/<algo>` como infracción.
 * Era correcto mientras el paquete tuvo un solo entrypoint, y dejó de serlo el día que
 * `media-agent` declaró `"./incidents"` en el `exports` de `packages/media/package.json`: un
 * entrypoint propio (`src/incidents-entry.ts`), de superficie elegida a mano, que arrastra 3
 * módulos y **cero** objetos nativos contra los 265 módulos y el `sharp` + `libvips` del barrel.
 * Existe para que el cableado de observabilidad no cargue `sharp` durante `register()`. Con la
 * regla vieja, el import correcto ponía el guard en rojo: el gate le habría cobrado peaje a la
 * corrección, que es la forma más rápida de que alguien lo apague.
 *
 * La distinción que hace falta no es "con barra / sin barra", es **quién decidió el path**:
 *
 * - `@istock/media/incidents` → el `package.json` del paquete lo declara. Es superficie pública,
 *   decidida por el owner, igual que `.`. **Permitido.**
 * - `@istock/media/src/storage/r2`, `../../packages/media/src/keys` → nadie lo declaró; se alcanza
 *   el interior por la forma del filesystem. **Prohibido**, y es de lo que la regla vino a
 *   defender: la key de R2 se arma en un solo lugar y ese lugar tiene una puerta.
 *
 * Por eso los subpaths permitidos **se derivan del `exports`** en vez de escribirse acá. Una lista
 * a mano se desactualiza con el próximo subpath y devuelve el problema a esta línea; derivada, la
 * regla dice literalmente *"lo que el owner declaró está bien, lo demás no"*.
 *
 * **Dos cosas que la derivación NO delega**, porque si no el gate terminaría siendo del mismo
 * writer que el código que audita (`CLAUDE.md` §4):
 *
 * 1. Si el `exports` no se puede leer, parsear, o no es un objeto, la lista de permitidos queda
 *    **vacía**, y con la lista vacía `deepImportPattern` rechaza *todo* subpath. O sea: el modo de
 *    falla de la derivación es **más estricto**, nunca más permisivo. Ausencia de medición no es
 *    PASS — y además hay un test dedicado que se pone rojo con el motivo.
 * 2. Un subpath declarado que apunta al **interior** (`./src/…`, `./dist/…`) no se honra. Si se
 *    honrara, este guard se apagaría con una línea de `package.json`, que es un archivo de otra
 *    columna. Qué es superficie pública lo decide `media-agent`; que el guard exista, no.
 */
const MEDIA_MANIFEST = join('packages', 'media', 'package.json');

/** Un subpath declarado que apunta al interior del paquete no cuenta como superficie pública. */
const INTERNAL_SUBPATH = /^(?:src|dist|build|node_modules|internal)(?:\/|$)/u;

interface MediaSurface {
  /** Subpaths públicos, sin el `./` (p. ej. `incidents`). Vacío si no se pudo derivar. */
  readonly subpaths: readonly string[];
  /** Subpaths declarados que apuntan al interior y por eso **no** se honran. */
  readonly internal: readonly string[];
  /** `null` si se derivó bien; el motivo si no. */
  readonly failure: string | null;
}

/** Lee la superficie pública del paquete desde su `package.json`. Nunca inventa: falla y avisa. */
function readMediaSurface(): MediaSurface {
  const empty = { subpaths: [] as readonly string[], internal: [] as readonly string[] };
  let raw: string;
  try {
    raw = readFileSync(join(REPO, MEDIA_MANIFEST), 'utf8');
  } catch {
    return { ...empty, failure: `no se pudo leer ${MEDIA_MANIFEST}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ...empty, failure: `${MEDIA_MANIFEST} no es JSON válido` };
  }
  const field = (parsed as { readonly exports?: unknown }).exports;
  if (typeof field !== 'object' || field === null || Array.isArray(field)) {
    return { ...empty, failure: `${MEDIA_MANIFEST} no declara un objeto \`exports\`` };
  }
  const keys = Object.keys(field);
  if (!keys.includes('.')) {
    return {
      ...empty,
      failure: `el \`exports\` de ${MEDIA_MANIFEST} no declara el entrypoint "."`,
    };
  }
  const declared = keys.filter((key) => key.startsWith('./')).map((key) => key.slice(2));
  return {
    subpaths: declared.filter((sub) => !INTERNAL_SUBPATH.test(sub)),
    internal: declared.filter((sub) => INTERNAL_SUBPATH.test(sub)),
    failure: null,
  };
}

const MEDIA_SURFACE = readMediaSurface();

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Un `./variantes/*` en el `exports` se traduce a un comodín **dentro del specifier**, no a "todo
 * pasa": el `*` no cruza la comilla, así que sigue siendo un subpath y no una licencia.
 */
function subpathPattern(subpath: string): string {
  return subpath.split('*').map(escapeRegExp).join("[^'\"]*");
}

/**
 * El specifier de un import, en cualquiera de sus formas: `from '…'`, el `import '…'` de efecto
 * secundario, `await import('…')` y `require('…')`. Las formas dinámicas importan acá y no son
 * teóricas: el cableado de incidentes de `apps/web/instrumentation.ts` es un `await import(...)`
 * justamente para no cargar `sharp` en el bootstrap, así que un detector que sólo mirara `from`
 * sería ciego en el único archivo donde este subpath se usa de verdad.
 */
const IMPORT_SPECIFIER = String.raw`(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]`;

/**
 * El detector de import profundo, construido a partir de los subpaths que el paquete declara.
 *
 * Se exporta con la lista como parámetro —en vez de cerrarse sobre `MEDIA_SURFACE`— para poder
 * probar **los dos extremos de la derivación**: que con `['incidents']` deja pasar el subpath, y
 * que con `[]` no deja pasar ninguno. Sin ese segundo caso, "derivo del `exports`" podría estar
 * derivando de un objeto vacío y nadie se enteraría.
 */
export function deepImportPattern(allowedSubpaths: readonly string[]): RegExp {
  const allowed = allowedSubpaths.map(subpathPattern).join('|');
  return new RegExp(
    `${IMPORT_SPECIFIER}(?:@istock/media/(?!(?:${allowed})['"])|[^'"]*packages/media/src/)`,
    'u',
  );
}

/** Cómo se le nombra la superficie al que leyó el error, sin que tenga que abrir el package.json. */
function surfaceLabel(): string {
  if (MEDIA_SURFACE.failure !== null) {
    return `NO SE PUDO DERIVAR (${MEDIA_SURFACE.failure}), así que no hay subpath permitido`;
  }
  return ['@istock/media', ...MEDIA_SURFACE.subpaths.map((s) => `@istock/media/${s}`)].join(', ');
}

// ── los detectores ────────────────────────────────────────────────────────────────────────────

interface Rule {
  readonly id: string;
  readonly why: string;
  readonly re: RegExp;
}

/**
 * Las reglas se escriben sobre **líneas de código**, no sobre el archivo entero: así el mensaje
 * de error apunta a una línea y no a un archivo de 300 líneas, y así una línea de comentario que
 * *menciona* la prohibición (que es lo que hacen los docblocks de todo este repo) no se confunde
 * con una infracción.
 */
const RULES: readonly Rule[] = [
  {
    id: 'cliente-s3-afuera',
    why:
      'importa el cliente de S3/R2 fuera de `packages/media`. Quien elige el `Bucket` puede poner ' +
      'el master en el bucket público (CLAUDE.md §2). El acceso a R2 pasa por `uploadListingPhoto`.',
    re: /@aws-sdk\/client-s3|\bS3Client\b|\bPutObjectCommand\b|\bGetObjectCommand\b|\bHeadObjectCommand\b|\baws4fetch\b|\bAwsClient\b/u,
  },
  {
    id: 'borrado-de-objeto-afuera',
    why:
      'borra un objeto de storage fuera de `packages/media`. La key es content-addressed: dos ' +
      'tenants comparten el objeto, así que borrar por key es borrado cruzado. Se borra el mapeo, ' +
      'no el byte (CLAUDE.md §2). El único camino a un DELETE es `collectOrphanObjects`, y pide ' +
      'probar que ningún tenant referencia la key.',
    re: /\bDeleteObjectCommand\b|\bdeleteObject\s*\(|\b(?:driver|storage|s3|r2|bucket)\s*\.\s*delete\s*\(|\.\s*delete\s*\(\s*['"](?:media|originals)['"]/iu,
  },
  {
    id: 'url-de-cdn-a-mano',
    why:
      'arma la URL del CDN a mano. Nadie fuera de `packages/media` conoce la base ni el bucket: ' +
      'se usa `variantUrl(photo, variant)`, que recibe el mapeo de `listing_photos` y elige la key ' +
      'en vez de calcularla.',
    re: /NEXT_PUBLIC_MEDIA_BASE_URL|img\.maat\.work|r2\.cloudflarestorage\.com|\.r2\.dev|\bR2_(?:BUCKET|ACCOUNT|ACCESS_KEY|SECRET)/u,
  },
  {
    id: 'key-de-media-a-mano',
    why:
      'construye una key de objeto a mano. Con el esquema opaco de ADR-006 una variante NO se ' +
      'deriva de otra: si alguien la calcula, volvió a existir un camino desde la URL pública ' +
      'hacia la key del master.',
    re: /['"`]v1\/[0-9a-z{$]|\$\{[^}\n]*\}[^\n]*\.webp|\.webp[^\n]*\$\{|['"`]originals\//u,
  },
  {
    id: 'import-profundo-a-media',
    why:
      'entra a `packages/media` por un path que el paquete NO declara en su `exports`, o directo ' +
      'por el filesystem (`packages/media/src/...`). Lo que el paquete no declara público no ' +
      'existe para el resto del monorepo: es por ahí por donde vuelve a haber un camino a la key ' +
      `de R2 que no pasa por la puerta. Superficie pública declarada hoy: ${surfaceLabel()}.`,
    re: deepImportPattern(MEDIA_SURFACE.subpaths),
  },
];

/** `true` si la línea es sólo comentario: mencionar la prohibición no es cometerla. */
function isComment(line: string): boolean {
  return /^\s*(?:\/\/|\/\*|\*)/u.test(line);
}

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly why: string;
  readonly code: string;
}

/** El detector, aislado del filesystem para poder correrlo contra fuentes plantadas. */
export function inspect(file: string, source: string): Finding[] {
  const found: Finding[] = [];
  source.split('\n').forEach((line, index) => {
    if (isComment(line)) return;
    for (const rule of RULES) {
      if (!rule.re.test(line)) continue;
      found.push({
        file,
        line: index + 1,
        rule: rule.id,
        why: rule.why,
        code: line.trim().slice(0, 120),
      });
    }
  });
  return found;
}

// ── el filesystem ─────────────────────────────────────────────────────────────────────────────

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCANNED_EXT.test(entry)) out.push(full);
  }
}

/** Todo lo escaneable, sin filtrar por excepciones: lo que el guard mira antes de perdonar nada. */
function shippedFiles(): string[] {
  const out: string[] = [];
  for (const root of SCAN_ROOTS) walk(join(REPO, root), out);
  return out.filter((file) => {
    const rel = relative(REPO, file);
    return !rel.startsWith(MEDIA_PACKAGE) && !TEST_FILE.test(rel);
  });
}

function filesUnderReview(): string[] {
  return shippedFiles().filter((file) => !isExempt(relative(REPO, file)));
}

function report(findings: readonly Finding[]): string {
  return findings
    .map((f) => `  ${relative(REPO, f.file)}:${f.line}  [${f.rule}] ${f.why}\n      → ${f.code}`)
    .join('\n');
}

// ── el guard sobre el repo real ───────────────────────────────────────────────────────────────

describe('el conocimiento de R2 no se escapa de packages/media', () => {
  const files = filesUnderReview();

  it('ningún archivo de la app conoce el bucket, la base del CDN ni el formato de las keys', () => {
    // Sin esto el test pasaría por vacío el día que cambie el layout del monorepo: cero archivos
    // escaneados es cero infracciones, y el verde diría exactamente lo contrario de la verdad.
    expect(
      files.length,
      `no se escaneó ningún archivo bajo ${SCAN_ROOTS.join(', ')}: el guard estaría vacío`,
    ).toBeGreaterThan(20);
    expect(
      files.map((f) => relative(REPO, f)),
      'el proxy tiene que estar dentro del escaneo: es el archivo más caliente del repo',
    ).toContain(join('apps', 'web', 'proxy.ts'));

    const findings = files.flatMap((file) => inspect(file, readFileSync(file, 'utf8')));
    expect(
      findings,
      `hay ${findings.length} lugar(es) fuera de packages/media que tocan R2 a mano:\n${report(findings)}`,
    ).toEqual([]);
  });

  it('cada excepción declarada sigue haciendo falta o el guard pide que se borre', () => {
    for (const exemption of EXEMPT) {
      const full = join(REPO, exemption.path);
      const findings = inspect(full, readFileSync(full, 'utf8'));
      expect(
        findings.length,
        `${exemption.path} ya no infringe nada: sacá la excepción de EXEMPT en vez de dejarla ` +
          'abierta. Una excepción que sobrevive a su motivo es una regla derogada en silencio.',
      ).toBeGreaterThan(0);
    }
  });

  it('el borrado de un listing suelta el mapeo y no toca un solo byte de R2', () => {
    const unlink = join(REPO, 'packages/media/src/unlink.ts');
    const source = readFileSync(unlink, 'utf8');

    // El archivo tiene dos mitades y la frontera es explícita: arriba el camino que corre cuando
    // el dueño borra un equipo, abajo el job de recolección. Se afirma sobre la mitad de arriba.
    const gcAt = source.indexOf('export async function collectOrphanObjects');
    expect(
      gcAt,
      'packages/media/src/unlink.ts ya no declara `collectOrphanObjects`: el guard perdió su ancla',
    ).toBeGreaterThan(0);

    const listingDeletePath = source.slice(0, gcAt);
    const inPath = inspect(unlink, listingDeletePath).filter(
      (f) => f.rule === 'borrado-de-objeto-afuera',
    );
    expect(
      inPath,
      `el camino de borrado de un listing borra objetos de R2:\n${report(inPath)}`,
    ).toEqual([]);

    // El contrato está en el tipo, no en un comentario: `deletedObjects: 0` es literal.
    expect(
      listingDeletePath,
      '`unlinkListingPhotos` dejó de prometer `deletedObjects: 0` en su tipo de retorno',
    ).toContain('deletedObjects: 0');

    // Contracara: el job SÍ borra. Si esto no aparece, o el detector se rompió o el GC es de
    // mentira, y en los dos casos la afirmación de arriba dejó de significar algo.
    const inGc = inspect(unlink, source.slice(gcAt)).filter(
      (f) => f.rule === 'borrado-de-objeto-afuera',
    );
    expect(
      inGc.length,
      '`collectOrphanObjects` no borra nada: el detector de borrados no está funcionando',
    ).toBeGreaterThan(0);
  });

  it('el recolector de huérfanos no se llama desde el request de nadie, sólo desde un job', () => {
    const callers = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('collectOrphanObjects')) return false;
      const rel = relative(REPO, file);
      const isRequestPath =
        /'use server'|"use server"/u.test(source) ||
        rel.includes(join('app', 'api')) ||
        /route\.tsx?$|actions\.tsx?$/u.test(rel);
      return isRequestPath;
    });

    expect(
      callers.map((f) => relative(REPO, f)),
      'el GC cuenta referencias cruzando TODOS los tenants (service role, sin RLS). Eso vive en ' +
        'un job, nunca en el request del dueño: ahí sería un borrado cruzado con más pasos.',
    ).toEqual([]);
  });
});

/**
 * El **control contra el gate vacuo**. Un subpath plausible —alguien que quiere `buildVariants` sin
 * pasar por `uploadListingPhoto`— que `packages/media` **no** declara. Tiene que dar rojo.
 *
 * Sin este caso, "los permitidos se derivan del `exports`" podría estar derivando de un objeto
 * vacío o de una lectura fallida y dejando pasar todo, y el verde diría lo contrario de la verdad.
 * Su pareja es el fixture inocente de `@istock/media/incidents`: uno prueba que la derivación no
 * es permisiva de más, el otro que no es estricta de más. Los dos hacen falta; ninguno solo alcanza.
 */
const UNDECLARED_SUBPATH = '@istock/media/pipeline';

// ── el guard probado contra casos plantados ───────────────────────────────────────────────────

/**
 * Lo que un `app-agent` apurado escribiría de verdad. Cada uno tiene que dar rojo, y por la regla
 * que le corresponde: un detector que dispara por el motivo equivocado es un detector que va a
 * dejar pasar el caso real.
 */
const PLANTED: ReadonlyArray<{
  readonly label: string;
  readonly file: string;
  readonly source: string;
  readonly rule: string;
}> = [
  {
    label: 'la grilla del panel arma la URL del CDN a mano',
    file: 'apps/web/app/(app)/app/(panel)/stock/photo.tsx',
    source: 'const src = `https://img.maat.work/${photo.cardKey}`;',
    rule: 'url-de-cdn-a-mano',
  },
  {
    label: 'un componente lee la base del CDN de la env',
    file: 'apps/web/app/(storefront)/_components/photo.tsx',
    source: "const base = process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? '';",
    rule: 'url-de-cdn-a-mano',
  },
  {
    label: 'un route handler sube a R2 por su cuenta',
    file: 'apps/web/app/api/fotos/route.ts',
    source: "import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';",
    rule: 'cliente-s3-afuera',
  },
  {
    label: 'el borrado de un equipo borra el objeto por key',
    file: 'apps/web/app/(app)/_lib/listings/delete-listing.ts',
    source: "await driver.delete('media', photo.cardKey);",
    rule: 'borrado-de-objeto-afuera',
  },
  {
    label: 'una Server Action manda el DELETE directo a S3',
    file: 'apps/web/app/(app)/app/stock/actions.ts',
    source: "await s3.send(new DeleteObjectCommand({ Bucket: 'istock-media', Key: key }));",
    rule: 'borrado-de-objeto-afuera',
  },
  {
    label: 'alguien recalcula la key de una variante',
    file: 'apps/web/app/(storefront)/_lib/photo-key.ts',
    source: 'const key = `v1/${hash.slice(0, 2)}/${hash}.webp`;',
    rule: 'key-de-media-a-mano',
  },
  {
    label: 'alguien adivina la key del master desde la del listing',
    file: 'apps/web/app/(app)/_lib/media-url.ts',
    source: 'const master = `originals/${tenantId}/${listingId}/${hash}.webp`;',
    rule: 'key-de-media-a-mano',
  },
  {
    label: 'un DTO entra a packages/media por la puerta de atrás',
    file: 'apps/web/app/(storefront)/_lib/dto.ts',
    source: "import { publicVariantKey } from '@istock/media/src/keys';",
    rule: 'import-profundo-a-media',
  },
  {
    label: 'un route handler alcanza el cliente de R2 por el interior del paquete',
    file: 'apps/web/app/api/fotos/route.ts',
    source: "import { r2 } from '@istock/media/src/storage/r2';",
    rule: 'import-profundo-a-media',
  },
  {
    label: 'un script entra al interior del paquete por path relativo, sin pasar por el nombre',
    file: 'apps/web/app/(app)/_lib/listings/keys.ts',
    source: "import { publicVariantKey } from '../../packages/media/src/keys';",
    rule: 'import-profundo-a-media',
  },
  {
    label: 'alguien inventa un subpath que el package.json de media nunca declaró',
    file: 'apps/web/app/(app)/_lib/listings/variants.ts',
    source: `import { buildVariants } from '${UNDECLARED_SUBPATH}';`,
    rule: 'import-profundo-a-media',
  },
  {
    label: 'el import profundo se disfraza de import dinámico',
    file: 'apps/web/instrumentation.ts',
    source: "const { publicVariantKey } = await import('@istock/media/src/keys');",
    rule: 'import-profundo-a-media',
  },
];

/** Lo que tiene que quedar limpio. Un guard que rechaza esto es un guard que se termina apagando. */
const INNOCENT: ReadonlyArray<{ readonly label: string; readonly source: string }> = [
  {
    label: 'el render correcto, que le pide la URL al paquete',
    source: [
      "import { cardSrcSet, variantUrl } from '@istock/media';",
      "const src = variantUrl(photo, 'card');",
      'const srcSet = cardSrcSet(photo);',
    ].join('\n'),
  },
  {
    label: 'un delete de Drizzle sobre una tabla',
    source: 'await db.delete(listings).where(eq(listings.id, listingId));',
  },
  {
    label: 'el saneo de headers del proxy',
    source: 'if (key.startsWith(TENANT_HEADER_PREFIX)) headers.delete(key);',
  },
  {
    label: 'el logout borrando la cookie de sesión',
    source: 'store.delete(COOKIE_NAME);',
  },
  {
    label: 'un docblock que explica la prohibición',
    source: [
      '/**',
      ' * No se usa DeleteObjectCommand: la key es content-addressed y el objeto es compartido.',
      ' * Tampoco se arma la URL con NEXT_PUBLIC_MEDIA_BASE_URL a mano.',
      ' */',
    ].join('\n'),
  },
  {
    label: 'la desvinculación correcta del mapeo',
    source: [
      "import { unlinkListingPhotos } from '@istock/media';",
      'const { releasedKeys } = await unlinkListingPhotos({ tenantId, listingId }, { store });',
    ].join('\n'),
  },
  {
    // Si esto se pone rojo, lo primero a mirar NO es este archivo: es si `packages/media` todavía
    // declara `"./incidents"` en su `exports`. El subpath existe para que el cableado de
    // observabilidad no cargue `sharp` (265 módulos + libvips) durante `register()`; si el paquete
    // lo retiró, el que tiene que cambiar es el import de `apps/web`, no este guard.
    label: 'el cableado de incidentes usa el subpath liviano que el paquete declara público',
    source: [
      "import { setMediaIncidentReporter } from '@istock/media/incidents';",
      "import type { MediaIncident } from '@istock/media/incidents';",
      'setMediaIncidentReporter(reportToSentry);',
    ].join('\n'),
  },
  {
    label: 'el bootstrap difiere el subpath público con un import dinámico',
    source: "const { setMediaIncidentReporter } = await import('@istock/media/incidents');",
  },
];

describe('el guard dispara con el caso plantado y se queda quieto con el caso correcto', () => {
  it.each(PLANTED)('marca en rojo cuando $label', ({ file, source, rule }) => {
    const findings = inspect(file, source);
    expect(
      findings.map((f) => f.rule),
      `el detector no vio la infracción en:\n      ${source}`,
    ).toContain(rule);
  });

  it.each(INNOCENT)('deja pasar el código correcto cuando es $label', ({ source }) => {
    const findings = inspect('apps/web/app/(app)/_lib/whatever.ts', source);
    expect(
      findings,
      `el guard rechaza código legítimo y va a terminar apagado:\n${report(findings)}`,
    ).toEqual([]);
  });
});

// ── la derivación de la superficie pública, probada por los dos lados ─────────────────────────

describe('la superficie pública de @istock/media la declara el paquete, no una lista en este test', () => {
  it('el exports de packages/media se lee y se parsea, o el guard se declara ciego y falla', () => {
    expect(
      MEDIA_SURFACE.failure,
      'sin poder derivar el `exports` de packages/media, este guard no sabe qué subpath es ' +
        'superficie pública y cuál es un import profundo. Ausencia de medición no es PASS.',
    ).toBeNull();
  });

  it('un subpath declarado que apunta al interior del paquete no se honra como público', () => {
    expect(
      MEDIA_SURFACE.internal,
      'un `exports` con `./src/...` apagaría este guard desde `package.json`, que es un archivo ' +
        'de otra columna. La superficie pública la decide `media-agent`; que el guard exista, no.',
    ).toEqual([]);
  });

  it.each(MEDIA_SURFACE.subpaths)(
    'importar el subpath público @istock/media/%s no cuenta como entrar por el interior',
    (subpath) => {
      const source = `import { algo } from '@istock/media/${subpath}';`;
      expect(
        inspect('apps/web/app/(app)/_lib/consumidor.ts', source),
        `el guard rechaza \`@istock/media/${subpath}\`, que el paquete declara público. Un gate ` +
          'que le cobra peaje al import correcto es un gate que alguien va a apagar.',
      ).toEqual([]);
    },
  );

  it('el subpath del control sigue sin estar declarado, o el control dejó de controlar algo', () => {
    expect(
      MEDIA_SURFACE.subpaths.map((sub) => `@istock/media/${sub}`),
      `${UNDECLARED_SUBPATH} pasó a ser superficie pública de packages/media. El fixture de ` +
        'control necesita un subpath que NO esté declarado: elegí otro, no lo borres.',
    ).not.toContain(UNDECLARED_SUBPATH);
  });

  it('con la lista de permitidos vacía no pasa ningún subpath, ni el que hoy es público', () => {
    // El modo de falla de la derivación tiene que ser MÁS estricto, nunca más permisivo. Si el
    // `package.json` desapareciera, `subpaths` queda `[]` y esto es lo que rige.
    const ciego = deepImportPattern([]);
    for (const subpath of ['incidents', 'pipeline', 'src/keys']) {
      expect(
        ciego.test(`import { x } from '@istock/media/${subpath}';`),
        `sin poder leer el \`exports\`, \`@istock/media/${subpath}\` tiene que quedar prohibido: ` +
          'un guard que no midió nada no puede estar absolviendo.',
      ).toBe(true);
    }
  });

  it('un subpath con comodín en el exports abre ese subpath y no el paquete entero', () => {
    // `./variantes/*` es una forma legítima del `exports`. Que el `*` no cruce la comilla es lo
    // que evita que un comodín se convierta en "cualquier import a media pasa".
    const conComodin = deepImportPattern(['variantes/*']);
    expect(conComodin.test("import { a } from '@istock/media/variantes/card';")).toBe(false);
    expect(
      conComodin.test("import { a } from '@istock/media/src/keys';"),
      'un comodín en un subpath no puede volverse una licencia para entrar al interior',
    ).toBe(true);
  });
});
