import { Caption } from '../components/Caption';
import { Phone } from '../components/Phone';
import { Screenshot } from '../components/Screenshot';
import { BEATS } from '../theme';
import { ease, glide } from '../motion';

type DetailProps = { frame: number };

// The listing page answers every question from the hook: USD, ARS, battery, warranty, pickup.
export function Detail({ frame }: DetailProps) {
  const start = BEATS.storefrontEnd;
  const end = BEATS.detailEnd;
  const slide = ease(frame, start, start + 16);
  const previousX = -390 * slide;
  const scroll = glide(frame, start + 34, end - 10, 0, 760);
  return (
    <>
      <Caption frame={frame} start={start + 2} end={end + 2} kicker="3" title="Dólares, pesos, batería, garantía. Todo dicho." />
      <Phone>
        <Screenshot file="storefront.png" x={previousX} opacity={1 - slide} scroll={1180} />
        <Screenshot file="detail.png" x={390 + previousX} scroll={scroll} />
      </Phone>
    </>
  );
}
