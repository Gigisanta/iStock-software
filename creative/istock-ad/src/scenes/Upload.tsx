import { Caption } from '../components/Caption';
import { FieldTap } from '../components/FieldTap';
import { Phone } from '../components/Phone';
import { Screenshot } from '../components/Screenshot';
import type { TimedScene } from '../ads/spec';
import { ease } from '../motion';

type UploadProps = { frame: number; scene: TimedScene & { kind: 'upload' } };

// Frame offsets, from the scene start, at which each field gets filled.
export const FORM_STEP_OFFSETS = [14, 27, 40, 53] as const;

// CSS px geometry of the form fields, measured by scripts/capture-v10.mjs (form-geom.json).
const FORM_STEPS = [
  { file: 'form-1.png', field: { x: 16, y: 245, w: 358, h: 46 } },
  { file: 'form-2.png', field: { x: 16, y: 377, w: 358, h: 46 } },
  { file: 'form-3.png', field: { x: 16, y: 589, w: 358, h: 46 } },
  { file: 'form-4.png', field: { x: 16, y: 681, w: 358, h: 50 } },
] as const;

export function Upload({ frame, scene }: UploadProps) {
  const { start, end, prev } = scene;
  const rise = prev ? 1 : ease(frame, start - 2, start + 18);
  const slide = prev ? ease(frame, start, start + 16) : 1;
  const previousX = -390 * slide;
  const steps = FORM_STEPS.map((step, index) => ({ ...step, at: start + FORM_STEP_OFFSETS[index] }));
  const currentIndex = steps.reduce((found, step, index) => (frame >= step.at ? index : found), -1);
  const current = currentIndex >= 0 ? steps[currentIndex] : undefined;
  const file = current?.file ?? 'form-0.png';
  return (
    <>
      <Caption frame={frame} start={start + 4} end={end + 4} kicker={scene.kicker} title={scene.title} />
      <Phone offsetY={(1 - rise) * 240}>
        {prev ? <Screenshot file={prev.file} x={previousX} opacity={1 - slide} scroll={prev.scroll} /> : null}
        <div style={{ position: 'absolute', left: prev ? 390 + previousX : 0, top: 0, width: 390, height: 844 }}>
          <Screenshot file={file} />
          {current ? <FieldTap frame={frame} at={current.at} field={current.field} /> : null}
        </div>
      </Phone>
    </>
  );
}
