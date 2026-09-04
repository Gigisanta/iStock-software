import { Img, staticFile } from 'remotion';
import { BEATS, COLORS, PRODUCT, SAFE_ZONE, TYPE } from '../theme';
import { ease, pop } from '../motion';

type CloseProps = { frame: number };

// Brand lockup and the only call to action: the trial and the URL.
export function Close({ frame }: CloseProps) {
  const start = BEATS.whatsappEnd;
  const mark = pop(frame, start + 8, { damping: 16, stiffness: 140 });
  const word = ease(frame, start + 12, start + 30);
  const tagline = ease(frame, start + 26, start + 44);
  const cta = pop(frame, start + 38, { damping: 17, stiffness: 150 });
  const footer = ease(frame, start + 50, start + 66);
  const fadeOut = 1 - ease(frame, BEATS.end - 12, BEATS.end);
  const left = SAFE_ZONE.left + 35;
  return (
    <div style={{ position: 'absolute', inset: 0, background: COLORS.ink, fontFamily: TYPE.sans, color: COLORS.paper, opacity: fadeOut }}>
      <div style={{ position: 'absolute', left, top: 420, display: 'flex', alignItems: 'center', gap: 34 }}>
        <Img src={staticFile('istock-mark.svg')} style={{ width: 150, height: 150, transform: `scale(${mark})`, transformOrigin: 'center' }} />
        <div style={{ fontSize: 170, fontWeight: 700, letterSpacing: '-0.05em', lineHeight: 1, opacity: word, transform: `translate3d(${(1 - word) * -20}px, 0, 0)` }}>iStock</div>
      </div>
      <div style={{ position: 'absolute', left, top: 690, width: 880, fontSize: 62, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, opacity: tagline, transform: `translate3d(0, ${(1 - tagline) * 24}px, 0)` }}>
        Tu stock en un link.
        <br />
        Probalo 14 días gratis.
      </div>
      <div
        style={{
          position: 'absolute',
          left,
          top: 960,
          padding: '26px 48px',
          borderRadius: 999,
          background: COLORS.accentSoft,
          color: COLORS.ink,
          fontSize: 56,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          opacity: Math.min(1, cta),
          transform: `scale(${0.9 + cta * 0.1})`,
          transformOrigin: 'left center',
        }}
      >
        {PRODUCT.appHost}
      </div>
      <div style={{ position: 'absolute', left, top: 1150, fontSize: 30, color: COLORS.muted, opacity: footer }}>Producto de MaatWork</div>
    </div>
  );
}
