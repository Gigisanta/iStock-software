// An ad is a list of scenes. Everything the builder, the sound design and the
// render script need is derived from this declaration; nothing is hardcoded per ad.

export type Shot = { file: string; scroll: number };
export type Field = { x: number; y: number; w: number; h: number };
export type ChatMessage = { text: string; time: string; at: number };

export type SceneSpec =
  | {
      // Dark card: incoming chat questions pile up, then a headline lands.
      kind: 'chat-hook';
      frames: number;
      messages: readonly ChatMessage[];
      headline: readonly string[];
      headlineAt: number;
    }
  | {
      // Dark card: two or three big lines and an optional sub line.
      kind: 'headline-hook';
      frames: number;
      lines: readonly string[];
      sub?: string;
    }
  | {
      // The real "new unit" form filling itself in (form-0..4 captures).
      kind: 'upload';
      frames: number;
      title: string;
    }
  | {
      // Any real capture on the phone, scrolling; optional host pill and a highlighted field.
      kind: 'screen';
      frames: number;
      title: string;
      file: string;
      scrollFrom?: number;
      scrollTo: number;
      host?: boolean;
      highlight?: { field: Field; at: number };
    }
  | {
      // Hand-drawn WhatsApp chat: the product message is already written, then sent.
      kind: 'whatsapp';
      frames: number;
      title: string;
    }
  | {
      // Brand lockup, tagline and the single CTA.
      kind: 'close';
      frames: number;
      lines: readonly string[];
    };

export type AdSpec = {
  id: string;
  slug: string;
  music: 'night' | 'bright' | 'warm';
  scenes: readonly SceneSpec[];
};

export type TimedScene = SceneSpec & {
  index: number;
  start: number;
  end: number;
  // Number shown as the caption kicker on phone scenes.
  kicker?: string;
  // Last shot of the previous phone scene, if the phone was already on screen.
  prev?: Shot;
};

export const isDark = (scene: SceneSpec) => scene.kind === 'chat-hook' || scene.kind === 'headline-hook' || scene.kind === 'close';

export function exitShot(scene: SceneSpec): Shot | undefined {
  if (scene.kind === 'upload') return { file: 'form-4.png', scroll: 0 };
  if (scene.kind === 'screen') return { file: scene.file, scroll: scene.scrollTo };
  return undefined;
}

export function timeline(spec: AdSpec): { scenes: TimedScene[]; durationInFrames: number } {
  const scenes: TimedScene[] = [];
  let cursor = 0;
  let phoneCount = 0;
  let prev: Shot | undefined;
  spec.scenes.forEach((scene, index) => {
    const dark = isDark(scene);
    const timed: TimedScene = { ...scene, index, start: cursor, end: cursor + scene.frames };
    if (!dark) {
      phoneCount += 1;
      timed.kicker = String(phoneCount);
      timed.prev = prev;
    }
    prev = dark ? undefined : exitShot(scene);
    scenes.push(timed);
    cursor += scene.frames;
  });
  return { scenes, durationInFrames: cursor };
}
