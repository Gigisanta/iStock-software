import sharp from 'sharp';

/**
 * Fuente visual sintética para la vidriera técnica del demo.
 *
 * No representa stock real ni se usa para fotos de clientes: existe para que el tenant `demo`
 * sea navegable desde una instalación recién sembrada. Se convierte a PNG antes de entrar al
 * pipeline normal, así el demo usa exactamente los mismos techos, variantes y keys que una foto
 * real. La escena es deliberadamente monocroma para no reintroducir el verde que la UI abandonó.
 */
export interface DemoPhotoSourceOptions {
  readonly listingSlug: string;
  readonly photoIndex: number;
}

function stableNumber(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    const escaped: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return escaped[character] ?? character;
  });
}

/**
 * Crea una imagen de producto de demo de 1200×900.
 *
 * `listingSlug` sólo decide una variación geométrica estable; no se imprime en la imagen, así la
 * fuente no puede filtrar un slug interno ni generar texto que el XML interprete como markup.
 */
export async function buildDemoPhotoSource(options: DemoPhotoSourceOptions): Promise<Buffer> {
  const seed = stableNumber(`${options.listingSlug}:${String(options.photoIndex)}`);
  const rotation = [-8, 0, 7][seed % 3] ?? 0;
  const background = ['#f0f0f0', '#e7e7e7', '#f6f6f6'][seed % 3] ?? '#f0f0f0';
  const shadow = ['#cfcfcf', '#d5d5d5', '#c8c8c8'][seed % 3] ?? '#cfcfcf';
  const cameraOffset = (seed % 18) - 9;
  const screenTone = options.photoIndex === 1 ? '#d1d1d1' : options.photoIndex === 2 ? '#bdbdbd' : '#e1e1e1';

  // `escapeXml` is intentionally exercised even though the current SVG has no text nodes: this
  // keeps the helper safe if the demo later grows a small label without turning seed data into an
  // XML injection surface.
  const marker = escapeXml(`demo-${String(seed)}`);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
      <title>${marker}</title>
      <rect width="1200" height="900" fill="${background}"/>
      <circle cx="1010" cy="150" r="260" fill="#dedede"/>
      <circle cx="140" cy="820" r="300" fill="#fafafa"/>
      <path d="M170 760 870 610 1050 760 350 875Z" fill="${shadow}" opacity=".72"/>
      <g transform="rotate(${String(rotation)} 600 450)">
        <rect x="390" y="75" width="420" height="750" rx="66" fill="#151515"/>
        <rect x="407" y="92" width="386" height="716" rx="52" fill="#2a2a2a"/>
        <rect x="427" y="112" width="346" height="676" rx="40" fill="#f8f8f8"/>
        <rect x="546" y="130" width="108" height="24" rx="12" fill="#151515"/>
        <rect x="459" y="212" width="282" height="318" rx="28" fill="${screenTone}"/>
        <path d="M492 575h216M520 616h160M548 657h104" stroke="#b2b2b2" stroke-width="15" stroke-linecap="round"/>
        <circle cx="${String(600 + cameraOffset)}" cy="745" r="25" fill="#202020"/>
        <circle cx="${String(590 + cameraOffset)}" cy="735" r="6" fill="#e5e5e5"/>
      </g>
    </svg>
  `;

  return sharp(Buffer.from(svg, 'utf8')).png().toBuffer();
}
