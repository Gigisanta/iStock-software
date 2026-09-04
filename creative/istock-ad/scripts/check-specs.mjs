// gate-owner: LEAD — validates every AdSpec from Node (same rules Root.tsx enforces at bundle time).
// Run with: node --experimental-strip-types --no-warnings scripts/check-specs.mjs
import { access } from 'node:fs/promises';
import { ADS } from '../src/ads/index.ts';
import { timeline } from '../src/ads/spec.ts';
import { validate } from '../src/ads/validate.ts';

const errors = ADS.flatMap((spec) => validate(spec));
for (const spec of ADS) {
  for (const scene of spec.scenes) {
    if (scene.kind !== 'screen') continue;
    await access(new URL(`../public/v10/ui/${scene.file}`, import.meta.url)).catch(() => errors.push(`${spec.id}: capture ${scene.file} is missing`));
  }
  await access(new URL(`../publish/${spec.slug}/03-caption.txt`, import.meta.url)).catch(() => errors.push(`${spec.id}: publish/${spec.slug}/03-caption.txt is missing`));
}
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
for (const spec of ADS) {
  const { scenes, durationInFrames } = timeline(spec);
  console.log(`${spec.id.padEnd(14)} ${spec.slug.padEnd(9)} ${(durationInFrames / 30).toFixed(1).padStart(4)} s  ${spec.music.padEnd(6)} ${scenes.map((scene) => scene.kind).join(' → ')}`);
}
console.log(`specs ok: ${ADS.length} ads`);
