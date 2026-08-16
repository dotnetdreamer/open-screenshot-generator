import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { NEW_BEATS, T, TOTAL, V, clamp, ramp, outQuint } from "./style";
import { Grain, GridLines, Glow, Motes, OldGrade, OldHud, Vignette } from "./ui";
import { Hook, Outro, Turn } from "./Bookends";
import { OldLangs, OldPay, OldSizes, OldTool } from "./OldScenes";
import {
  NewAgent,
  NewCanvas,
  NewExport,
  NewLangs,
  NewPrivate,
  NewTemplates,
  NewVideo,
} from "./NewScenes";

const OLD_FROM = T.OLD_TOOL[0];
const OLD_TO = T.OLD_PAY[1];

/**
 * Backdrop for the whole cut. `newness` crosses 0 -> 1 across the turn, which
 * is the only place the palette changes: the old act is a grey drafting table,
 * the new act is the site's warm gold and teal.
 */
const Backdrop: React.FC<{ frame: number }> = ({ frame }) => {
  const newness = ramp(frame, T.TURN[0], 34, outQuint);
  const old = 1 - newness;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: V.bg }} />
      <AbsoluteFill style={{ background: V.old.bg, opacity: old }} />
      <AbsoluteFill style={{ opacity: newness }}>
        <Glow frame={frame} hue="teal" strength={1} />
        <Motes frame={frame} count={30} />
      </AbsoluteFill>
      <GridLines opacity={0.35 + old * 0.55} size={72} />
      <Vignette strength={0.5 + old * 0.2} />
      <Grain frame={frame} opacity={0.03 + old * 0.05} />
    </AbsoluteFill>
  );
};

/** Cuts to near-black for 3 frames on the turn, so the change of act lands. */
const TurnFlash: React.FC<{ frame: number }> = ({ frame }) => {
  const d = frame - T.TURN[0];
  if (d < -2 || d > 8) return null;
  const o = d < 0 ? 1 : 1 - clamp(d / 8);
  return <AbsoluteFill style={{ background: "#000", opacity: o * 0.92 }} />;
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

export const PromoVs: React.FC = () => {
  const frame = useCurrentFrame();
  const inOldAct = frame >= OLD_FROM && frame < T.TURN[0];

  return (
    <AbsoluteFill style={{ background: V.bg }}>
      <Backdrop frame={frame} />

      {/* Old act, under the drained grade */}
      <OldGrade amount={inOldAct ? 1 : 0}>
        <Scene span={T.HOOK}>{(p) => <Hook {...p} />}</Scene>
        <Scene span={T.OLD_TOOL}>{(p) => <OldTool {...p} />}</Scene>
        <Scene span={T.OLD_SIZES}>{(p) => <OldSizes {...p} />}</Scene>
        <Scene span={T.OLD_LANGS}>{(p) => <OldLangs {...p} />}</Scene>
        <Scene span={T.OLD_PAY}>{(p) => <OldPay {...p} />}</Scene>
      </OldGrade>

      {inOldAct && (
        <OldHud
          frame={frame}
          from={OLD_FROM}
          to={OLD_TO}
          files={[0, 960]}
          hours={[0.2, 11.5]}
          opacity={ramp(frame, OLD_FROM, 20) * (1 - ramp(frame, OLD_TO - 16, 16))}
        />
      )}

      {/* New act */}
      <Scene span={T.TURN}>{(p) => <Turn {...p} />}</Scene>
      <Scene span={T.N_TPL}>{(p) => <NewTemplates {...p} />}</Scene>
      <Scene span={T.N_CANVAS}>{(p) => <NewCanvas {...p} />}</Scene>
      <Scene span={T.N_EXPORT}>{(p) => <NewExport {...p} />}</Scene>
      <Scene span={T.N_LANGS}>{(p) => <NewLangs {...p} />}</Scene>
      <Scene span={T.N_VIDEO}>{(p) => <NewVideo {...p} />}</Scene>
      <Scene span={T.N_AGENT}>{(p) => <NewAgent {...p} />}</Scene>
      <Scene span={T.N_PRIV}>{(p) => <NewPrivate {...p} />}</Scene>
      <Scene span={T.OUTRO}>{(p) => <Outro {...p} />}</Scene>

      <TurnFlash frame={frame} />

      <Audio src={staticFile("music-vs.m4a")} volume={(f) =>
        Math.min(
          ramp(f, 0, 24, (t) => t),
          1 - ramp(f, TOTAL - 42, 42, (t) => t)
        )
      } />
    </AbsoluteFill>
  );
};

export { TOTAL as VS_DURATION, NEW_BEATS };
