export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
} as const;

// Meta Reels review rectangle: overlay text, logo and CTA stay inside.
export const SAFE_ZONE = {
  left: 65,
  top: 269,
  right: 1015,
  bottom: 1248,
} as const;

export const COLORS = {
  ink: '#111513',
  inkSoft: '#26302a',
  bubble: '#2a322d',
  paper: '#f1f3ee',
  paperStrong: '#e7ece7',
  line: '#c7d1c9',
  muted: '#8a978e',
  mutedInk: '#5b665f',
  white: '#ffffff',
  accent: '#2f8f68',
  accentSoft: '#a4efc9',
  waGreen: '#25d366',
  waHeader: '#f6f6f6',
  waWall: '#e8e2d9',
  waOut: '#d9fdd3',
  waKey: '#fcfcfe',
  waKeyboard: '#d1d5db',
} as const;

export const TYPE = {
  sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  mono: '"SFMono-Regular", Menlo, Consolas, monospace',
} as const;

// Device: iPhone-sized CSS viewport rendered at PHONE_SCALE.
export const PHONE = {
  cssWidth: 390,
  cssHeight: 844,
  // Whole device visible: shell spans y 600..1868, centred on x.
  scale: 1.45,
  left: 257,
  top: 622,
  bezel: 22,
  screenRadius: 84,
  statusHeight: 50,
} as const;

export const PRODUCT = {
  storeName: 'Alto Valle Celulares',
  storeHost: 'istock.maat.work',
  appHost: 'istock.maat.work',
  waText: 'Hola, vi el iPhone 14 Pro 256 Negro espacial (usado A) a USD 620 en istock.maat.work y lo quiero.',
} as const;
