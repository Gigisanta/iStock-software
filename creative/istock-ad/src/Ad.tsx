import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { cuesFor } from './ads/sound';
import { isDark, timeline, type AdSpec, type TimedScene } from './ads/spec';
import { SoundDesign } from './components/SoundDesign';
import { Wipe } from './components/Wipe';
import { Close } from './scenes/Close';
import { ChatHook, HeadlineHook } from './scenes/Hook';
import { Screen } from './scenes/Screen';
import { Upload } from './scenes/Upload';
import { WhatsApp } from './scenes/WhatsApp';
import { COLORS } from './theme';

const WIPE = 12;
// Phone scenes stay mounted a few frames past their end so the next one can slide over them.
const PHONE_TAIL = 4;

function SceneView({ frame, scene }: { frame: number; scene: TimedScene }) {
  switch (scene.kind) {
    case 'chat-hook':
      return <ChatHook frame={frame} scene={scene} />;
    case 'headline-hook':
      return <HeadlineHook frame={frame} scene={scene} />;
    case 'upload':
      return <Upload frame={frame} scene={scene} />;
    case 'screen':
      return <Screen frame={frame} scene={scene} />;
    case 'whatsapp':
      return <WhatsApp frame={frame} scene={scene} />;
    case 'close':
      return <Close frame={frame} scene={scene} />;
  }
}

// Builds any ad from its spec: scenes in order, a wipe at every dark/paper boundary,
// the soft accent glow behind the phone, and the derived sound design.
export function Ad({ spec }: { spec: AdSpec }) {
  const frame = useCurrentFrame();
  const { scenes, durationInFrames } = timeline(spec);
  const cues = cuesFor(scenes);
  const phoneOnScreen = scenes.some((scene) => !isDark(scene) && frame >= scene.start && frame < scene.end + PHONE_TAIL);
  return (
    <AbsoluteFill style={{ background: COLORS.paper }}>
      {phoneOnScreen ? (
        <div style={{ position: 'absolute', left: 90, top: 784, width: 900, height: 900, borderRadius: 450, background: COLORS.accentSoft, opacity: 0.55, filter: 'blur(90px)' }} />
      ) : null}
      {scenes.map((scene, index) => {
        const previous = index > 0 ? scenes[index - 1] : undefined;
        const boundary = previous !== undefined && isDark(previous) !== isDark(scene);
        const dark = isDark(scene);
        const visibleFrom = boundary ? scene.start - WIPE : scene.start;
        const visibleUntil = dark ? scene.end + (index === scenes.length - 1 ? 0 : WIPE) : scene.end + PHONE_TAIL;
        if (frame < visibleFrom || frame >= visibleUntil) return null;
        return (
          <div key={scene.index} style={{ position: 'absolute', inset: 0 }}>
            {boundary ? <Wipe frame={frame} at={scene.start - WIPE} color={dark ? COLORS.ink : COLORS.paper} length={WIPE} /> : null}
            {frame >= scene.start ? <SceneView frame={frame} scene={scene} /> : null}
          </div>
        );
      })}
      <SoundDesign music={spec.music} cues={cues} durationInFrames={durationInFrames} />
    </AbsoluteFill>
  );
}
