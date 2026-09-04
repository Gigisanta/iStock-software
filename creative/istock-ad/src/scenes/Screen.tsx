import { Caption } from '../components/Caption';
import { FieldTap } from '../components/FieldTap';
import { Phone } from '../components/Phone';
import { Screenshot } from '../components/Screenshot';
import type { TimedScene } from '../ads/spec';
import { COLORS, PRODUCT, SAFE_ZONE, TYPE } from '../theme';
import { ease, glide, pop } from '../motion';

type ScreenProps = { frame: number; scene: TimedScene & { kind: 'screen' } };

// A real capture scrolling on the phone. Slides in from the previous shot, or rises if the phone is new.
export function Screen({ frame, scene }: ScreenProps) {
  const { start, end, prev } = scene;
  const rise = prev ? 1 : ease(frame, start - 2, start + 18);
  const slide = prev ? ease(frame, start, start + 16) : 1;
  const previousX = -390 * slide;
  const scroll = glide(frame, start + 22, end - 8, scene.scrollFrom ?? 0, scene.scrollTo);
  const link = pop(frame, start + 30, { damping: 18, stiffness: 150 });
  const linkLeave = 1 - ease(frame, end - 8, end);
  return (
    <>
      <Caption frame={frame} start={start + 2} end={end + 2} kicker={scene.kicker} title={scene.title} />
      {scene.host ? (
        <div
          style={{
            position: 'absolute',
            left: SAFE_ZONE.left,
            width: SAFE_ZONE.right - SAFE_ZONE.left,
            top: SAFE_ZONE.top + 250,
            textAlign: 'center',
            opacity: Math.min(1, link) * linkLeave,
            transform: `translate3d(0, ${(1 - link) * 16}px, 0)`,
          }}
        >
          <span style={{ display: 'inline-block', padding: '14px 28px', borderRadius: 999, background: COLORS.ink, color: COLORS.paper, fontFamily: TYPE.mono, fontSize: 32 }}>
            {PRODUCT.storeHost}
          </span>
        </div>
      ) : null}
      <Phone offsetY={(1 - rise) * 240}>
        {prev ? <Screenshot file={prev.file} x={previousX} opacity={1 - slide} scroll={prev.scroll} /> : null}
        <div style={{ position: 'absolute', left: prev ? 390 + previousX : 0, top: 0, width: 390, height: 844 }}>
          <Screenshot file={scene.file} scroll={scroll} />
          {scene.highlight ? (
            <FieldTap frame={frame} at={start + scene.highlight.at} field={{ ...scene.highlight.field, y: scene.highlight.field.y - scroll }} />
          ) : null}
        </div>
      </Phone>
    </>
  );
}
