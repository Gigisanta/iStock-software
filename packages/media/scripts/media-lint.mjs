#!/usr/bin/env node
/**
 * Lint de `packages/media`. Chequea las trampas concretas de ADR-006 y de `CLAUDE.md` §2 que un
 * typecheck no ve. Corre con `pnpm --filter @istock/media lint`.
 *
 * No es un linter de estilo. Cada regla existe porque hacerla mal es un bug silencioso o un
 * rechazo de review.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** Saca comentarios de bloque y de línea para no marcar la documentación que EXPLICA la trampa. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const RULES = [
  {
    id: 'M001',
    why: 'httpMetadata.cacheControl es el binding de Workers y NO existe en el runtime Node de Vercel: deja los objetos sin Cache-Control (edge TTL 120 min).',
    test: (code) => /httpMetadata/.test(code),
  },
  {
    id: 'M002',
    why: 'r2.dev está rate-limited y sin cache. El bucket público va detrás de img.maat.work.',
    test: (code) => /['"`][^'"`]*\.r2\.dev/.test(code),
  },
  {
    id: 'M003',
    why: 'La key pública no puede interpolar tenantId ni listingId (ADR-006 / CLAUDE.md §2).',
    test: (code, file) =>
      !file.endsWith('keys.ts') &&
      /`[^`]*(v1\/)[^`]*\$\{\s*(tenantId|listingId|tenant_id|listing_id)/.test(code),
  },
  {
    id: 'M004',
    why: 'DeleteObjectCommand sólo puede vivir en storage/r2.ts. El borrado por key es cruzado entre tenants.',
    test: (code, file) => !file.endsWith('storage/r2.ts') && /DeleteObjectCommand/.test(code),
  },
  {
    id: 'M005',
    why: 'console.log de un objeto de media puede filtrar keys del master o bytes. Usá console.info sólo en scripts.',
    test: (code) => /\bconsole\.log\(/.test(code),
  },
  {
    id: 'M006',
    why: 'Una credencial de R2 con prefijo NEXT_PUBLIC_ termina en el bundle del browser.',
    test: (code) => /NEXT_PUBLIC_R2_/.test(code),
  },
  {
    id: 'M007',
    why: 'Vercel Image Optimization y /cdn-cgi/image/ están prohibidos en el hot path (CLAUDE.md §3).',
    test: (code) => /cdn-cgi\/image|next\/image/.test(code),
  },
  {
    id: 'M008',
    why: 'packages/media no habla con Postgres ni con Next: el mapeo listing→keys vive en packages/db.',
    test: (code) => /from '(drizzle-orm|postgres|next|@istock\/db)/.test(code),
  },
  {
    id: 'M009',
    why: 'Supabase Storage no es el CDN de la vidriera (CLAUDE.md §3).',
    test: (code) => /supabase.*storage|storage.*supabase/i.test(code),
  },
  {
    id: 'M010',
    why: 'TODO diferido sobre R2/RLS es rechazo automático de review (CLAUDE.md §2).',
    test: (code) => /TODO:?\s*(despu[eé]s|later|後)/i.test(code),
  },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

let failures = 0;
const files = walk(SRC);

for (const file of files) {
  const rel = relative(ROOT, file);
  if (rel.endsWith('.test.ts')) continue;
  const code = stripComments(readFileSync(file, 'utf8'));
  for (const rule of RULES) {
    if (rule.test(code, rel)) {
      console.error(`${rule.id}  ${rel}\n      ${rule.why}`);
      failures += 1;
    }
  }
}

// La superficie pública no puede exportar un borrado por key.
const index = readFileSync(join(SRC, 'index.ts'), 'utf8');
if (/export\s*\{[^}]*\bdelete[A-Z]/.test(index)) {
  console.error(
    'M011  src/index.ts\n      No se exporta ningún borrado de objeto por key. Sólo unlinkListingPhotos.',
  );
  failures += 1;
}
for (const required of ['uploadListingPhoto', 'variantUrl', 'unlinkListingPhotos']) {
  if (!index.includes(required)) {
    console.error(`M012  src/index.ts\n      Falta exportar ${required} (contrato del monorepo).`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\nMEDIA-LINT: FAIL (${failures})`);
  process.exit(1);
}
console.info(`MEDIA-LINT: PASS (${files.length} archivos, ${RULES.length} reglas)`);
