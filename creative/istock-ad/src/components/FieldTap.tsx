import type { CSSProperties } from 'react';
import { COLORS, PHONE } from '../theme';
import type { Field } from '../ads/spec';
import { ease, pop } from '../motion';

type FieldTapProps = { frame: number; at: number; field: Field };

// A fingertip dot and an accent ring around a form field, in phone CSS px (below the status bar).
export function FieldTap({ frame, at, field }: FieldTapProps) {
  if (frame < at - 3) return null;
  const ringSpring = pop(frame, at, { damping: 13, stiffness: 200 });
  const ringLife = 1 - ease(frame, at + 10, at + 16);
  const tapSpring = pop(frame, at - 3, { damping: 12, stiffness: 240 });
  const tapLife = 1 - ease(frame, at + 4, at + 9);
  const ring: CSSProperties = {
    position: 'absolute',
    left: field.x - 5,
    top: field.y + PHONE.statusHeight - 5,
    width: field.w + 10,
    height: field.h + 10,
    borderRadius: 14,
    border: `3px solid ${COLORS.accent}`,
    opacity: ringLife * Math.min(1, ringSpring),
    transform: `scale(${0.96 + ringSpring * 0.04})`,
  };
  const tap: CSSProperties = {
    position: 'absolute',
    left: field.x + field.w * 0.5 - 22,
    top: field.y + PHONE.statusHeight + field.h * 0.5 - 22,
    width: 44,
    height: 44,
    borderRadius: 22,
    background: COLORS.ink,
    opacity: 0.22 * tapLife,
    transform: `scale(${tapSpring})`,
  };
  return (
    <>
      <div style={ring} />
      <div style={tap} />
    </>
  );
}
