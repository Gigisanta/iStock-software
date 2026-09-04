import type { CSSProperties, ReactNode } from 'react';
import { COLORS, PHONE } from '../theme';

type PhoneProps = {
  children: ReactNode;
  offsetY?: number;
  opacity?: number;
};

// A flat, quiet device frame. Content is authored in CSS px (390x844) and scaled once.
export function Phone({ children, offsetY = 0, opacity = 1 }: PhoneProps) {
  const width = PHONE.cssWidth * PHONE.scale;
  const height = PHONE.cssHeight * PHONE.scale;
  const shell: CSSProperties = {
    position: 'absolute',
    left: PHONE.left - PHONE.bezel,
    top: PHONE.top - PHONE.bezel + offsetY,
    width: width + PHONE.bezel * 2,
    height: height + PHONE.bezel * 2,
    borderRadius: PHONE.screenRadius + PHONE.bezel,
    background: COLORS.ink,
    boxShadow: '0 40px 90px rgba(17, 21, 19, 0.28), 0 6px 18px rgba(17, 21, 19, 0.16)',
    opacity,
  };
  const screen: CSSProperties = {
    position: 'absolute',
    left: PHONE.bezel,
    top: PHONE.bezel,
    width,
    height,
    borderRadius: PHONE.screenRadius,
    overflow: 'hidden',
    background: COLORS.white,
  };
  const island: CSSProperties = {
    position: 'absolute',
    left: (PHONE.cssWidth - 124) / 2,
    top: 12,
    width: 124,
    height: 36,
    borderRadius: 18,
    background: COLORS.ink,
    zIndex: 2,
  };
  return (
    <div style={shell} aria-hidden="true">
      <div style={screen}>
        <div style={{ width: PHONE.cssWidth, height: PHONE.cssHeight, transform: `scale(${PHONE.scale})`, transformOrigin: 'top left', position: 'relative' }}>
          {children}
          <div style={island} />
        </div>
      </div>
    </div>
  );
}
