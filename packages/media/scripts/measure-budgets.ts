/**
 * Mide los bytes reales de cada variante con la imagen de referencia y los imprime.
 * `pnpm --filter @istock/media bench`. Los números de README.md salen de acá.
 */

import { performance } from 'node:perf_hooks';
import { buildVariants } from '../src/pipeline';
import { MASTER_SPEC, VARIANT_SPECS } from '../src/budgets';
import { publicVariantKey, masterObjectKey } from '../src/keys';
import { VARIANTS } from '../src/types';
import { referencePhotoJpeg, REFERENCE_MEGAPIXELS } from '../src/fixtures/reference-image';

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;

async function main(): Promise<void> {
  const jpeg = await referencePhotoJpeg();
  console.info(
    `fuente: ${REFERENCE_MEGAPIXELS} MP JPEG · ${kb(jpeg.byteLength)} · sha ${publicVariantKey(jpeg).slice(6, 14)}`,
  );

  const runs: number[] = [];
  let last = await buildVariants(jpeg);
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    last = await buildVariants(jpeg);
    runs.push(performance.now() - t0);
  }

  const rows = [
    {
      name: 'master',
      spec: MASTER_SPEC,
      out: last.master,
      key: masterObjectKey({
        tenantId: '00000000-0000-4000-8000-000000000001',
        listingId: '00000000-0000-4000-8000-000000000002',
        masterBytes: last.master.bytes,
      }),
    },
    ...VARIANTS.map((v) => ({
      name: v,
      spec: VARIANT_SPECS[v],
      out: last.variants[v],
      key: publicVariantKey(last.variants[v].bytes),
    })),
  ];

  console.info('\nvariante   px          bytes      techo      uso     q   intentos  key');
  for (const row of rows) {
    const pct = ((row.out.byteLength / row.spec.budgetBytes) * 100).toFixed(0);
    console.info(
      `${row.name.padEnd(10)} ${`${row.out.width}x${row.out.height}`.padEnd(11)} ` +
        `${kb(row.out.byteLength).padStart(9)} ${kb(row.spec.budgetBytes).padStart(9)} ` +
        `${`${pct}%`.padStart(6)} ${String(row.out.quality).padStart(4)} ${String(row.out.attempts).padStart(8)}  ${row.key}`,
    );
  }

  const publicBytes = VARIANTS.reduce((acc, v) => acc + last.variants[v].byteLength, 0);
  console.info(
    `\npúblico por foto: ${kb(publicBytes)} · con master: ${kb(publicBytes + last.master.byteLength)}`,
  );
  const avg = runs.reduce((a, b) => a + b, 0) / runs.length;
  console.info(
    `CPU sharp (${REFERENCE_MEGAPIXELS} MP → 4 encodes): ${avg.toFixed(0)} ms promedio de ${runs.length} corridas ` +
      `[${runs.map((r) => r.toFixed(0)).join(', ')}]`,
  );
}

await main();
