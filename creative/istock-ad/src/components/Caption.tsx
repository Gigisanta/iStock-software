import type { CSSProperties } from 'react';
import { COLORS, SAFE_ZONE, TYPE } from '../theme';
import { ease } from '../motion';

type CaptionProps = {
  frame: number;
  start: number;
  end: number;
  title: string;
  kicker?: string;
  tone?: 'ink' | 'paper';
};

// Scene headline, pinned to the top of the safe zone.
export function Caption({ frame, start, end, title, kicker, tone = 'ink' }: CaptionProps) {
  const enter = ease(frame, start, start + 16);
  const leave = 1 - ease(frame, end - 8, end);
  const opacity = Math.min(enter, leave);
  const y = (1 - enter) * 28 - (1 - leave) * 18;
  const color = tone === 'ink' ? COLORS.ink : COLORS.paper;
  const kickerColor = tone === 'ink' ? COLORS.accent : COLORS.accentSoft;
  const wrap: CSSProperties = {
    position: 'absolute',
    left: SAFE_ZONE.left + 35,
    top: SAFE_ZONE.top + 30,
    width: SAFE_ZONE.right - SAFE_ZONE.left - 70,
    opacity,
    transform: `translate3d(0, ${y}px, 0)`,
    fontFamily: TYPE.sans,
    color,
  };
  return (
    <div style={wrap}>
      {kicker ? (
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '0.02em', color: kickerColor, marginBottom: 18 }}>{kicker}</div>
      ) : null}
      <div style={{ fontSize: 68, lineHeight: 1.06, fontWeight: 700, letterSpacing: '-0.025em' }}>{title}</div>
    </div>
  );
}
