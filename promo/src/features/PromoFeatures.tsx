import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import {
  CUTS,
  RAIL_INDEX,
  RELEASES,
  T,
  TOTAL,
  V,
  clamp,
  outQuint,
  ramp,
  type SceneKey,
} from "./style";
import { Glow, Grain, GridLines, Motes, PAD, Rail, Vignette } from "./ui";
import { Hook, Outro, RailCard, Score } from "./Bookends";
import { Agent, Canvas, Export, Templates, Video } from "./Act1";
import {
  CloudLink,
  Collab,
  Discover,
  Fonts,
  Languages,
  Panels,
  SaveAnywhere,
  Versions,
} from "./Act2";

const ACT2_FROM = T.RAIL[0];
const ACT2_TO = T.N_PANELS[1];

/**
 * The backdrop for the whole cut: two drifting light pools, a faint grid, dust,
 * vignette and grain. It warms from teal to gold across the turn, which is the
 * only palette move in the film, so the release act feels like a second half
 * rather than more of the first.
 */
const Backdrop: React.FC<{ frame: number }> = ({ frame }) => {
  const warm = ramp(frame, ACT2_FROM, 40, outQuint);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: V.bg }} />
      <AbsoluteFill style={{ opacity: 1 - warm }}>
        <Glow frame={frame} hue="teal" strength={1} />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: warm }}>
        <Glow frame={frame} hue="gold" strength={1.05} />
      </AbsoluteFill>
      <Motes frame={frame} count={26} />
      <GridLines opacity={0.4} size={80} />
      <Vignette strength={0.56} />
      <Grain frame={frame} opacity={0.035} />
    </AbsoluteFill>
  );
};

/**
 * A thin light bar that crosses the frame on every cut.
 *
 * Cheaper than a dissolve and it does more: the eye follows the sweep to the
 * new layout instead of hunting for what changed, which matters in a film that
 * changes layout sixteen times.
 */
const CutSweep: React.FC<{ frame: number }> = ({ frame }) => {
  const at = CUTS.find((cut) => frame >= cut && frame < cut + 12);
  if (at === undefined || at === 0) return null;
  const p = clamp((frame - at) / 12);
  const eased = outQuint(p);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${eased * 130 - 30}%`,
          width: "22%",
          background:
            "linear-gradient(90deg, rgba(212,175,55,0) 0%, rgba(212,175,55,0.16) 55%, rgba(255,255,255,0.30) 78%, rgba(212,175,55,0) 100%)",
          opacity: 1 - p * 0.35,
          filter: "blur(6px)",
        }}
      />
    </AbsoluteFill>
  );
};

/** The release rail, riding the whole second act under the beats. */
const ActRail: React.FC<{ frame: number }> = ({ frame }) => {
  if (frame < T.RAIL[1] || frame >= ACT2_TO) return null;
  const key = (Object.keys(RAIL_INDEX) as SceneKey[]).find(
    (name) => frame >= T[name][0] && frame < T[name][1]
  );
  const active = key ? (RAIL_INDEX[key] ?? -1) : -1;
  const opacity =
    ramp(frame, T.RAIL[1] - 30, 30, outQuint) * (1 - ramp(frame, ACT2_TO - 24, 24, outQuint));
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 54 }}>
      <Rail items={RELEASES} active={active} opacity={opacity} width={1920 - PAD * 2} />
    </AbsoluteFill>
  );
};

const Scene: React.FC<{
  span: readonly [number, number];
  children: (p: { local: number; len: number }) => React.ReactNode;
}> = ({ span, children }) => {
  const len = span[1] - span[0];
  return (
    <Sequence from={span[0]} durationInFrames={len} layout="none">
      <Inner len={len}>{children}</Inner>
    </Sequence>
  );
};

const Inner: React.FC<{
  len: number;
  children: (p: { local: number; len: number }) => React.ReactNode;
}> = ({ len, children }) => {
  const local = useCurrentFrame();
  return <>{children({ local, len })}</>;
};

export const PromoFeatures: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: V.bg }}>
      <Backdrop frame={frame} />

      <Scene span={T.HOOK}>{(p) => <Hook {...p} />}</Scene>
      <Scene span={T.A_TPL}>{(p) => <Templates {...p} />}</Scene>
      <Scene span={T.A_CANVAS}>{(p) => <Canvas {...p} />}</Scene>
      <Scene span={T.A_EXPORT}>{(p) => <Export {...p} />}</Scene>
      <Scene span={T.A_VIDEO}>{(p) => <Video {...p} />}</Scene>
      <Scene span={T.A_AGENT}>{(p) => <Agent {...p} />}</Scene>

      <Scene span={T.RAIL}>{(p) => <RailCard {...p} />}</Scene>
      <Scene span={T.N_LANG}>{(p) => <Languages {...p} />}</Scene>
      <Scene span={T.N_FONTS}>{(p) => <Fonts {...p} />}</Scene>
      <Scene span={T.N_SAVE}>{(p) => <SaveAnywhere {...p} />}</Scene>
      <Scene span={T.N_CLOUD}>{(p) => <CloudLink {...p} />}</Scene>
      <Scene span={T.N_VERSIONS}>{(p) => <Versions {...p} />}</Scene>
      <Scene span={T.N_COLLAB}>{(p) => <Collab {...p} />}</Scene>
      <Scene span={T.N_DISCOVER}>{(p) => <Discover {...p} />}</Scene>
      <Scene span={T.N_PANELS}>{(p) => <Panels {...p} />}</Scene>

      <Scene span={T.SCORE}>{(p) => <Score {...p} />}</Scene>
      <Scene span={T.OUTRO}>{(p) => <Outro {...p} />}</Scene>

      <ActRail frame={frame} />
      <CutSweep frame={frame} />

      {/* Out on black, so a loop or an autoplay embed does not snap back */}
      <AbsoluteFill
        style={{ background: "#000", opacity: ramp(frame, TOTAL - 16, 16, (t) => t) }}
      />

      <Audio
        src={staticFile("music-features.m4a")}
        volume={(f) =>
          Math.min(ramp(f, 0, 20, (t) => t), 1 - ramp(f, TOTAL - 48, 48, (t) => t))
        }
      />
    </AbsoluteFill>
  );
};

export { TOTAL as FEATURES_DURATION };
