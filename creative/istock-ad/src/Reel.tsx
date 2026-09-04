import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { SoundDesign } from './components/SoundDesign';
import { Wipe } from './components/Wipe';
import { Close } from './scenes/Close';
import { Detail } from './scenes/Detail';
import { Hook } from './scenes/Hook';
import { Storefront } from './scenes/Storefront';
import { Upload } from './scenes/Upload';
import { WhatsApp } from './scenes/WhatsApp';
import { BEATS, COLORS } from './theme';

const WIPE = 12;

// Six beats, one phone, the real app. Scene modules own their timing through BEATS.
export function Reel() {
  const frame = useCurrentFrame();
  const inHook = frame < BEATS.hookEnd;
  const inPaper = frame >= BEATS.hookEnd - WIPE && frame < BEATS.whatsappEnd + WIPE;
  const inClose = frame >= BEATS.whatsappEnd - WIPE;
  return (
    <AbsoluteFill style={{ background: COLORS.paper }}>
      {inHook ? <Hook frame={frame} /> : null}
      {inPaper ? (
        <>
          <Wipe frame={frame} at={BEATS.hookEnd - WIPE} color={COLORS.paper} length={WIPE} />
          {frame >= BEATS.hookEnd ? (
            <div style={{ position: 'absolute', left: 90, top: 760, width: 900, height: 900, borderRadius: 450, background: COLORS.accentSoft, opacity: 0.55, filter: 'blur(90px)' }} />
          ) : null}
          {frame >= BEATS.hookEnd - WIPE && frame < BEATS.uploadEnd + 4 ? <Upload frame={frame} /> : null}
          {frame >= BEATS.uploadEnd && frame < BEATS.storefrontEnd + 4 ? <Storefront frame={frame} /> : null}
          {frame >= BEATS.storefrontEnd && frame < BEATS.detailEnd + 4 ? <Detail frame={frame} /> : null}
          {frame >= BEATS.detailEnd && frame < BEATS.whatsappEnd + WIPE ? <WhatsApp frame={frame} /> : null}
        </>
      ) : null}
      {inClose ? (
        <>
          <Wipe frame={frame} at={BEATS.whatsappEnd - WIPE} color={COLORS.ink} length={WIPE} />
          {frame >= BEATS.whatsappEnd ? <Close frame={frame} /> : null}
        </>
      ) : null}
      <SoundDesign />
    </AbsoluteFill>
  );
}
