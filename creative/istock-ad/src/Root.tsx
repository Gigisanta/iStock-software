import { Composition } from 'remotion';
import { Ad } from './Ad';
import { ADS } from './ads';
import { timeline } from './ads/spec';
import { VIDEO } from './theme';

export function RemotionRoot() {
  return (
    <>
      {ADS.map((spec) => (
        <Composition
          key={spec.id}
          id={spec.id}
          component={Ad}
          defaultProps={{ spec }}
          durationInFrames={timeline(spec).durationInFrames}
          fps={VIDEO.fps}
          width={VIDEO.width}
          height={VIDEO.height}
        />
      ))}
    </>
  );
}
