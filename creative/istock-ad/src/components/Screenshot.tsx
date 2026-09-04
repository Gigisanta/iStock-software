import type { CSSProperties } from 'react';
import { Img, staticFile } from 'remotion';
import { COLORS, PHONE, TYPE } from '../theme';

type ScreenshotProps = {
  file: string;
  scroll?: number;
  opacity?: number;
  x?: number;
};

// Real app capture (1170 px wide, DPR 3) shown at CSS width so it stays crisp after the phone scale.
export function Screenshot({ file, scroll = 0, opacity = 1, x = 0 }: ScreenshotProps) {
  const frame: CSSProperties = {
    position: 'absolute',
    left: x,
    top: 0,
    width: PHONE.cssWidth,
    height: PHONE.cssHeight,
    overflow: 'hidden',
    background: COLORS.white,
    opacity,
  };
  const image: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: PHONE.statusHeight,
    width: PHONE.cssWidth,
    transform: `translate3d(0, ${-scroll}px, 0)`,
  };
  const status: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PHONE.cssWidth,
    height: PHONE.statusHeight,
    background: COLORS.white,
    zIndex: 1,
    fontFamily: TYPE.sans,
    fontSize: 16,
    fontWeight: 600,
    color: COLORS.ink,
    paddingLeft: 18,
    paddingTop: 18,
  };
  return (
    <div style={frame}>
      <Img src={staticFile(`v10/ui/${file}`)} style={image} />
      <div style={status}>23:52</div>
    </div>
  );
}
