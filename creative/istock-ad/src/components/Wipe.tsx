import { ease } from '../motion';
import { VIDEO } from '../theme';

type WipeProps = {
  frame: number;
  at: number;
  color: string;
  length?: number;
};

// A single slab rises over the frame and settles as the next scene's background.
export function Wipe({ frame, at, color, length = 12 }: WipeProps) {
  const progress = ease(frame, at, at + length);
  if (frame < at) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: (1 - progress) * VIDEO.height,
        width: VIDEO.width,
        height: VIDEO.height,
        background: color,
      }}
    />
  );
}
