// gate-owner: LEAD — renders every composition (or the ids given) and masters it for Instagram/Meta Ads.
// Usage: node scripts/build-ads.mjs [IstockPesos ...]
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const wanted = process.argv.slice(2);

function run(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

// Composition ids come from Remotion itself, so the spec list is the only source of truth.
const listing = run('npx', ['remotion', 'compositions', 'src/index.ts']);
const compositions = listing
  .split('\n')
  .map((line) => line.match(/^(Istock\w+)\s+30\s+1080x1920\s+(\d+)/))
  .filter(Boolean)
  .map((match) => ({ id: match[1], frames: Number(match[2]) }))
  .filter((composition) => wanted.length === 0 || wanted.includes(composition.id));
if (compositions.length === 0) throw new Error(`no compositions matched ${wanted.join(', ') || '(all)'}`);

// IstockReelV10 -> reel-v10, IstockPesos -> pesos
const slugOf = (id) => id.replace(/^Istock/, '').replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();

for (const { id, frames } of compositions) {
  const slug = slugOf(id);
  const seconds = frames / 30;
  const source = `out/istock-${slug}-source.mp4`;
  const master = `out/istock-${slug}.mp4`;
  const cover = `out/istock-${slug}-cover.png`;
  const publishDir = join(root, 'publish', slug);
  await access(join(publishDir, '03-caption.txt')).catch(() => {
    throw new Error(`${slug}: falta publish/${slug}/03-caption.txt (se escribe a mano antes de renderizar)`);
  });
  console.log(`▶ ${id} → ${slug} (${frames} f, ${seconds} s)`);
  run('npx', ['remotion', 'render', 'src/index.ts', id, source, '--codec=h264', '--crf=17', '--log=error']);
  run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', source,
    '-filter:v', 'scale=1080:1920:flags=lanczos,setsar=1,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709:field_mode=prog,format=yuv420p',
    '-filter:a', `atrim=duration=${seconds},asetpts=N/SR/TB,loudnorm=I=-17:TP=-1.5:LRA=7,aresample=48000`,
    '-t', String(seconds), '-map', '0:v:0', '-map', '0:a:0',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level:v', '4.2',
    '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-fps_mode', 'cfr', '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', master,
  ]);
  // Cover: the close scene fully settled, 40 frames before the end.
  run('npx', ['remotion', 'still', 'src/index.ts', id, cover, `--frame=${frames - 40}`, '--log=error']);
  await mkdir(publishDir, { recursive: true });
  await copyFile(join(root, master), join(publishDir, `01-istock-${slug}.mp4`));
  await copyFile(join(root, cover), join(publishDir, `02-istock-${slug}-cover.png`));
  const probe = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,pix_fmt', '-show_entries', 'format=duration,size', '-of', 'compact=p=0:nk=1', master]);
  console.log(`  ${probe.trim().split('\n').join(' · ')}`);
}
