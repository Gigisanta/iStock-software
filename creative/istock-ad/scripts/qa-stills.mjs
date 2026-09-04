// gate-owner: LEAD — one still per scene (plus highlight moments) and a strip to look at before rendering.
// Usage: node --experimental-strip-types --no-warnings scripts/qa-stills.mjs [IstockPesos ...]
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { ADS } from '../src/ads/index.ts';
import { timeline } from '../src/ads/spec.ts';

const root = new URL('../', import.meta.url).pathname;
const wanted = process.argv.slice(2);
const specs = ADS.filter((spec) => wanted.length === 0 || wanted.includes(spec.id));
if (specs.length === 0) throw new Error(`no ad matched ${wanted.join(', ')}`);
await mkdir(`${root}out/qa`, { recursive: true });

for (const spec of specs) {
  const { scenes } = timeline(spec);
  const frames = scenes.flatMap((scene) => {
    const mid = Math.round((scene.start + scene.end) / 2);
    const extra = scene.kind === 'screen' && scene.highlight ? [scene.start + scene.highlight.at + 4] : [];
    return [mid, ...extra];
  });
  const files = [];
  for (const frame of frames) {
    const file = `out/qa/${spec.slug}-${String(frame).padStart(3, '0')}.png`;
    execFileSync('npx', ['remotion', 'still', 'src/index.ts', spec.id, file, `--frame=${frame}`, '--log=error'], { cwd: root, stdio: 'inherit' });
    files.push(file);
  }
  const strip = `out/qa/${spec.slug}-scenes.png`;
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...files.flatMap((file) => ['-i', file]), '-filter_complex', `${files.map((_, i) => `[${i}]`).join('')}hstack=${files.length},scale=${Math.min(2400, 360 * files.length)}:-1`, strip], { cwd: root, stdio: 'inherit' });
  console.log(`${spec.id}: frames ${frames.join(', ')} → ${strip}`);
}
