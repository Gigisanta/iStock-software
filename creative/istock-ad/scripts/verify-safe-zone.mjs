import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Declared overlay boxes for v10 (text, logo, CTA). The device sits below the captions and is fully visible.
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
const output = outputArgument ? outputArgument.slice('--output='.length) : 'out/v10-safe-zone-report.json';
const outputPath = isAbsolute(output) ? output : join(projectRoot, output);

const safeZone = { left: 65, top: 269, right: 1015, bottom: 1248 };
const keyLayout = [
  { id: 'hook-bubbles', kind: 'text', x: 180, y: 309, width: 720, height: 708 },
  { id: 'hook-headline', kind: 'text', x: 65, y: 1087, width: 950, height: 160 },
  { id: 'caption-upload', kind: 'text', x: 65, y: 299, width: 950, height: 200 },
  { id: 'caption-storefront', kind: 'text', x: 65, y: 299, width: 950, height: 200 },
  { id: 'storefront-host-pill', kind: 'text', x: 330, y: 519, width: 420, height: 60 },
  { id: 'caption-detail', kind: 'text', x: 65, y: 299, width: 950, height: 200 },
  { id: 'caption-whatsapp', kind: 'text', x: 65, y: 299, width: 950, height: 200 },
  { id: 'close-lockup', kind: 'logo', x: 160, y: 420, width: 760, height: 170 },
  { id: 'close-tagline', kind: 'text', x: 65, y: 690, width: 950, height: 140 },
  { id: 'close-cta', kind: 'cta', x: 220, y: 960, width: 640, height: 120 },
  { id: 'close-footer', kind: 'text', x: 340, y: 1150, width: 400, height: 40 },
];

const violations = keyLayout.filter((box) => (
  box.x < safeZone.left || box.y < safeZone.top || box.x + box.width > safeZone.right || box.y + box.height > safeZone.bottom
));

const report = {
  version: 'v10',
  status: violations.length === 0 ? 'pass' : 'fail',
  canvas: { width: 1080, height: 1920, fps: 30, durationInFrames: 540 },
  safeZone,
  keyLayout,
  violations,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
if (violations.length > 0) {
  console.error(`safe-zone fail: ${violations.map((box) => box.id).join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`safe-zone pass: ${keyLayout.length} boxes inside x=${safeZone.left}..${safeZone.right}, y=${safeZone.top}..${safeZone.bottom}`);
}
