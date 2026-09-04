import { isDark, type TimedScene } from './spec';
import { FORM_STEP_OFFSETS } from '../scenes/Upload';
import { WA_OFFSETS } from '../scenes/WhatsApp';

export type SoundCue = { src: string; at: number; durationInFrames: number; gain: number };

// Every cue is derived from the scene list so a new ad gets its sound design for free.
export function cuesFor(scenes: readonly TimedScene[]): SoundCue[] {
  const cues: SoundCue[] = [];
  scenes.forEach((scene, index) => {
    const previous = index > 0 ? scenes[index - 1] : undefined;
    const enteringPaper = previous !== undefined && isDark(previous) && !isDark(scene);
    const enteringDark = previous !== undefined && !isDark(previous) && isDark(scene);
    if (enteringPaper || enteringDark) cues.push({ src: 'whoosh-v4.wav', at: scene.start - 4, durationInFrames: 20, gain: 0.35 });
    if (!enteringPaper && previous !== undefined && !isDark(scene) && !isDark(previous)) {
      cues.push({ src: 'micro-sweep-v7.wav', at: scene.start, durationInFrames: 18, gain: 0.32 });
    }
    switch (scene.kind) {
      case 'chat-hook':
        scene.messages.forEach((message, i) => cues.push({ src: 'micro-tap-v7.wav', at: scene.start + message.at, durationInFrames: 8, gain: 0.5 + i * 0.05 }));
        break;
      case 'headline-hook':
        scene.lines.forEach((_, i) => cues.push({ src: 'micro-tick-v7.wav', at: scene.start + 6 + i * 8, durationInFrames: 8, gain: 0.45 }));
        break;
      case 'upload':
        FORM_STEP_OFFSETS.forEach((offset) => cues.push({ src: 'micro-tick-v7.wav', at: scene.start + offset - 1, durationInFrames: 8, gain: 0.5 }));
        break;
      case 'screen':
        if (scene.highlight) cues.push({ src: 'micro-tick-v7.wav', at: scene.start + scene.highlight.at - 1, durationInFrames: 8, gain: 0.5 });
        break;
      case 'whatsapp':
        cues.push({ src: 'riser-v4.wav', at: scene.start - 24, durationInFrames: 26, gain: 0.22 });
        cues.push({ src: 'impact-v4.wav', at: scene.start, durationInFrames: 24, gain: 0.28 });
        cues.push({ src: 'micro-chime-v7.wav', at: scene.start + WA_OFFSETS.text, durationInFrames: 24, gain: 0.4 });
        cues.push({ src: 'micro-tap-v7.wav', at: scene.start + WA_OFFSETS.send, durationInFrames: 8, gain: 0.5 });
        cues.push({ src: 'warm-chime-v6.wav', at: scene.start + WA_OFFSETS.bubble, durationInFrames: 30, gain: 0.42 });
        break;
      case 'close':
        cues.push({ src: 'soft-chime-v5.wav', at: scene.start + 8, durationInFrames: 40, gain: 0.4 });
        break;
    }
  });
  return cues.filter((cue) => cue.at >= 0);
}
