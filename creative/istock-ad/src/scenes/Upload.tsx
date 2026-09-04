import type { CSSProperties } from 'react';
import { Caption } from '../components/Caption';
import { Phone } from '../components/Phone';
import { Screenshot } from '../components/Screenshot';
import { BEATS, COLORS, PHONE } from '../theme';
import { ease, pop } from '../motion';

type UploadProps = { frame: number };

// CSS px geometry of the form fields, measured by scripts/capture-v10.mjs (form-geom.json).
export const FORM_STEPS = [
  { file: 'form-1.png', at: BEATS.hookEnd + 14, field: { x: 16, y: 245, w: 358, h: 46 } },
  { file: 'form-2.png', at: BEATS.hookEnd + 27, field: { x: 16, y: 377, w: 358, h: 46 } },
  { file: 'form-3.png', at: BEATS.hookEnd + 40, field: { x: 16, y: 589, w: 358, h: 46 } },
  { file: 'form-4.png', at: BEATS.hookEnd + 53, field: { x: 16, y: 681, w: 358, h: 50 } },
] as const;

export function Upload({ frame }: UploadProps) {
  const start = BEATS.hookEnd;
  const end = BEATS.uploadEnd;
  const rise = ease(frame, start - 2, start + 18);
  const current = [...FORM_STEPS].reverse().find((step) => frame >= step.at);
  const file = current?.file ?? 'form-0.png';
  const ring: CSSProperties | null = current
    ? (() => {
        const s = pop(frame, current.at, { damping: 13, stiffness: 200 });
        const life = 1 - ease(frame, current.at + 10, current.at + 16);
        const f = current.field;
        return {
          position: 'absolute',
          left: f.x - 5,
          top: f.y + PHONE.statusHeight - 5,
          width: f.w + 10,
          height: f.h + 10,
          borderRadius: 14,
          border: `3px solid ${COLORS.accent}`,
          opacity: life * Math.min(1, s),
          transform: `scale(${0.96 + s * 0.04})`,
        };
      })()
    : null;
  const tap: CSSProperties | null = current
    ? (() => {
        const s = pop(frame, current.at - 3, { damping: 12, stiffness: 240 });
        const life = 1 - ease(frame, current.at + 4, current.at + 9);
        const f = current.field;
        return {
          position: 'absolute',
          left: f.x + f.w * 0.5 - 22,
          top: f.y + PHONE.statusHeight + f.h * 0.5 - 22,
          width: 44,
          height: 44,
          borderRadius: 22,
          background: COLORS.ink,
          opacity: 0.22 * life,
          transform: `scale(${s})`,
        };
      })()
    : null;
  return (
    <>
      <Caption frame={frame} start={start + 4} end={end + 4} kicker="1" title="Cargá el equipo una vez." />
      <Phone offsetY={(1 - rise) * 240}>
        <Screenshot file={file} />
        {ring ? <div style={ring} /> : null}
        {tap ? <div style={tap} /> : null}
      </Phone>
    </>
  );
}
