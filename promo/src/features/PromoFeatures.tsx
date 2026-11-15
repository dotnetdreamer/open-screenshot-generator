import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { CHAPTERS, COPY, CRASHES, CUTS, T, TOTAL, V, clamp, outQuint, ramp, type SceneKey } from "./style";
import { Backdrop, ChapterHud, Flash, Grain, HUES, SceneFx, Vignette } from "./ui";
import { ChapterCard, HookA, HookB, Reveal } from "./Hook";
import { Agent, Capture, Drop, Languages, Panorama, Studio3D, Templates, Video } from "./Make";
import { ExportSizes, Header, Site, Social, Upload } from "./Launch";
import { Answer, Ask, Keywords, Reviews, Rivals, Stats } from "./Grow";
import { More, Outro, Recap, Score } from "./Finale";

/** Frames two neighbouring scenes overlap, so a cut is a short cross rather than a dip. */
const OVER = 10;

/** How much of each chapter colour the backdrop carries at a frame. */
function hueAt(frame: number) {
  const gold = ramp(frame, T.L_TITLE[0] - 4, 24, outQuint) * (1 - ramp(frame, T.G_TITLE[0] - 4, 24, outQuint));
  const green = ramp(frame, T.G_TITLE[0] - 4, 24, outQuint) * (1 - ramp(frame, T.OUTRO[0], 40, outQuint));
  const teal = clamp(1 - gold - green);
  return { teal, gold, green };
}

/** The groove sections of the track, where the backdrop swells on every half bar. */
const GROOVES: [number, number][] = [
  [T.M_TPL[0], T.L_TITLE[0]],
  [T.L_UPLOAD[0] + 60, T.G_TITLE[0]],
  [T.G_ANSWER[0], T.OUTRO[0]],
];

function pulseAt(frame: number) {
  if (!GROOVES.some(([a, b]) => frame >= a && frame < b)) return 0;
  const phase = (frame % 30) / 30;
  return Math.exp(-phase * 6);
}

/** A thin bar of light across the frame on every cut, so the eye follows the change. */
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
          width: "20%",
          background:
            "linear-gradient(90deg, rgba(212,175,55,0) 0%, rgba(212,175,55,0.12) 55%, rgba(255,255,255,0.22) 78%, rgba(212,175,55,0) 100%)",
          opacity: 1 - p * 0.4,
          filter: "blur(6px)",
        }}
      />
    </AbsoluteFill>
  );
};

const Scene: React.FC<{
  name: SceneKey;
  hard?: boolean;
  /** Frames this scene keeps fading under the next one. 0 before a crash, so the hit is a clean cut. */
  tail?: number;
  children: (p: { local: number; len: number }) => React.ReactNode;
}> = ({ name, hard, tail = OVER, children }) => {
  const [from, to] = T[name];
  const len = to - from;
  const span = Math.min(len + tail, TOTAL - from);
  return (
    <Sequence from={from} durationInFrames={span} layout="none" name={name}>
      <Inner len={len} hard={hard}>
        {children}
      </Inner>
    </Sequence>
  );
};

const Inner: React.FC<{ len: number; hard?: boolean; children: (p: { local: number; len: number }) => React.ReactNode }> = ({
  len,
  hard,
  children,
}) => {
  const local = useCurrentFrame();
  return (
    <SceneFx local={local} len={len} hard={hard}>
      {children({ local, len })}
    </SceneFx>
  );
};

export const PromoFeatures: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: V.bg }}>
      <Backdrop frame={frame} hueAt={hueAt} pulse={pulseAt(frame)} />

      <Scene name="HOOK_A">{(p) => <HookA {...p} />}</Scene>
      <Scene name="HOOK_B" tail={0}>{(p) => <HookB {...p} />}</Scene>
      <Scene name="REVEAL" hard>{(p) => <Reveal {...p} />}</Scene>
      <Scene name="BREAK1">
        {(p) => <ChapterCard {...p} n={CHAPTERS[0].n} title={CHAPTERS[0].title} hue={HUES.teal} wall t0={420} />}
      </Scene>

      <Scene name="M_TPL" hard>{(p) => <Templates {...p} />}</Scene>
      <Scene name="M_DROP">{(p) => <Drop {...p} />}</Scene>
      <Scene name="M_3D">{(p) => <Studio3D {...p} />}</Scene>
      <Scene name="M_PANO">{(p) => <Panorama {...p} />}</Scene>
      <Scene name="M_LANG">{(p) => <Languages {...p} />}</Scene>
      <Scene name="M_VIDEO">{(p) => <Video {...p} />}</Scene>
      <Scene name="M_CAPTURE">{(p) => <Capture {...p} />}</Scene>
      <Scene name="M_AGENT" tail={0}>{(p) => <Agent {...p} />}</Scene>

      <Scene name="L_TITLE" hard>
        {(p) => <ChapterCard {...p} n={CHAPTERS[1].n} title={CHAPTERS[1].title} hue={HUES.gold} />}
      </Scene>
      <Scene name="L_EXPORT">{(p) => <ExportSizes {...p} />}</Scene>
      <Scene name="L_UPLOAD">{(p) => <Upload {...p} />}</Scene>
      <Scene name="L_SITE">{(p) => <Site {...p} />}</Scene>
      <Scene name="L_SOCIAL">{(p) => <Social {...p} />}</Scene>
      <Scene name="L_HEADER" tail={0}>{(p) => <Header {...p} />}</Scene>

      <Scene name="G_TITLE" hard>
        {(p) => <ChapterCard {...p} n={CHAPTERS[2].n} title={CHAPTERS[2].title} hue={HUES.green} />}
      </Scene>
      <Scene name="G_STATS">{(p) => <Stats {...p} />}</Scene>
      <Scene name="G_ASK" tail={0}>{(p) => <Ask {...p} />}</Scene>
      <Scene name="G_ANSWER" hard>{(p) => <Answer {...p} />}</Scene>
      <Scene name="G_RIVALS">{(p) => <Rivals {...p} />}</Scene>
      <Scene name="G_KEYS">{(p) => <Keywords {...p} />}</Scene>
      <Scene name="G_REVIEWS">{(p) => <Reviews {...p} />}</Scene>
      <Scene name="G_MORE1">{(p) => <More {...p} items={COPY.more.slice(0, 4)} first={0} />}</Scene>
      <Scene name="G_MORE2">{(p) => <More {...p} items={COPY.more.slice(4)} first={4} />}</Scene>
      <Scene name="G_SCORE">{(p) => <Score {...p} />}</Scene>
      <Scene name="G_RECAP" tail={0}>{(p) => <Recap {...p} />}</Scene>
      <Scene name="OUTRO" hard>{(p) => <Outro {...p} />}</Scene>

      <ChapterHud frame={frame} />
      <CutSweep frame={frame} />
      {CRASHES.map((at) => (
        <Flash key={at} frame={frame} at={at} strength={at === T.OUTRO[0] ? 0.24 : 0.32} />
      ))}
      <Vignette strength={0.55} />
      <Grain frame={frame} opacity={0.04} />

      {/* Out on black, so an autoplay embed does not snap back to the first frame */}
      <AbsoluteFill style={{ background: "#000", opacity: ramp(frame, TOTAL - 24, 24, (t) => t), pointerEvents: "none" }} />

      {/* The arranged bed is exactly TOTAL frames long and already fades itself out */}
      <Audio src={staticFile("music-features-intro.m4a")} />
    </AbsoluteFill>
  );
};

export { TOTAL as FEATURES_DURATION };
