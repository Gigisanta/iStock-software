import { isDark, timeline, type AdSpec } from './spec.ts';

// Every rule a spec must satisfy before it can render. Root.tsx runs this, so a broken
// spec fails `remotion compositions` and therefore the build; scripts/check-specs.mjs
// prints the same verdict from Node.

// The only host an ad may ever show. Tenant hosts, the seed tenant and dev hosts are out.
export const PRODUCT_HOST = 'istock.maat.work';
const FORBIDDEN_COPY = ['altovalle', 'demo.maat.work', 'istock demo', 'localhost', 'imei', 'costo', 'margen'];
export const CTA_LINE = 'Probalo 14 días gratis.';

const MUSIC_BED_FRAMES = 24 * 30;
const MIN_AD_FRAMES = 8 * 30;
const MIN_SCENE_FRAMES = 45;
const PHONE_CSS = { width: 390, height: 844 };
// Character budgets that keep each text inside its box at its font size (two lines max).
const LIMITS = { title: 52, headlineLine: 18, chatHeadlineLine: 20, sub: 44, closeLine: 40, message: 34 };

// IstockReelV10 -> reel-v10. scripts/build-ads.mjs derives the publish slug the same way.
export const slugOf = (id: string) => id.replace(/^Istock/, '').replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();

function copyOf(spec: AdSpec): string[] {
  return spec.scenes.flatMap((scene) => {
    switch (scene.kind) {
      case 'chat-hook':
        return [...scene.messages.map((message) => message.text), ...scene.headline];
      case 'headline-hook':
        return [...scene.lines, ...(scene.sub ? [scene.sub] : [])];
      case 'close':
        return [...scene.lines];
      default:
        return [scene.title];
    }
  });
}

export function validate(spec: AdSpec): string[] {
  const errors: string[] = [];
  const fail = (message: string) => errors.push(`${spec.id}: ${message}`);
  if (!/^Istock[A-Z][A-Za-z0-9]+$/.test(spec.id)) fail(`id must look like IstockNombre, got ${spec.id}`);
  if (spec.slug !== slugOf(spec.id)) fail(`slug must be ${slugOf(spec.id)}, got ${spec.slug}`);

  const { scenes, durationInFrames } = timeline(spec);
  if (durationInFrames < MIN_AD_FRAMES) fail(`too short: ${durationInFrames} frames, minimum ${MIN_AD_FRAMES}`);
  if (durationInFrames > MUSIC_BED_FRAMES) fail(`too long: ${durationInFrames} frames, the music beds last ${MUSIC_BED_FRAMES}`);
  const first = scenes[0];
  const last = scenes[scenes.length - 1];
  if (!first || !(first.kind === 'chat-hook' || first.kind === 'headline-hook')) fail('must open with a hook scene');
  if (!last || last.kind !== 'close') fail('must end with a close scene');
  if (last?.kind === 'close' && !last.lines.includes(CTA_LINE)) fail(`close must carry the CTA line "${CTA_LINE}"`);
  if (!scenes.some((scene) => !isDark(scene))) fail('must show the product on the phone at least once');

  for (const scene of scenes) {
    const at = `scene ${scene.index} (${scene.kind})`;
    if (scene.frames < MIN_SCENE_FRAMES) fail(`${at} lasts ${scene.frames} frames, minimum ${MIN_SCENE_FRAMES}`);
    const over = (label: string, text: string, limit: number) => {
      if (text.length > limit) fail(`${at} ${label} "${text}" has ${text.length} chars, limit ${limit}`);
    };
    switch (scene.kind) {
      case 'chat-hook':
        if (scene.messages.length < 3 || scene.messages.length > 6) fail(`${at} needs 3..6 messages`);
        if (scene.headline.length < 1 || scene.headline.length > 2) fail(`${at} headline needs 1..2 lines`);
        for (const message of scene.messages) {
          over('message', message.text, LIMITS.message);
          if (message.at < 0 || message.at >= scene.headlineAt) fail(`${at} message "${message.text}" lands after the headline`);
        }
        for (const line of scene.headline) over('headline line', line, LIMITS.chatHeadlineLine);
        if (scene.headlineAt + 14 > scene.frames) fail(`${at} headline never settles before the scene ends`);
        break;
      case 'headline-hook':
        if (scene.lines.length < 1 || scene.lines.length > 3) fail(`${at} needs 1..3 lines`);
        for (const line of scene.lines) over('line', line, LIMITS.headlineLine);
        if (scene.sub) over('sub', scene.sub, LIMITS.sub);
        break;
      case 'close':
        if (scene.lines.length < 1 || scene.lines.length > 3) fail(`${at} needs 1..3 lines`);
        for (const line of scene.lines) over('line', line, LIMITS.closeLine);
        break;
      case 'screen': {
        over('title', scene.title, LIMITS.title);
        if (!scene.file.endsWith('.png')) fail(`${at} file must be a png capture, got ${scene.file}`);
        if ((scene.scrollFrom ?? 0) < 0 || scene.scrollTo < 0) fail(`${at} scroll must be positive`);
        const highlight = scene.highlight;
        if (highlight) {
          const scroll = scene.scrollFrom ?? 0;
          const { field } = highlight;
          if (field.x < 0 || field.y - scroll < 0 || field.x + field.w > PHONE_CSS.width || field.y - scroll + field.h > PHONE_CSS.height) {
            fail(`${at} highlight field is off the phone screen`);
          }
          if (scene.scrollFrom !== scene.scrollTo && scene.scrollTo !== 0) fail(`${at} highlights a field while scrolling; keep scrollTo 0`);
          if (highlight.at < 12 || highlight.at + 20 > scene.frames) fail(`${at} highlight at ${highlight.at} is outside the scene`);
        }
        break;
      }
      default:
        over('title', scene.title, LIMITS.title);
    }
  }

  for (const text of copyOf(spec)) {
    const lower = text.toLowerCase();
    for (const token of FORBIDDEN_COPY) if (lower.includes(token)) fail(`copy "${text}" contains forbidden "${token}"`);
    const hosts = lower.match(/[a-z0-9-]+\.maat\.work/g) ?? [];
    for (const host of hosts) if (host !== PRODUCT_HOST) fail(`copy "${text}" names ${host}; only ${PRODUCT_HOST} is allowed`);
  }
  return errors;
}

export function assertValid(specs: readonly AdSpec[]): void {
  const ids = new Set<string>();
  const errors = specs.flatMap((spec) => {
    const duplicate = ids.has(spec.id) ? [`${spec.id}: duplicate id`] : [];
    ids.add(spec.id);
    return [...duplicate, ...validate(spec)];
  });
  if (errors.length > 0) throw new Error(`invalid ad specs:\n${errors.join('\n')}`);
}
