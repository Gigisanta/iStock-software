import { Composition } from 'remotion';
import { Reel } from './Reel';
import { VIDEO } from './theme';

export function RemotionRoot() {
  return (
    <Composition
      id="IstockReelV10"
      component={Reel}
      durationInFrames={VIDEO.durationInFrames}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
  );
}
