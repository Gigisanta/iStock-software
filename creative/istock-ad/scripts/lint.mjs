// gate-owner: LEAD — este lint audita el artefacto creativo que ejecuta el paquete.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';

const root = new URL('../', import.meta.url).pathname;
const forbiddenTokens = [
  ['linear-gradient', 'gradient'],
  ['radial-gradient', 'gradient'],
  ['backdrop-filter', 'glassmorphism'],
  ['console.log', 'console logging'],
  ['demo.maat.work', 'seed tenant host leaked into the ad'],
  ['iStock Demo', 'seed tenant name leaked into the ad'],
  ['altovalle.maat.work', 'invented tenant host: the ad only ever shows istock.maat.work'],
  ['imei', 'owner-only field named in the ad'],
  ['cost', 'owner-only field named in the ad'],
];

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

// validate.ts is the file that names the forbidden words in order to reject them; it is the rule, not a leak.
const sourceFiles = (await filesIn(join(root, 'src'))).filter((file) => !file.endsWith('/src/ads/validate.ts'));
const failures = [];
for (const file of sourceFiles) {
  const content = (await readFile(file, 'utf8')).toLowerCase();
  for (const [token, label] of forbiddenTokens) {
    if (content.includes(token.toLowerCase())) failures.push(`${relative(root, file)}: ${label}`);
  }
}

// Every capture the composition references must exist and be a real image.
const captures = ['storefront.png', 'detail.png', 'panel-home.png', 'form-0.png', 'form-1.png', 'form-2.png', 'form-3.png', 'form-4.png'];
for (const capture of captures) {
  try {
    const info = await stat(join(root, 'public/v10/ui', capture));
    if (info.size < 50_000) failures.push(`public/v10/ui/${capture}: too small to be a real capture`);
  } catch {
    failures.push(`public/v10/ui/${capture}: missing capture`);
  }
}

if (failures.length > 0) {
  console.error(`creative lint failed\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log(`creative lint ok: ${sourceFiles.length} source files, ${captures.length} captures present`);
