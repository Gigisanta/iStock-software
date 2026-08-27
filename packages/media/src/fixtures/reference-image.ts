/**
 * Imagen de referencia **determinista**, generada con sharp. No hay binarios en el repo.
 *
 * Simula lo que sube el dueño: 4000×3000 (12 MP) JPEG del escritorio de un local — un celular en
 * el centro, cajas y accesorios alrededor, madera con veta, tela, grano de sensor.
 *
 * ## Por qué la textura importa
 * Un gradiente liso comprime a nada y volvería el test de presupuesto una mentira: `card` daría
 * 15 KB contra un techo de 150 KB y ninguna regresión real se detectaría. Acá el detalle es
 * **multi-octava**, con features de pocos píxeles **medidos a 1600px**, que es donde el detalle
 * sobrevive al downscale. El resultado calibrado deja `card` en la zona de una foto real de
 * producto (ver README, tabla de bytes medidos).
 *
 * `mulberry32` + hash entero como PRNG: mismo seed ⇒ mismos bytes ⇒ mismo hash ⇒ misma key,
 * en cualquier máquina.
 */

import sharp from 'sharp';

export const REFERENCE_WIDTH = 4000;
export const REFERENCE_HEIGHT = 3000;
export const REFERENCE_MEGAPIXELS = (REFERENCE_WIDTH * REFERENCE_HEIGHT) / 1_000_000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

/** Grilla de valores aleatorios de una octava, muestreada con interpolación bilineal. */
class NoiseOctave {
  private readonly cols: number;
  private readonly rows: number;
  private readonly grid: Float32Array;

  constructor(cols: number, rows: number, seed: number) {
    this.cols = cols;
    this.rows = rows;
    const rand = mulberry32(seed);
    this.grid = new Float32Array((cols + 1) * (rows + 1));
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = rand() * 2 - 1;
  }

  /** `nx`, `ny` en [0,1]. */
  sample(nx: number, ny: number): number {
    const fx = nx * this.cols;
    const fy = ny * this.rows;
    const x0 = fx | 0;
    const y0 = fy | 0;
    const tx = fx - x0;
    const ty = fy - y0;
    const w = this.cols + 1;
    const i00 = y0 * w + x0;
    const a = this.grid[i00] ?? 0;
    const b = this.grid[i00 + 1] ?? 0;
    const c = this.grid[i00 + w] ?? 0;
    const d = this.grid[i00 + w + 1] ?? 0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const top = a + (b - a) * sx;
    const bottom = c + (d - c) * sx;
    return top + (bottom - top) * sy;
  }
}

/**
 * fbm con 9 octavas. La octava más fina son 640 celdas a lo ancho: ~2.5 px a 1600px de salida,
 * o sea detalle que **sobrevive** el downscale y hay que pagar en bytes.
 */
class Fbm {
  private readonly octaves: readonly { octave: NoiseOctave; amp: number }[];

  constructor(seed: number) {
    const freqs = [5, 10, 20, 40, 80, 160, 320, 640, 1280];
    const aspect = REFERENCE_HEIGHT / REFERENCE_WIDTH;
    let amp = 1;
    this.octaves = freqs.map((f, i) => {
      const entry = {
        octave: new NoiseOctave(f, Math.max(2, Math.round(f * aspect)), seed + i * 7919),
        amp,
      };
      amp *= 0.82;
      return entry;
    });
  }

  at(nx: number, ny: number): number {
    let sum = 0;
    let norm = 0;
    for (const { octave, amp } of this.octaves) {
      sum += octave.sample(nx, ny) * amp;
      norm += amp;
    }
    return sum / norm;
  }
}

interface Prop {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
  g: number;
  b: number;
}

function props(seed: number): readonly Prop[] {
  const rand = mulberry32(seed);
  const out: Prop[] = [];
  for (let i = 0; i < 260; i++) {
    const w = 30 + rand() * 210;
    const h = 30 + rand() * 210;
    const x0 = rand() * (REFERENCE_WIDTH - w);
    const y0 = rand() * (REFERENCE_HEIGHT - h);
    out.push({
      x0,
      y0,
      x1: x0 + w,
      y1: y0 + h,
      r: 25 + rand() * 220,
      g: 25 + rand() * 220,
      b: 25 + rand() * 220,
    });
  }
  return out;
}

/** RGB crudo de la escena. Exportado para poder derivar fixtures en los tests. */
export function referenceRaw(seed = 20260827): Buffer {
  const rand = mulberry32(seed ^ 0x5bf03635);
  const fbmR = new Fbm(seed);
  const fbmG = new Fbm(seed + 101);
  const fbmB = new Fbm(seed + 202);
  const scene = props(seed + 303);

  const w = REFERENCE_WIDTH;
  const h = REFERENCE_HEIGHT;
  const buf = Buffer.allocUnsafe(w * h * 3);

  const phoneW = Math.round(w * 0.26);
  const phoneH = Math.round(h * 0.7);
  const phoneX = Math.round((w - phoneW) / 2);
  const phoneY = Math.round((h - phoneH) / 2);

  // Índice espacial berreta para no evaluar 260 props por píxel.
  const bandHeight = 128;
  const bands: Prop[][] = [];
  for (let y = 0; y < h; y += bandHeight) {
    bands.push(scene.filter((p) => p.y1 >= y && p.y0 <= y + bandHeight));
  }

  let i = 0;
  for (let y = 0; y < h; y++) {
    const ny = y / h;
    const band = bands[(y / bandHeight) | 0] ?? [];
    for (let x = 0; x < w; x++) {
      const nx = x / w;
      let r: number;
      let g: number;
      let b: number;

      const inPhone = x >= phoneX && x < phoneX + phoneW && y >= phoneY && y < phoneY + phoneH;
      if (inPhone) {
        const px = (x - phoneX) / phoneW;
        const py = (y - phoneY) / phoneH;
        const bezel = px < 0.045 || px > 0.955 || py < 0.03 || py > 0.97;
        if (bezel) {
          const spec = Math.pow(Math.max(0, 1 - Math.abs(px - py) * 3), 6) * 90;
          r = 132 + spec;
          g = 136 + spec;
          b = 142 + spec;
        } else {
          // Pantalla: grilla de iconos + líneas tipo texto. Bordes duros = bytes.
          const gx = px * 4;
          const gy = py * 8;
          const cell = Math.floor(gx) + Math.floor(gy) * 4;
          const inIcon = gx % 1 > 0.18 && gx % 1 < 0.82 && gy % 1 > 0.12 && gy % 1 < 0.7;
          const textLine = gy % 1 > 0.78 && gy % 1 < 0.92 && (gx * 26) % 1 < 0.62;
          r = 18 + ((cell * 37) % 90) + (inIcon ? 90 : 0) + (textLine ? 190 : 0);
          g = 22 + ((cell * 53) % 100) + (inIcon ? 55 : 0) + (textLine ? 190 : 0);
          b = 40 + ((cell * 29) % 120) + (inIcon ? 110 : 0) + (textLine ? 190 : 0);
          r += fbmR.at(nx, ny) * 34;
          g += fbmG.at(nx, ny) * 34;
          b += fbmB.at(nx, ny) * 34;
        }
      } else {
        // Escritorio: madera con veta + fbm cromático (tela, cartón, cables).
        const grain =
          Math.sin(ny * 210 + Math.sin(nx * 13) * 4) * 10 +
          Math.sin(ny * 51 + nx * 3) * 6 +
          Math.sin(nx * 430) * 4;
        const vignette = 1 - 0.3 * ((nx - 0.5) ** 2 + (ny - 0.5) ** 2) * 2;
        r = (166 + grain) * vignette + fbmR.at(nx, ny) * 88;
        g = (124 + grain * 0.9) * vignette + fbmG.at(nx, ny) * 88;
        b = (84 + grain * 0.7) * vignette + fbmB.at(nx, ny) * 88;

        for (let p = 0; p < band.length; p++) {
          const prop = band[p];
          if (prop === undefined) continue;
          if (x < prop.x0 || x > prop.x1 || y < prop.y0 || y > prop.y1) continue;
          const edge =
            x - prop.x0 < 4 || prop.x1 - x < 4 || y - prop.y0 < 4 || prop.y1 - y < 4 ? 55 : 0;
          r = prop.r + edge + fbmR.at(nx, ny) * 58;
          g = prop.g + edge + fbmG.at(nx, ny) * 58;
          b = prop.b + edge + fbmB.at(nx, ny) * 58;
        }
      }

      // Grano de sensor.
      const noise = (rand() - 0.5) * 20;
      buf[i++] = clamp255(r + noise);
      buf[i++] = clamp255(g + noise * 0.92);
      buf[i++] = clamp255(b + noise * 1.08);
    }
  }
  return buf;
}

let cached: Promise<Buffer> | null = null;

/**
 * JPEG de 12 MP, tal como saldría de la cámara. `mozjpeg: false` y `chromaSubsampling` explícitos
 * para que el byte de salida no dependa de defaults que puedan cambiar entre versiones de sharp.
 */
export async function referencePhotoJpeg(): Promise<Buffer> {
  cached ??= sharp(referenceRaw(), {
    raw: { width: REFERENCE_WIDTH, height: REFERENCE_HEIGHT, channels: 3 },
  })
    .jpeg({ quality: 88, chromaSubsampling: '4:2:0', mozjpeg: false })
    .toBuffer();
  return cached;
}

/** PNG chico y liso, para tests que sólo necesitan "una imagen válida". */
export async function tinyPng(size = 64): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: 210, g: 40, b: 90 } },
  })
    .png()
    .toBuffer();
}

/**
 * Imagen deliberadamente incompresible (ruido puro por píxel): ninguna variante entra en su techo.
 * Sirve para probar que el gate de presupuesto **falla** cuando tiene que fallar.
 */
export async function incompressibleNoise(width = 1600, height = 1600, seed = 7): Promise<Buffer> {
  const rand = mulberry32(seed);
  const buf = Buffer.allocUnsafe(width * height * 3);
  for (let i = 0; i < buf.length; i++) buf[i] = (rand() * 256) | 0;
  return sharp(buf, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

/**
 * Foto "difícil pero real": textura de alta frecuencia (tela, alfombra, pasto) sobre un fondo
 * suave. A calidad nominal (q78) `card` se pasa de los 150 KB; el descenso adaptativo la baja
 * hasta entrar. Prueba que el presupuesto se hace cumplir **en runtime**, no sólo en el test.
 */
export async function stressPhoto(amplitude = 70, seed = 11): Promise<Buffer> {
  const rand = mulberry32(seed);
  const w = 1600;
  const h = 1200;
  const buf = Buffer.allocUnsafe(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const base = 90 + 70 * Math.sin((x / w) * 3) + 40 * Math.cos((y / h) * 4);
      for (let c = 0; c < 3; c++) {
        buf[(y * w + x) * 3 + c] = clamp255(base + (rand() - 0.5) * amplitude * 2);
      }
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}
