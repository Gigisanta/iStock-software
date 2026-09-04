import { access, readdir, readFile, stat } from 'node:fs/promises';

const SLUGS = ['reel-v10', 'pesos', 'quince', 'estados'];
const requiredFiles = [
  'package.json',
  'tsconfig.json',
  'remotion.config.ts',
  'README.md',
  'BRIEF-v10.md',
  'ADS.md',
  'src/index.ts',
  'src/Root.tsx',
  'src/Ad.tsx',
  'src/ads/spec.ts',
  'src/ads/sound.ts',
  'src/ads/index.ts',
  'src/theme.ts',
  'src/motion.ts',
  'src/components/Phone.tsx',
  'src/components/Screenshot.tsx',
  'src/components/Caption.tsx',
  'src/components/Wipe.tsx',
  'src/components/SoundDesign.tsx',
  'src/components/FieldTap.tsx',
  'src/scenes/Hook.tsx',
  'src/scenes/Upload.tsx',
  'src/scenes/Screen.tsx',
  'src/scenes/WhatsApp.tsx',
  'src/scenes/Close.tsx',
  'scripts/capture-v10.mjs',
  'scripts/build-ads.mjs',
  'public/istock-mark.svg',
  'public/v10/ui/form-geom.json',
  ...SLUGS.flatMap((slug) => [`publish/${slug}/01-istock-${slug}.mp4`, `publish/${slug}/02-istock-${slug}-cover.png`, `publish/${slug}/03-caption.txt`]),
];
for (const path of requiredFiles) await access(path);

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
for (const script of ['capture', 'build', 'compositions', 'safe-zone']) {
  if (packageJson.scripts?.[script] === undefined) throw new Error(`Falta el script ${script}`);
}

const ads = await readFile('src/ads/index.ts', 'utf8');
for (const id of ['IstockReelV10', 'IstockPesos', 'IstockQuince', 'IstockEstados']) {
  if (!ads.includes(`id: '${id}'`)) throw new Error(`src/ads/index.ts no declara ${id}`);
}
const theme = await readFile('src/theme.ts', 'utf8');
for (const token of ['width: 1080', 'height: 1920']) {
  if (!theme.includes(token)) throw new Error(`theme.ts no declara ${token}`);
}

// The WhatsApp message is the product contract: exact text, USD price, host, no IMEI.
const whatsapp = await readFile('src/theme.ts', 'utf8');
if (!whatsapp.includes('Hola, vi el iPhone 14 Pro 256 Negro espacial (usado A) a USD 620 en istock.maat.work y lo quiero.')) {
  throw new Error('El mensaje de WhatsApp no coincide con el contrato del producto');
}

// Music beds are 24 s; SoundDesign fades them, so any ad up to 24 s can use any bed.
let musicBytes = 0;
for (const bed of ['night', 'bright', 'warm']) {
  const music = await stat(`public/music/${bed}.wav`);
  if (music.size < 48_000 * 4 * 23) throw new Error(`public/music/${bed}.wav parece vacía o más corta que 23 s`);
  musicBytes += music.size;
}
const geom = JSON.parse(await readFile('public/v10/ui/form-geom.json', 'utf8'));
if (geom.imei?.w !== 0 || geom.cost?.w !== 0) throw new Error('La captura del formulario expone IMEI o costo');

for (const slug of SLUGS) {
  const publishFiles = (await readdir(`publish/${slug}`)).sort();
  const expected = [`01-istock-${slug}.mp4`, `02-istock-${slug}-cover.png`, '03-caption.txt'];
  if (publishFiles.join('\n') !== expected.join('\n')) throw new Error(`publish/${slug} debe contener sólo ${expected.join(', ')}`);
  const caption = await readFile(`publish/${slug}/03-caption.txt`, 'utf8');
  if (!caption.includes('istock.maat.work')) throw new Error(`El caption de ${slug} no lleva la URL`);
  if (/[a-z0-9-]+\.maat\.work/.test(caption.replace(/istock\.maat\.work/g, ''))) throw new Error(`El caption de ${slug} nombra otro host que istock.maat.work`);
}

const sfx = (await readdir('public/sfx')).filter((file) => file.endsWith('.wav'));
for (const file of ['micro-tap-v7.wav', 'micro-tick-v7.wav', 'micro-sweep-v7.wav', 'micro-chime-v7.wav', 'warm-chime-v6.wav', 'soft-chime-v5.wav', 'whoosh-v4.wav']) {
  if (!sfx.includes(file)) throw new Error(`Falta el efecto ${file}`);
}
console.log(`smoke test ok: ${requiredFiles.length} archivos, música ${musicBytes} bytes, sfx ${sfx.length}`);
