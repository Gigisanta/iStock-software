/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  LA PII DEL VISITANTE NO SALE DE LA FILA DEL CANJE. Owner: `qa-agent`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Qué se afirma acá y por qué es la afirmación más cara del producto
 * S8 abrió `POST {slug}.maat.work/api/tradein`: la **primera PII de un tercero** que entra a
 * Postgres **sin login**. Hasta S7, todo lo que entraba era del dueño o de su stock; ahora entra el
 * `customer_name` y el `customer_wa_phone` de una persona que quiere vender su teléfono y que no
 * tiene cuenta, no aceptó nada y no se va a enterar nunca de dónde terminó su número.
 *
 * `CLAUDE.md` §8 dice *"IMEI nunca en vidriera, ni en logs, ni en contexto del chatbot"*. La PII del
 * visitante es de la misma clase y **no tenía test**: el LEAD la declaró sin cubrir al cerrar S8.
 * `adversary-reviewer` la **midió** y estaba limpia — cero `console.*` en los cuatro archivos
 * nuevos, el `catch` del handler sin sink, un solo `logEvent` con ids y un enum. Pero **medido no
 * es testeado**: nada de eso sobrevive a que alguien agregue un `console.error(body)` mañana a las
 * once para debuggear un 500, lo commitee, y se entere seis meses después. Este archivo es el que
 * lo sostiene.
 *
 * ## Las cuatro reglas, y por qué ninguna sirve sola
 *
 * **A · El chatbot no puede nombrar esto nunca.** Cero menciones de las columnas de PII y del tipo
 * de fila en `packages/ai/**` y `packages/domain/**`. Es un límite duro y no una heurística: el
 * contexto del chatbot va a un LLM de terceros, y una vez que el nombre de una persona entró a un
 * prompt no vuelve. No hay motivo legítimo, así que no hay excepción declarable. Se censa el
 * **código** —identificadores y literales, vía AST— y no el texto crudo: `packages/db` explica en
 * prosa qué es un `tradein_lead` y un comentario no manda nada a ningún lado. Un censo con falsos
 * positivos se apaga.
 *
 * **B · El perímetro se censa, no se recuerda.** Abajo hay una lista de paths: el perímetro del
 * canje. Dos censos la mantienen honesta y los dos pueden ponerse rojos:
 *   1. **ningún** archivo de producción fuera de la lista nombra una columna de PII o la tabla de
 *      leads (si aparece uno, o entra al perímetro y queda auditado, o no toca leads);
 *   2. **ningún** archivo de `apps/web/app` fuera de la lista importa del perímetro — así el
 *      `console.log(lead)` no se puede mudar a un archivo nuevo que este test no mire. Un lead sale
 *      del perímetro sólo por un `import`, y el `import` está en el fuente.
 *
 * **C · Los SINKS, no los nombres.** Es la regla que hace el trabajo. Un test que grepea
 * `customerName` lo esquiva cualquiera que escriba `log(lead)`, `log({ ...lead })` o
 * `JSON.stringify(lead)` — y ése es exactamente el caso que va a pasar, porque nadie loguea un
 * campo de PII a propósito: se loguea **el objeto**, para debuggear, sin mirar qué trae adentro.
 * Entonces no se mira el nombre del campo: se mira **qué expresión llega a un sink**. Adentro del
 * perímetro, un sink (`console.*`, `logEvent`, `logError`, Sentry, PostHog, `JSON.stringify`,
 * `fetch`, `new *Error`, `metadata:` de `listing_events`) sólo puede recibir **literales, ids y
 * constantes literales del módulo**. Un identificador pelado, un spread, una llamada anidada o un
 * template con una sustitución que no sea un id: rojo. Se prohíbe la **forma**, que es lo que se
 * puede sostener sin un type checker, y de paso agarra la fuga que todavía no tiene nombre.
 *
 * **D · El handler anónimo no tiene cuerpo de respuesta.** Las dos salidas son `303` al mismo par
 * de paths. Un `new Response` con cuerpo en el perímetro es un oráculo sobre la forma de la tabla y
 * sobre qué tenants existen, además de una vía de eco de la PII que acaban de mandar.
 *
 * ## Lo que este archivo NO puede afirmar, dicho antes de que alguien lo suponga
 * - **No hay type checker.** El análisis es sintáctico: no sabe que `lead` es un `TradeinLead`,
 *   sabe que `lead` no es un id ni una constante literal. Consecuencia aceptada: el analizador es
 *   **conservador adentro del perímetro** (pide ids o literales) y **ciego afuera**. Por eso el
 *   perímetro se censa por importaciones: la ceguera de afuera se compensa haciendo que "afuera"
 *   sea un lugar al que un lead no puede llegar sin que el censo lo vea.
 * - **No mira runtime.** Que Vercel no imprima el nombre de una persona lo sostiene esto más el
 *   `_lib/log.ts` de `app-agent` (que además deniega por nombre de campo). Son dos capas y hacen
 *   falta las dos: la denylist de nombres no ve un `console.error(err)`, y esto no ve un log escrito
 *   por una dependencia.
 * - **La fila en sí la protege RLS**, y eso se afirma en otro lado
 *   (`tests/rls-cross-tenant.test.ts`, R2b/R6c/R7). Acá se afirma que la fila **no se copia** a
 *   ningún lado donde RLS ya no la proteja: un log, un prompt, una respuesta HTTP.
 *
 * ## Cómo se vio rojo (si no lo viste encender, no probaste nada)
 * El `describe` de abajo del todo le pasa al analizador **ocho fuentes con la fuga plantada** —una
 * por forma— y exige que las vea. No es una demo que se corrió una vez: si alguien afloja el
 * analizador para que un rojo se ponga verde, esas ocho se ponen rojas ellas. Y el control negativo
 * (la forma real del `logEvent` de `accept-to-stock`) exige que el analizador **no** invente fugas,
 * que es la otra mitad de que sirva para algo.
 *
 * ## Ownership
 * `CLAUDE.md` §4: esto es **auditoría de referencia** y por eso vive en `tests/` y es de
 * `qa-agent`. `packages/*` y `apps/web` no pueden ser dueños de la afirmación que los audita — sería
 * el mismo writer firmando su propio certificado. La lista del perímetro y la de nombres seguros
 * también son de acá: el que necesita ampliarlas **pide, no edita**, igual que con los techos del
 * WAF. Y `qa-agent` no arregla el código bajo test: si esto se pone rojo, el defecto es del código.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── qué es PII del visitante ──────────────────────────────────────────────────────────────────

/**
 * Las dos columnas que **son** una persona: cómo se llama y a qué número la llamás. En las dos
 * grafías, porque el mismo dato se escribe `customerName` en Drizzle y `customer_name` en el SQL
 * crudo del handler, y un censo que mire una sola grafía tiene un agujero del tamaño de la otra.
 *
 * `notes` y `model_text` **no** están acá y es a propósito: son texto libre del visitante (puede
 * escribir su dirección adentro) pero la palabra `notes` aparece en medio repo, así que como semilla
 * de censo produciría ruido. Quedan cubiertas igual, y mejor: la regla C no las deja pasar a un
 * sink porque no son un id — no por cómo se llaman, sino porque no están en la lista de lo que sí
 * puede salir.
 */
const PII_COLUMNS = /(customerName|customer_name|customerWaPhone|customer_wa_phone)/u;

/**
 * Un handle sobre **filas** de canje. Un módulo que hace `select().from(tradeinLeads)` se lleva las
 * 17 columnas sin nombrar ni una: sin esto, el censo del perímetro no lo vería.
 */
const LEAD_ROW = /(tradeinLeads|tradein_leads|TradeinLead)/u;

// ── el perímetro ──────────────────────────────────────────────────────────────────────────────

/**
 * Dónde puede vivir un lead de canje. Termina en `/` = subárbol; si no, archivo exacto.
 *
 * **La lista no se mantiene sola y no hace falta que alguien se acuerde de ella**: los dos censos
 * de la regla B la rompen el día que un archivo de afuera toque un lead. Es la diferencia entre una
 * lista y una convención — la convención es lo que sostenía el parser del matcher hasta S8.
 */
const PERIMETER = [
  'apps/web/app/(storefront)/_lib/tradein-form.ts',
  'apps/web/app/(storefront)/_components/tradein-form.tsx',
  'apps/web/app/(storefront)/_components/tradein-outcome.tsx',
  'apps/web/app/(storefront)/s/[slug]/api/tradein/route.ts',
  'apps/web/app/(storefront)/s/[slug]/canje/',
  'apps/web/app/(app)/_lib/tradein/',
  'apps/web/app/(app)/app/(panel)/canjes/',
  'packages/db/src/schema/tradein.ts',
  'packages/db/src/seed.ts',
] as const;

/** Los cuatro archivos que S8 estrenó. Si uno se va de la lista, el perímetro dejó de cubrir S8. */
const S8_FILES = [
  'apps/web/app/(storefront)/s/[slug]/api/tradein/route.ts',
  'apps/web/app/(storefront)/_lib/tradein-form.ts',
  'apps/web/app/(storefront)/_components/tradein-form.tsx',
  'apps/web/app/(app)/_lib/tradein/accept-to-stock.ts',
] as const;

/** El handler anónimo. Es el único archivo del repo que recibe PII de alguien sin sesión. */
const ANON_HANDLER = 'apps/web/app/(storefront)/s/[slug]/api/tradein/route.ts';

/**
 * Dónde vive el código de producción. Los `scripts/` de cada paquete quedan afuera: son gates del
 * LEAD, no corren en Vercel, y nombran la columna justamente para vigilarla (`rls-lint.mjs`).
 */
const ROOTS = [
  'apps/web/app',
  'packages/ai/src',
  'packages/domain/src',
  'packages/db/src',
  'packages/media/src',
] as const;

/** El límite duro de la regla A. */
const LLM_ROOTS = ['packages/ai/src', 'packages/domain/src'] as const;

// ── el árbol ──────────────────────────────────────────────────────────────────────────────────

const IGNORED_DIRS = new Set(['node_modules', '.next', 'dist', 'drizzle']);

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/u.test(entry) && !/\.(test|spec)\.tsx?$/u.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
}

/**
 * Archivos de **producción**. Los `*.test.ts` quedan afuera a propósito: un test de `db-agent` tiene
 * que poder escribir `customer_name` para probar la policy que lo protege. Un test no corre en
 * Vercel y su `console.log` no va a los logs de producción.
 */
function productionFiles(): string[] {
  const files: string[] = [];
  for (const root of ROOTS) walk(join(REPO, root), files);
  return files.sort();
}

const FILES = productionFiles();
const SOURCE = new Map(FILES.map((file) => [file, readFileSync(file, 'utf8')]));
const rel = (file: string): string => relative(REPO, file);

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    SOURCE.get(file) ?? '',
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * El **código** de un archivo, sin sus comentarios: identificadores y contenido de literales.
 *
 * No es cosmética. `packages/db/src/schema/enums.ts` explica en prosa qué es un `tradein_lead`, y
 * `listings.ts` nombra `tradein_leads.created_listing_id` en un comentario: son dos archivos que
 * **hablan** de la tabla y no la tocan. Un censo sobre el texto crudo los marcaría, el rojo sería
 * falso, y un guard que da rojo falso es un guard que alguien apaga. Se censa lo que corre.
 *
 * Se captura también el contenido de los literales de template porque el `insert` del handler
 * anónimo nombra `customer_name` adentro de un `sql\`…\`` —o sea en un string, no en un
 * identificador— y ése es precisamente el lugar donde la PII entra a Postgres.
 */
function codeText(file: string): string {
  const parts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) ||
      ts.isPrivateIdentifier(node) ||
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      parts.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return parts.join('\u0000');
}

const CODE = new Map(FILES.map((file) => [file, codeText(file)]));

/** ¿El código de este archivo —no su prosa— toca un lead de canje? */
function touchesLead(file: string): boolean {
  const code = CODE.get(file) ?? '';
  return PII_COLUMNS.test(code) || LEAD_ROW.test(code);
}

function inPerimeter(file: string): boolean {
  const path = rel(file);
  return PERIMETER.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));
}


// ── el analizador ─────────────────────────────────────────────────────────────────────────────

/**
 * Sinks: por dónde se le escapa un dato al proceso.
 *
 * `JSON.stringify` está adentro porque es **la** forma de meter un objeto entero en un lugar que
 * sólo acepta strings, o sea el paso previo de casi toda fuga real. `fetch` también: mandar el lead
 * a un tercero es la fuga con menos vueltas que existe. Los constructores de `Error` cuentan porque
 * el `message` termina en los logs de Vercel y en Sentry sin que nadie lo decida.
 */
const SINK_MEMBER = /^(?:console|Sentry|sentry|posthog|analytics|logger|log)\./u;
const SINK_CALL = new Set([
  'log',
  'logEvent',
  'logError',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'dir',
  'table',
  'captureException',
  'captureMessage',
  'capture',
  'addBreadcrumb',
  'setContext',
  'setExtra',
  'setTag',
  'setUser',
  'track',
  'identify',
  'stringify',
  'fetch',
  'reportIncident',
]);

/**
 * Nombres que **sí** pueden salir. Ids (que no dicen nada sin la base y que la base protege con
 * RLS), el estado del lead, y un puñado de enums y contadores.
 *
 * La lista es corta a propósito y **vive en `tests/`**: ampliarla es ampliar lo que puede salir del
 * perímetro, así que la decide `qa-agent` y no el writer del código auditado. Si al owner de un
 * paquete le hace falta un nombre más, **pide**. Es la misma regla que los techos del WAF.
 */
const SAFE_ATOM = /^(?:[A-Za-z0-9]*Id|id|ids|status|kind|source|slug|code|event|count|ok|level)$/u;

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly sink: string;
  readonly expr: string;
  readonly why: string;
}

interface Scan {
  /** Sitios de sink encontrados. Sirve de control de no-vacuidad: cero sinks vistos = analizador roto. */
  readonly sites: readonly string[];
  readonly findings: readonly Finding[];
}

const literalKinds = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
]);

function isLiteral(node: ts.Node): boolean {
  if (literalKinds.has(node.kind)) return true;
  if (ts.isPrefixUnaryExpression(node)) return isLiteral(node.operand);
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return isLiteral(node.expression);
  return false;
}

/**
 * Constantes literales de nivel de módulo (`const NOT_FOUND = 'Ese canje no existe.'`).
 *
 * No es una concesión: es el único caso en que un **identificador** es demostrablemente un literal
 * sin type checker, porque la declaración está a la vista en el mismo archivo. Es lo que deja pasar
 * `throw new AcceptBlocked(NOT_FOUND)` sin abrirle la puerta a `throw new AcceptBlocked(lead.notes)`.
 */
function literalConstants(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (declaration.initializer !== undefined && isLiteral(declaration.initializer)) {
        names.add(declaration.name.text);
      }
    }
  }
  return names;
}

/** El último tramo de `ctx.tenantId` es `tenantId`; el de `lead.customerName`, `customerName`. */
function tailName(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

/**
 * ¿Esta expresión puede llegar a un sink? Devuelve el motivo del rechazo, o `null` si es segura.
 *
 * Es una lista blanca de **formas**, no una lista negra de nombres: lo que no se reconoce se
 * rechaza. Un `lead`, un `body`, un `err`, un `row[campo]`, un `await algo()` — todos caen por lo
 * mismo, que es no ser demostrablemente un id ni un literal. Ése es el punto: la fuga que importa
 * no se llama `customerName`, se llama `lead`.
 */
function why(node: ts.Expression, constants: ReadonlySet<string>): string | null {
  if (isLiteral(node)) return null;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    return why(node.expression, constants);
  }

  if (ts.isIdentifier(node)) {
    if (node.text === 'undefined' || constants.has(node.text) || SAFE_ATOM.test(node.text)) return null;
    return `\`${node.text}\` es un identificador pelado: ni un id, ni una constante literal del módulo. Si es una fila (o parte de una), acaba de salir del perímetro`;
  }

  if (ts.isPropertyAccessExpression(node)) {
    const tail = tailName(node);
    if (tail !== null && SAFE_ATOM.test(tail)) return null;
    return `\`${node.getText(node.getSourceFile())}\` no termina en un nombre de la lista blanca (ids, \`status\`, \`kind\`, …)`;
  }

  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        return `\`...${property.expression.getText(node.getSourceFile())}\` mete el objeto ENTERO en el sink. Es la fuga que más va a pasar: nadie loguea un campo de PII a propósito, loguea el objeto`;
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        const reason = why(property.name, constants);
        if (reason !== null) return reason;
        continue;
      }
      if (ts.isPropertyAssignment(property)) {
        const reason = why(property.initializer, constants);
        if (reason !== null) return reason;
        continue;
      }
      return 'el objeto trae un método o un accessor: no se puede saber qué devuelve';
    }
    return null;
  }

  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      const reason = why(element, constants);
      if (reason !== null) return reason;
    }
    return null;
  }

  if (ts.isTemplateExpression(node)) {
    for (const span of node.templateSpans) {
      const reason = why(span.expression, constants);
      if (reason !== null) return `interpolado en un template: ${reason}`;
    }
    return null;
  }

  if (ts.isConditionalExpression(node)) {
    return why(node.whenTrue, constants) ?? why(node.whenFalse, constants);
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return why(node.left, constants) ?? why(node.right, constants);
  }

  return `\`${node.getText(node.getSourceFile()).slice(0, 60)}\` no es un literal ni un id: no se puede afirmar qué contiene`;
}

/**
 * ¿Es esta clase un `Error` declarado en el archivo? `AcceptBlocked extends Error` de
 * `accept-to-stock.ts` es un sink igual que `Error`: su `message` viaja.
 */
function localErrorClasses(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name !== undefined) {
      const extendsError = (node.heritageClauses ?? []).some((clause) =>
        clause.types.some((type) => /Error$/u.test(type.expression.getText(sourceFile))),
      );
      if (extendsError) names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** El analizador. Se le puede dar un fuente de mentira, y por eso se puede ver encender. */
function scanForLeaks(fileName: string, source: string): Scan {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const constants = literalConstants(sourceFile);
  const errors = localErrorClasses(sourceFile);
  const findings: Finding[] = [];
  const sites: string[] = [];

  const at = (node: ts.Node): number => sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  const check = (node: ts.Node, sink: string, args: readonly ts.Expression[]): void => {
    sites.push(sink);
    for (const argument of args) {
      const reason = why(argument, constants);
      if (reason !== null) {
        findings.push({
          file: fileName,
          line: at(node),
          sink,
          expr: argument.getText(sourceFile).replace(/\s+/gu, ' ').slice(0, 100),
          why: reason,
        });
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile).replace(/\s+/gu, '');
      const tail = callee.split('.').pop() ?? '';
      if (SINK_MEMBER.test(callee) || SINK_CALL.has(tail)) check(node, callee, node.arguments);
    }

    if (ts.isNewExpression(node)) {
      const callee = node.expression.getText(sourceFile);
      const args = node.arguments ?? [];
      if (/Error$/u.test(callee) || errors.has(callee)) check(node, `new ${callee}`, args);
      if (callee === 'Response' || callee === 'NextResponse') {
        // Sólo el CUERPO. El segundo argumento son headers y status, y el `location` de un `303`
        // no es un dato: es a dónde manda al navegador. Pedirle a ese objeto que sean ids sería un
        // falso positivo con forma de regla.
        sites.push(`new ${callee}`);
        const body = args[0];
        if (body !== undefined && !isLiteral(body)) {
          findings.push({
            file: fileName,
            line: at(node),
            sink: `new ${callee}`,
            expr: body.getText(sourceFile).replace(/\s+/gu, ' ').slice(0, 100),
            why: 'la respuesta lleva cuerpo. Las dos salidas del canje son `303` sin cuerpo al mismo par de paths: un cuerpo distingue casos, y distinguirlos es un oráculo sobre la tabla y sobre qué tenants existen',
          });
        }
      }
    }

    // `listing_events.metadata` es una columna `jsonb` que después alimenta pantallas de historial:
    // lo que entra ahí queda escrito para siempre en una tabla que se lee con otra policy.
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'metadata') {
      check(node, 'metadata:', [node.initializer]);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { sites, findings };
}

function describeFinding(finding: Finding): string {
  return `${rel(finding.file)}:${String(finding.line)}  ${finding.sink}(… ${finding.expr} …)\n      → ${finding.why}`;
}

function scanPerimeter(): Scan {
  const sites: string[] = [];
  const findings: Finding[] = [];
  for (const file of FILES.filter(inPerimeter)) {
    const scan = scanForLeaks(file, SOURCE.get(file) ?? '');
    sites.push(...scan.sites.map((sink) => `${rel(file)} · ${sink}`));
    findings.push(...scan.findings);
  }
  return { sites, findings };
}

// ── A · el límite duro: el chatbot no nombra esto nunca ───────────────────────────────────────

describe('la PII del visitante no existe para el chatbot ni para el dominio', () => {
  it('ningún archivo de packages/ai o packages/domain nombra el nombre o el WhatsApp del visitante', () => {
    const offenders = FILES.filter(
      (file) =>
        LLM_ROOTS.some((root) => rel(file).startsWith(root)) && touchesLead(file),
    ).map(rel);

    expect(
      offenders,
      'CLAUDE.md §8: nada de esto entra al contexto del chatbot. `packages/ai` arma prompts que se ' +
        'mandan a Gemini y a Groq, o sea a dos terceros: el nombre y el teléfono de una persona que ' +
        'nunca aceptó nada no pueden estar ahí, y una vez que entraron a un prompt no vuelven. ' +
        '`packages/domain` es TS puro y tampoco tiene por qué conocer un lead: la PII no necesita ' +
        'reglas de negocio, necesita quedarse en la fila. No hay excepción declarable para esta regla.',
    ).toEqual([]);
  });
});

// ── B · el perímetro se censa ─────────────────────────────────────────────────────────────────

describe('un lead de canje sólo puede vivir adentro del perímetro auditado', () => {
  it('el perímetro declarado existe en el disco y cubre los cuatro archivos que estrenó S8', () => {
    // Sin esto, un `PERIMETER` con paths viejos —o un `apps/web/app` movido de lugar— haría que
    // todo lo de abajo pase sin haber leído un solo archivo. Es el mismo modo de falla que un
    // `grep` sobre un directorio que no existe: verde, y no midió nada.
    const stale = PERIMETER.filter((entry) => !FILES.some((file) => rel(file) === entry || rel(file).startsWith(entry)));
    expect(stale, 'entradas del perímetro que ya no existen en el disco: o se movieron, o el censo mira al vacío').toEqual([]);

    const missing = S8_FILES.filter((path) => !FILES.some((file) => rel(file) === path && inPerimeter(file)));
    expect(missing, 'archivos de S8 que quedaron fuera del perímetro: no los está auditando nadie').toEqual([]);
  });

  it('ningún archivo de producción fuera del perímetro nombra la PII del visitante ni la tabla de leads', () => {
    const outside = FILES.filter(
      (file) => !inPerimeter(file) && touchesLead(file),
    ).map(rel);

    expect(
      outside,
      'apareció código de producción que toca leads de canje afuera del perímetro. No es rojo de ' +
        '"prohibido": es rojo de "esto no lo audita nadie". Las dos salidas son legítimas — sacarle ' +
        'el lead a ese archivo, o pedirle a `qa-agent` que lo meta en `PERIMETER` (y entonces sus ' +
        'sinks quedan auditados por este test). Lo que no puede pasar es que un archivo nuevo se ' +
        'lleve el nombre y el teléfono de una persona sin que nada lo mire.',
    ).toEqual([]);
  });

  it('nadie importa el módulo del canje desde afuera del perímetro sin entrar al perímetro', () => {
    const escapes: string[] = [];

    for (const file of FILES) {
      if (inPerimeter(file) || !rel(file).startsWith('apps/web/app')) continue;
      const sourceFile = parse(file);
      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
        const specifier = statement.moduleSpecifier;
        if (specifier === undefined || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) continue;
        const base = resolve(dirname(file), specifier.text);
        const target = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find((candidate) =>
          SOURCE.has(candidate),
        );
        if (target !== undefined && inPerimeter(target)) {
          escapes.push(`${rel(file)} importa \`${specifier.text}\` (${rel(target)})`);
        }
      }
    }

    expect(
      escapes,
      'un archivo de afuera del perímetro importa del canje. Un lead sale del perímetro SÓLO por un ' +
        '`import`, y por eso este censo es el que hace que la regla de sinks no se pueda esquivar ' +
        'mudando el `console.log(lead)` a un archivo que este test no mira. Si el import es ' +
        'legítimo, el archivo entra al perímetro y queda auditado: pedíselo a `qa-agent`.',
    ).toEqual([]);
  });
});

// ── C · los sinks ─────────────────────────────────────────────────────────────────────────────

describe('adentro del perímetro del canje, a un sink sólo le llegan ids, enums y literales', () => {
  const scan = scanPerimeter();

  it('el analizador encuentra los sinks que hay: sin esto el verde de abajo sería vacuo', () => {
    // Un analizador que dejó de reconocer `logEvent` no reporta fugas nunca más, y el rojo que
    // debería llegar llega como verde. Se ancla en el sink real de S8: el `logEvent` con el que
    // `accept-to-stock` deja constancia de que el dueño aceptó un canje.
    expect(
      scan.sites.filter((site) => site.includes('accept-to-stock.ts') && site.endsWith('logEvent')),
      'el analizador no vio el `logEvent` de `accept-to-stock.ts`. O se movió, o el detector de ' +
        'sinks se rompió — y si se rompió, este archivo entero está reportando salud que no midió.',
    ).not.toEqual([]);

    expect(scan.sites.length, 'cero sinks vistos en todo el perímetro: el analizador no está mirando').toBeGreaterThan(2);
  });

  it('ni un objeto entero, ni un spread, ni un template llegan a un log del canje', () => {
    expect(
      scan.findings.map(describeFinding),
      'algo que no es un id ni un literal llega a un sink adentro del perímetro del canje.\n' +
        'Por qué es caro: el `customer_name` y el `customer_wa_phone` son de una persona que no ' +
        'tiene cuenta, no aceptó nada y no se va a enterar. Un `console.error(err)` de postgres.js ' +
        'imprime la sentencia CON sus parámetros —o sea el teléfono— en los logs de Vercel para ' +
        'siempre, y de ahí va a Sentry.\n' +
        'La regla no es "no loguees el campo": es **no loguees el objeto**. Logueá el id y buscá la ' +
        'fila con RLS puesto, que es donde el dato está protegido.\n' +
        'Si necesitás un nombre nuevo en la lista blanca, pedíselo a `qa-agent`: ampliar esa lista ' +
        'es ampliar lo que puede salir del perímetro, y no lo decide el writer del código auditado.',
    ).toEqual([]);
  });

  it('el handler anónimo del canje nunca arma una respuesta con cuerpo', () => {
    const handler = FILES.find((file) => rel(file) === ANON_HANDLER);
    expect(handler, `no se encontró \`${ANON_HANDLER}\`: el censo perdió de vista el handler anónimo`).toBeDefined();

    const bodies = scanForLeaks(handler ?? '', SOURCE.get(handler ?? '') ?? '').findings.filter((finding) =>
      finding.sink.startsWith('new Response'),
    );

    expect(
      bodies.map(describeFinding),
      'el endpoint público de canje contesta con cuerpo. Las dos salidas son `303` a `/canje/listo` ' +
        'o a `/canje/reintentar` y NADA más: el body que no validó, el `42501` de la policy, el ' +
        'CHECK violado y la conexión caída colapsan a la misma respuesta a propósito. Distinguirlos ' +
        'le da a quien esté probando un oráculo sobre la forma de la tabla y sobre qué tenants ' +
        'existen, y a la persona que quiere vender su teléfono no le cambia nada.',
    ).toEqual([]);
  });
});

// ── E · el analizador visto encender ──────────────────────────────────────────────────────────

/**
 * Ocho fugas plantadas, una por forma. **Ninguna de las ocho nombra una columna de PII**, salvo las
 * dos que existen justamente para probar que el nombre no es lo que se persigue: la fuga real se
 * escribe `lead`, no `customerName`, y por eso un test que grepea nombres de columna no la ve.
 *
 * Si alguien afloja el analizador para que un rojo se ponga verde, estos ocho se ponen rojos.
 */
const LEAKS: readonly { readonly name: string; readonly code: readonly string[] }[] = [
  {
    name: 'el objeto entero a un console.log, que es como se debuggea un 500 a las once de la noche',
    code: ['const lead = await load();', 'console.log(lead);'],
  },
  {
    name: 'el spread del lead adentro de un objeto de log con ids que parece prolijo',
    code: ['logEvent("tradein.filed", { tenantId, ...lead });'],
  },
  {
    name: 'JSON.stringify de la fila, que es el paso previo de casi toda fuga real',
    code: ['logError("tradein.failed", "42501", { row: JSON.stringify(lead) });'],
  },
  {
    name: 'el error de postgres.js al catch, que imprime la sentencia con sus parámetros',
    code: ['try { await record(); } catch (err) { console.error(err); }'],
  },
  {
    name: 'un template literal que interpola un campo de texto libre del visitante',
    code: ['logEvent("tradein.filed", { detail: `lead ${lead.notes}` });'],
  },
  {
    name: 'un campo de PII con la clave renombrada para que no se note en el grep',
    code: ['logEvent("tradein.filed", { tenantId, quien: lead.customerName });'],
  },
  {
    name: 'la metadata de listing_events cargada con el WhatsApp del visitante',
    code: ['await tx.insert(listingEvents).values({ metadata: { source: "tradein", wa: lead.customerWaPhone } });'],
  },
  {
    name: 'la respuesta del endpoint público devolviendo el lead que acaba de entrar',
    code: ['return new Response(JSON.stringify(lead), { status: 200 });'],
  },
];

/**
 * El control negativo. Es la forma **real** del `logEvent` de `accept-to-stock.ts` más el `throw`
 * con constante de módulo y el `303` sin cuerpo del handler. Si el analizador los marca, es un
 * analizador que obliga a apagarlo, y un guard que molesta es un guard que se borra.
 */
const NO_LEAK = [
  'const NOT_FOUND = "Ese canje no existe o ya no está disponible.";',
  'class AcceptBlocked extends Error {}',
  'logEvent("tradein.accepted", { tenantId: ctx.tenantId, leadId: input.leadId, listingId, status: "draft" });',
  'await tx.insert(listingEvents).values({ metadata: { source: "tradein", kind: "unit" } });',
  'throw new AcceptBlocked(NOT_FOUND);',
  'return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });',
];

describe('el analizador de fugas ve rojo con la fuga plantada, que es lo que lo hace un test', () => {
  for (const leak of LEAKS) {
    it(`el analizador ve encender la fuga plantada: ${leak.name}`, () => {
      const findings = scanForLeaks('fuga-plantada.ts', leak.code.join('\n')).findings;
      expect(
        findings.map((finding) => `${finding.sink} · ${finding.why}`),
        `el analizador NO vio esta fuga:\n${leak.code.join('\n')}\nUn analizador que no ve la fuga ` +
          'plantada no está midiendo el perímetro: lo está declarando limpio.',
      ).not.toEqual([]);
    });
  }

  it('no inventa fugas sobre la forma real del logEvent, el throw y el 303 de S8', () => {
    const scan = scanForLeaks('control-negativo.ts', NO_LEAK.join('\n'));
    expect(
      scan.findings.map(describeFinding),
      'el analizador marca código que HOY es correcto. Un guard con falsos positivos se apaga, y un ' +
        'guard apagado no protege a nadie.',
    ).toEqual([]);
    expect(scan.sites.length, 'el control negativo no ejercitó ningún sink: no controla nada').toBeGreaterThan(3);
  });
});
