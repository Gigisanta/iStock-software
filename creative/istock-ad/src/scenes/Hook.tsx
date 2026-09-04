import type { CSSProperties } from 'react';
import type { TimedScene } from '../ads/spec';
import { COLORS, SAFE_ZONE, TYPE } from '../theme';
import { ease, pop } from '../motion';

const ROW = 118;
// The bubble stack is centred as a block; bubbles stay left-aligned like a real chat.
const STACK_WIDTH = 720;
const STACK_LEFT = (1080 - STACK_WIDTH) / 2;

type ChatHookProps = { frame: number; scene: TimedScene & { kind: 'chat-hook' } };

// Questions every reseller answers by hand, every night, then the headline.
export function ChatHook({ frame, scene }: ChatHookProps) {
  const { start, end } = scene;
  const bg: CSSProperties = { position: 'absolute', inset: 0, background: COLORS.ink, fontFamily: TYPE.sans };
  const headline = ease(frame, start + scene.headlineAt, start + scene.headlineAt + 14);
  const exit = 1 - ease(frame, end - 4, end + 6);
  return (
    <div style={bg}>
      <div style={{ position: 'absolute', left: STACK_LEFT, top: SAFE_ZONE.top + 40, width: STACK_WIDTH, opacity: exit }}>
        {scene.messages.map((message, index) => {
          const s = pop(frame, start + message.at, { damping: 14, stiffness: 190 });
          return (
            <div
              key={message.text}
              style={{
                position: 'absolute',
                left: 0,
                top: index * ROW,
                transform: `translate3d(${(1 - s) * -40}px, ${(1 - s) * 24}px, 0) scale(${0.85 + s * 0.15})`,
                transformOrigin: 'left bottom',
                opacity: Math.min(1, s * 1.4),
                display: 'flex',
                alignItems: 'flex-end',
                gap: 18,
              }}
            >
              <div style={{ background: COLORS.bubble, color: COLORS.white, fontSize: 46, lineHeight: 1.2, padding: '20px 34px', borderRadius: 34, borderBottomLeftRadius: 8, maxWidth: 700 }}>
                {message.text}
              </div>
              <div style={{ color: COLORS.muted, fontSize: 24, fontFamily: TYPE.mono, paddingBottom: 12 }}>{message.time}</div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: 'absolute',
          left: SAFE_ZONE.left,
          top: SAFE_ZONE.top + 40 + scene.messages.length * ROW + 70,
          width: SAFE_ZONE.right - SAFE_ZONE.left,
          textAlign: 'center',
          color: COLORS.paper,
          fontSize: 92,
          lineHeight: 1.04,
          fontWeight: 700,
          letterSpacing: '-0.03em',
          opacity: headline * exit,
          transform: `translate3d(0, ${(1 - headline) * 30}px, 0)`,
        }}
      >
        {scene.headline.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
  );
}

type HeadlineHookProps = { frame: number; scene: TimedScene & { kind: 'headline-hook' } };

// Two or three big lines landing one after the other, centred in the safe zone.
export function HeadlineHook({ frame, scene }: HeadlineHookProps) {
  const { start, end } = scene;
  const exit = 1 - ease(frame, end - 4, end + 6);
  const sub = ease(frame, start + 6 + scene.lines.length * 8 + 4, start + 6 + scene.lines.length * 8 + 18);
  const lineHeight = 118;
  const blockHeight = scene.lines.length * lineHeight + (scene.sub ? 90 : 0);
  const top = SAFE_ZONE.top + (SAFE_ZONE.bottom - SAFE_ZONE.top - blockHeight) / 2;
  return (
    <div style={{ position: 'absolute', inset: 0, background: COLORS.ink, fontFamily: TYPE.sans, color: COLORS.paper, opacity: exit }}>
      <div style={{ position: 'absolute', left: SAFE_ZONE.left, width: SAFE_ZONE.right - SAFE_ZONE.left, top, textAlign: 'center' }}>
        {scene.lines.map((line, index) => {
          const s = pop(frame, start + 6 + index * 8, { damping: 15, stiffness: 160 });
          return (
            <div key={line} style={{ fontSize: 108, lineHeight: `${lineHeight}px`, fontWeight: 700, letterSpacing: '-0.035em', opacity: Math.min(1, s * 1.3), transform: `translate3d(0, ${(1 - s) * 40}px, 0)` }}>
              {line}
            </div>
          );
        })}
        {scene.sub ? (
          <div style={{ marginTop: 34, fontSize: 40, fontWeight: 500, color: COLORS.muted, opacity: sub, transform: `translate3d(0, ${(1 - sub) * 16}px, 0)` }}>{scene.sub}</div>
        ) : null}
      </div>
    </div>
  );
}
