import type { CSSProperties } from 'react';
import { Caption } from '../components/Caption';
import { Phone } from '../components/Phone';
import { Screenshot } from '../components/Screenshot';
import type { TimedScene } from '../ads/spec';
import { COLORS, PRODUCT, TYPE } from '../theme';
import { ease, pop } from '../motion';

type WhatsAppProps = { frame: number; scene: TimedScene & { kind: 'whatsapp' } };

// Frame offsets from the scene start: message appears, send is tapped, bubble lands.
export const WA_OFFSETS = { text: 18, send: 58, bubble: 62 } as const;

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

function Keyboard() {
  return (
    <div style={{ position: 'absolute', left: 0, top: 590, width: 390, height: 254, background: COLORS.waKeyboard, paddingTop: 10 }}>
      {KEY_ROWS.map((row, rowIndex) => (
        <div key={row} style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 10, paddingLeft: rowIndex * 14 }}>
          {row.split('').map((key) => (
            <div key={key} style={{ width: 33, height: 42, borderRadius: 6, background: COLORS.waKey, boxShadow: '0 1px 0 rgba(0,0,0,0.25)', fontSize: 22, textAlign: 'center', lineHeight: '42px' }}>
              {key}
            </div>
          ))}
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
        <div style={{ width: 90, height: 42, borderRadius: 6, background: '#adb3bc', fontSize: 15, textAlign: 'center', lineHeight: '42px' }}>123</div>
        <div style={{ width: 186, height: 42, borderRadius: 6, background: COLORS.waKey, fontSize: 15, textAlign: 'center', lineHeight: '42px' }}>espacio</div>
        <div style={{ width: 90, height: 42, borderRadius: 6, background: '#adb3bc', fontSize: 15, textAlign: 'center', lineHeight: '42px' }}>intro</div>
      </div>
    </div>
  );
}

// A WhatsApp-style chat, drawn by hand: wa.me opens with the product message already written.
export function WhatsApp({ frame, scene }: WhatsAppProps) {
  const { start, end, prev } = scene;
  const rise = prev ? 1 : ease(frame, start - 2, start + 18);
  const slide = prev ? ease(frame, start, start + 16) : 1;
  const previousX = -390 * slide;
  const textAt = start + WA_OFFSETS.text;
  const sendAt = start + WA_OFFSETS.send;
  const bubbleAt = start + WA_OFFSETS.bubble;
  const text = pop(frame, textAt, { damping: 15, stiffness: 180 });
  const sent = frame >= bubbleAt;
  const bubble = pop(frame, bubbleAt, { damping: 14, stiffness: 170 });
  const sendTap = pop(frame, sendAt, { damping: 12, stiffness: 240 });
  const sendTapLife = 1 - ease(frame, sendAt + 5, sendAt + 10);
  const screen: CSSProperties = {
    position: 'absolute',
    left: prev ? 390 + previousX : 0,
    top: 0,
    width: 390,
    height: 844,
    background: COLORS.waWall,
    fontFamily: TYPE.sans,
    color: COLORS.ink,
    overflow: 'hidden',
  };
  return (
    <>
      <Caption frame={frame} start={start + 2} end={end + 2} kicker={scene.kicker} title={scene.title} />
      <Phone offsetY={(1 - rise) * 240}>
        {prev ? <Screenshot file={prev.file} x={previousX} opacity={1 - slide} scroll={prev.scroll} /> : null}
        <div style={screen}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: 390, height: 108, background: COLORS.waHeader, borderBottom: '1px solid #d9d9d9' }}>
            <div style={{ position: 'absolute', left: 18, top: 18, fontSize: 16, fontWeight: 600 }}>23:52</div>
            <div style={{ position: 'absolute', left: 14, top: 62, fontSize: 24, color: '#0a7cff' }}>‹</div>
            <div style={{ position: 'absolute', left: 44, top: 56, width: 40, height: 40, borderRadius: 20, background: COLORS.accent, color: COLORS.white, fontSize: 15, fontWeight: 700, textAlign: 'center', lineHeight: '40px' }}>AV</div>
            <div style={{ position: 'absolute', left: 96, top: 56, fontSize: 17, fontWeight: 600 }}>{PRODUCT.storeName}</div>
            <div style={{ position: 'absolute', left: 96, top: 78, fontSize: 13, color: COLORS.mutedInk }}>en línea</div>
          </div>
          <div style={{ position: 'absolute', left: 0, top: 122, width: 390, textAlign: 'center' }}>
            <span style={{ background: '#fdfdfd', borderRadius: 8, padding: '4px 10px', fontSize: 12, color: COLORS.mutedInk, boxShadow: '0 1px 0 rgba(0,0,0,0.08)' }}>Hoy</span>
          </div>
          {sent ? (
            <div
              style={{
                position: 'absolute',
                right: 12,
                bottom: 324,
                maxWidth: 300,
                background: COLORS.waOut,
                borderRadius: 12,
                borderTopRightRadius: 2,
                padding: '8px 10px 8px 10px',
                fontSize: 15,
                lineHeight: 1.3,
                boxShadow: '0 1px 0 rgba(0,0,0,0.08)',
                transform: `translate3d(0, ${(1 - bubble) * 40}px, 0) scale(${0.9 + bubble * 0.1})`,
                transformOrigin: 'right bottom',
                opacity: Math.min(1, bubble * 1.5),
              }}
            >
              {PRODUCT.waText}
              <div style={{ textAlign: 'right', fontSize: 11, color: COLORS.mutedInk, marginTop: 4 }}>23:52 ✓✓</div>
            </div>
          ) : null}
          <div style={{ position: 'absolute', left: 0, bottom: 254, width: 390, background: COLORS.waHeader, borderTop: '1px solid #d9d9d9', padding: '8px 64px 8px 12px', boxSizing: 'border-box' }}>
            <div style={{ minHeight: 24, borderRadius: 20, background: COLORS.white, border: '1px solid #d9d9d9', padding: '8px 14px', fontSize: 14, lineHeight: 1.3, color: COLORS.ink }}>
              {sent ? <span style={{ color: '#9a9a9a' }}>Mensaje</span> : (
                <span style={{ display: 'inline-block', opacity: Math.min(1, text * 1.3), transform: `translate3d(0, ${(1 - text) * 8}px, 0)` }}>{PRODUCT.waText}</span>
              )}
            </div>
            <div style={{ position: 'absolute', right: 12, bottom: 9, width: 40, height: 40, borderRadius: 20, background: COLORS.waGreen, color: COLORS.white, textAlign: 'center', lineHeight: '40px', fontSize: 18 }}>➤</div>
            <div style={{ position: 'absolute', right: 6, bottom: 3, width: 52, height: 52, borderRadius: 26, background: COLORS.ink, opacity: 0.2 * sendTapLife, transform: `scale(${sendTap})` }} />
          </div>
          <Keyboard />
        </div>
      </Phone>
    </>
  );
}
