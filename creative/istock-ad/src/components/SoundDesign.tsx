import { Audio } from '@remotion/media';
import { interpolate, Sequence, staticFile } from 'remotion';
import { HOOK_MESSAGES } from '../scenes/Hook';
import { FORM_STEPS } from '../scenes/Upload';
import { WA } from '../scenes/WhatsApp';
import { BEATS } from '../theme';

type SoundCue = { src: string; at: number; durationInFrames: number; gain: number };

const CUES: readonly SoundCue[] = [
  ...HOOK_MESSAGES.map((message, index) => ({ src: 'micro-tap-v7.wav', at: message.at, durationInFrames: 8, gain: 0.5 + index * 0.05 })),
  { src: 'whoosh-v4.wav', at: BEATS.hookEnd - 4, durationInFrames: 20, gain: 0.35 },
  ...FORM_STEPS.map((step) => ({ src: 'micro-tick-v7.wav', at: step.at - 1, durationInFrames: 8, gain: 0.5 })),
  { src: 'micro-sweep-v7.wav', at: BEATS.uploadEnd, durationInFrames: 18, gain: 0.32 },
  { src: 'micro-sweep-v7.wav', at: BEATS.storefrontEnd, durationInFrames: 18, gain: 0.32 },
  { src: 'riser-v4.wav', at: BEATS.detailEnd - 24, durationInFrames: 26, gain: 0.22 },
  { src: 'impact-v4.wav', at: BEATS.detailEnd, durationInFrames: 24, gain: 0.28 },
  { src: 'micro-chime-v7.wav', at: WA.textAt, durationInFrames: 24, gain: 0.4 },
  { src: 'micro-tap-v7.wav', at: WA.sendAt, durationInFrames: 8, gain: 0.5 },
  { src: 'warm-chime-v6.wav', at: WA.bubbleAt, durationInFrames: 30, gain: 0.42 },
  { src: 'whoosh-v4.wav', at: BEATS.whatsappEnd - 4, durationInFrames: 20, gain: 0.35 },
  { src: 'soft-chime-v5.wav', at: BEATS.whatsappEnd + 8, durationInFrames: 40, gain: 0.4 },
];

function musicVolume(frame: number) {
  const base = interpolate(frame, [0, 12, BEATS.end - 24, BEATS.end], [0, 0.9, 0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  let duck = 0;
  for (const cue of CUES) {
    const cueDuck = interpolate(frame, [cue.at - 3, cue.at, cue.at + cue.durationInFrames, cue.at + cue.durationInFrames + 6], [0, 0.22, 0.22, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    duck = Math.max(duck, cueDuck);
  }
  return base * (1 - duck);
}

export function SoundDesign() {
  return (
    <>
      <Audio src={staticFile('v10/music.wav')} volume={musicVolume} />
      {CUES.map((cue, index) => (
        <Sequence key={`${cue.src}-${cue.at}-${index}`} from={cue.at} durationInFrames={cue.durationInFrames} layout="none" name={`SFX ${index + 1}`}>
          <Audio
            src={staticFile(`sfx/${cue.src}`)}
            volume={(frame) => interpolate(frame, [0, 2, Math.max(3, cue.durationInFrames - 4), cue.durationInFrames], [0, cue.gain, cue.gain * 0.5, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
          />
        </Sequence>
      ))}
    </>
  );
}
