import { Audio } from '@remotion/media';
import { interpolate, Sequence, staticFile } from 'remotion';
import type { SoundCue } from '../ads/sound';

type SoundDesignProps = { music: string; cues: readonly SoundCue[]; durationInFrames: number };

// Music bed with a short fade in and out, ducked under every cue.
export function SoundDesign({ music, cues, durationInFrames }: SoundDesignProps) {
  const musicVolume = (frame: number) => {
    const base = interpolate(frame, [0, 12, durationInFrames - 24, durationInFrames], [0, 0.9, 0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    let duck = 0;
    for (const cue of cues) {
      const cueDuck = interpolate(frame, [cue.at - 3, cue.at, cue.at + cue.durationInFrames, cue.at + cue.durationInFrames + 6], [0, 0.22, 0.22, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
      duck = Math.max(duck, cueDuck);
    }
    return base * (1 - duck);
  };
  return (
    <>
      <Audio src={staticFile(`music/${music}.wav`)} volume={musicVolume} />
      {cues.map((cue, index) => (
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
