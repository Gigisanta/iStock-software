import type { CSSProperties } from 'react';
import { COLORS, SAFE_ZONE, TYPE, BEATS } from '../theme';
import { ease, pop } from '../motion';

type HookProps = { frame: number };

export const HOOK_MESSAGES = [
  { text: '¿Tenés el 14 Pro?', time: '22:41', at: 2 },
  { text: '¿Precio?', time: '22:58', at: 9 },
  { text: '¿Y en pesos cuánto es?', time: '23:07', at: 16 },
  { text: '¿Cuánto de batería tiene?', time: '23:20', at: 23 },
  { text: '¿Me pasás fotos?', time: '23:31', at: 30 },
  { text: '¿Sigue disponible?', time: '23:52', at: 37 },
] as const;

const ROW = 118;

// Six questions that every reseller answers by hand, every night.
export function Hook({ frame }: HookProps) {
  const bg: CSSProperties = { position: 'absolute', inset: 0, background: COLORS.ink, fontFamily: TYPE.sans };
  const headline = ease(frame, 42, 56);
  const exit = 1 - ease(frame, BEATS.hookEnd - 4, BEATS.hookEnd + 6);
  return (
    <div style={bg}>
      <div style={{ position: 'absolute', left: SAFE_ZONE.left + 35, top: SAFE_ZONE.top + 40, width: 880, opacity: exit }}>
        {HOOK_MESSAGES.map((message, index) => {
          const s = pop(frame, message.at, { damping: 14, stiffness: 190 });
          const shift = index * ROW;
          return (
            <div
              key={message.text}
              style={{
                position: 'absolute',
                left: 0,
                top: shift,
                transform: `translate3d(${(1 - s) * -40}px, ${(1 - s) * 24}px, 0) scale(${0.85 + s * 0.15})`,
                transformOrigin: 'left bottom',
                opacity: Math.min(1, s * 1.4),
                display: 'flex',
                alignItems: 'flex-end',
                gap: 18,
              }}
            >
              <div
                style={{
                  background: COLORS.bubble,
                  color: COLORS.white,
                  fontSize: 46,
                  lineHeight: 1.2,
                  padding: '20px 34px',
                  borderRadius: 34,
                  borderBottomLeftRadius: 8,
                  maxWidth: 700,
                }}
              >
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
          left: SAFE_ZONE.left + 35,
          top: SAFE_ZONE.top + 40 + HOOK_MESSAGES.length * ROW + 70,
          width: 880,
          color: COLORS.paper,
          fontSize: 92,
          lineHeight: 1.04,
          fontWeight: 700,
          letterSpacing: '-0.03em',
          opacity: headline * exit,
          transform: `translate3d(0, ${(1 - headline) * 30}px, 0)`,
        }}
      >
        Todas las noches,
        <br />
        lo mismo.
      </div>
    </div>
  );
}
