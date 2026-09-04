import { access, readdir, readFile, stat } from 'node:fs/promises';

const requiredFiles = [
  'package.json',
  'tsconfig.json',
  'remotion.config.ts',
  'README.md',
  'BRIEF-v10.md',
  'src/index.ts',
  'src/Root.tsx',
  'src/Reel.tsx',
  'src/theme.ts',
  'src/motion.ts',
  'src/components/Phone.tsx',
  'src/components/Screenshot.tsx',
  'src/components/Caption.tsx',
  'src/components/Wipe.tsx',
  'src/components/SoundDesign.tsx',
  'src/scenes/Hook.tsx',
  'src/scenes/Upload.tsx',
  'src/scenes/Storefront.tsx',
  'src/scenes/Detail.tsx',
  'src/scenes/WhatsApp.tsx',
  'src/scenes/Close.tsx',
  'scripts/capture-v10.mjs',
  'public/istock-mark.svg',
  'public/v10/music.wav',
  'public/v10/ui/form-geom.json',
  'publish/reel-v10/01-istock-reel-v10.mp4',
  'publish/reel-v10/02-istock-reel-v10-cover.png',
  'publish/reel-v10/03-caption.txt',
];
for (const path of requiredFiles) await access(path);

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
for (const script of ['capture', 'render', 'finalize', 'still', 'safe-zone']) {
  if (packageJson.scripts?.[script] === undefined) throw new Error(`Falta el script ${script}`);
}

const root = await readFile('src/Root.tsx', 'utf8');
if (!root.includes('IstockReelV10')) throw new Error('Root.tsx no registra IstockReelV10');
const theme = await readFile('src/theme.ts', 'utf8');
for (const token of ['width: 1080', 'height: 1920', 'durationInFrames: 540']) {
  if (!theme.includes(token)) throw new Error(`theme.ts no declara ${token}`);
}

// The WhatsApp message is the product contract: exact text, USD price, host, no IMEI.
const whatsapp = await readFile('src/theme.ts', 'utf8');
if (!whatsapp.includes('Hola, vi el iPhone 14 Pro 256 Negro espacial (usado A) a USD 620 en altovalle.maat.work y lo quiero.')) {
  throw new Error('El mensaje de WhatsApp no coincide con el contrato del producto');
}

const music = await stat('public/v10/music.wav');
if (music.size < 48_000 * 4 * 17) throw new Error('La música parece vacía o más corta que 17 s');
const geom = JSON.parse(await readFile('public/v10/ui/form-geom.json', 'utf8'));
if (geom.imei?.w !== 0 || geom.cost?.w !== 0) throw new Error('La captura del formulario expone IMEI o costo');

const publishFiles = (await readdir('publish/reel-v10')).sort();
const expected = ['01-istock-reel-v10.mp4', '02-istock-reel-v10-cover.png', '03-caption.txt'];
if (publishFiles.join('\n') !== expected.join('\n')) throw new Error(`publish/reel-v10 debe contener sólo ${expected.join(', ')}`);
const caption = await readFile('publish/reel-v10/03-caption.txt', 'utf8');
if (!caption.includes('istock.maat.work')) throw new Error('El caption no lleva la URL');

const sfx = (await readdir('public/sfx')).filter((file) => file.endsWith('.wav'));
for (const file of ['micro-tap-v7.wav', 'micro-tick-v7.wav', 'micro-sweep-v7.wav', 'micro-chime-v7.wav', 'warm-chime-v6.wav', 'soft-chime-v5.wav', 'whoosh-v4.wav']) {
  if (!sfx.includes(file)) throw new Error(`Falta el efecto ${file}`);
}
console.log(`smoke test ok: ${requiredFiles.length} archivos, música ${music.size} bytes, sfx ${sfx.length}`);
