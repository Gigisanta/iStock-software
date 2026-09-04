import type { AdSpec } from './spec';

// Every ad iStock publishes, as data. Add a spec here and `pnpm build` renders and masters it.

const CTA_LINE = 'Probalo 14 días gratis.';

export const NIGHT: AdSpec = {
  id: 'IstockReelV10',
  slug: 'reel-v10',
  music: 'night',
  scenes: [
    {
      kind: 'chat-hook',
      frames: 84,
      messages: [
        { text: '¿Tenés el 14 Pro?', time: '22:41', at: 2 },
        { text: '¿Precio?', time: '22:58', at: 9 },
        { text: '¿Y en pesos cuánto es?', time: '23:07', at: 16 },
        { text: '¿Cuánto de batería tiene?', time: '23:20', at: 23 },
        { text: '¿Me pasás fotos?', time: '23:31', at: 30 },
        { text: '¿Sigue disponible?', time: '23:52', at: 37 },
      ],
      headline: ['Todas las noches,', 'lo mismo.'],
      headlineAt: 42,
    },
    { kind: 'upload', frames: 63, title: 'Cargá el equipo una vez.' },
    { kind: 'screen', frames: 99, title: 'Queda en tu vidriera, con tu link.', file: 'storefront.png', scrollTo: 1180, host: true },
    { kind: 'screen', frames: 102, title: 'Dólares, pesos, batería, garantía. Todo dicho.', file: 'detail.png', scrollTo: 760 },
    { kind: 'whatsapp', frames: 108, title: 'Te escriben con el equipo ya escrito.' },
    { kind: 'close', frames: 84, lines: ['Tu stock en un link.', CTA_LINE] },
  ],
};

// Angle: the daily exchange-rate question. USD and ARS on every listing, updated once a day.
export const PESOS: AdSpec = {
  id: 'IstockPesos',
  slug: 'pesos',
  music: 'bright',
  scenes: [
    { kind: 'headline-hook', frames: 66, lines: ['¿Y en pesos', 'cuánto es?'], sub: 'La pregunta de todos los días.' },
    {
      kind: 'screen',
      frames: 120,
      title: 'Dólares y pesos al cambio del día. Solos.',
      file: 'detail.png',
      scrollTo: 0,
      highlight: { field: { x: 16, y: 165, w: 250, h: 48 }, at: 30 },
    },
    { kind: 'screen', frames: 90, title: 'Cada equipo con su precio, en tu link.', file: 'storefront.png', scrollFrom: 300, scrollTo: 900, host: true },
    { kind: 'close', frames: 84, lines: ['Precios al día, sin calculadora.', CTA_LINE] },
  ],
};

// Angle: speed. Fifteen units in one afternoon, WhatsApps that same night.
export const QUINCE: AdSpec = {
  id: 'IstockQuince',
  slug: 'quince',
  music: 'warm',
  scenes: [
    { kind: 'headline-hook', frames: 66, lines: ['15 equipos.', 'Una tarde.'], sub: 'Y esa noche ya te escriben.' },
    { kind: 'upload', frames: 66, title: 'Modelo, GB, color, estado, precio. Listo.' },
    { kind: 'screen', frames: 108, title: 'Tu stock entero, en un link.', file: 'storefront.png', scrollTo: 1180, host: true },
    { kind: 'close', frames: 90, lines: ['Cargalo una vez, vendelo siempre.', CTA_LINE] },
  ],
};

// Angle: the Instagram story. Stop rebuilding the list by hand: one link, always current.
export const ESTADOS: AdSpec = {
  id: 'IstockEstados',
  slug: 'estados',
  music: 'bright',
  scenes: [
    { kind: 'headline-hook', frames: 66, lines: ['Dejá de armar', 'el estado a mano.'], sub: 'Un link con todo tu stock.' },
    {
      kind: 'screen',
      frames: 84,
      title: 'Copiá el link de tu vidriera.',
      file: 'panel-home.png',
      scrollTo: 0,
      highlight: { field: { x: 35, y: 307, w: 322, h: 40 }, at: 30 },
    },
    { kind: 'screen', frames: 108, title: 'Compartilo en tu estado. Siempre al día.', file: 'storefront.png', scrollTo: 1180, host: true },
    { kind: 'whatsapp', frames: 96, title: 'Te escriben con el equipo ya escrito.' },
    { kind: 'close', frames: 84, lines: ['Un link en tu estado.', CTA_LINE] },
  ],
};

export const ADS: readonly AdSpec[] = [NIGHT, PESOS, QUINCE, ESTADOS];
