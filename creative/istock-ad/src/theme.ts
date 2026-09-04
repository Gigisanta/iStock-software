export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 540,
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
  scale: 1.7,
  left: 208,
  top: 640,
  bezel: 22,
  screenRadius: 84,
  statusHeight: 50,
} as const;

// Scene boundaries in frames (30 fps).
export const BEATS = {
  hookEnd: 84,
  uploadEnd: 147,
  storefrontEnd: 246,
  detailEnd: 348,
  whatsappEnd: 456,
  end: 540,
} as const;

export const PRODUCT = {
  storeName: 'Alto Valle Celulares',
  storeHost: 'altovalle.maat.work',
  appHost: 'istock.maat.work',
  waText: 'Hola, vi el iPhone 14 Pro 256 Negro espacial (usado A) a USD 620 en altovalle.maat.work y lo quiero.',
} as const;
