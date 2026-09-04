import { Caption } from '../components/Caption';
import { Phone } from '../components/Phone';
import { Screenshot } from '../components/Screenshot';
import { BEATS, COLORS, PRODUCT, SAFE_ZONE, TYPE } from '../theme';
import { ease, glide, pop } from '../motion';

type StorefrontProps = { frame: number };

// The published storefront scrolls: the same unit is now a card with photo, condition and price.
export function Storefront({ frame }: StorefrontProps) {
  const start = BEATS.uploadEnd;
  const end = BEATS.storefrontEnd;
  const slide = ease(frame, start, start + 16);
  const previousX = -390 * slide;
  const scroll = glide(frame, start + 22, end - 8, 0, 1180);
  const link = pop(frame, start + 30, { damping: 18, stiffness: 150 });
  const linkLeave = 1 - ease(frame, end - 8, end);
  return (
    <>
      <Caption frame={frame} start={start + 2} end={end + 2} kicker="2" title="Queda en tu vidriera, con tu link." />
      <div
        style={{
          position: 'absolute',
          left: SAFE_ZONE.left + 35,
          top: SAFE_ZONE.top + 250,
          padding: '14px 28px',
          borderRadius: 999,
          background: COLORS.ink,
          color: COLORS.paper,
          fontFamily: TYPE.mono,
          fontSize: 32,
          opacity: Math.min(1, link) * linkLeave,
          transform: `translate3d(0, ${(1 - link) * 16}px, 0)`,
        }}
      >
        {PRODUCT.storeHost}
      </div>
      <Phone>
        <Screenshot file="form-4.png" x={previousX} opacity={1 - slide} />
        <Screenshot file="storefront.png" x={390 + previousX} scroll={scroll} />
      </Phone>
    </>
  );
}
