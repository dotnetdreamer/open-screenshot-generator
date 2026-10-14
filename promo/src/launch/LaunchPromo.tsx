import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { BODY, DISPLAY, HERO_DURATION, L, LAUNCH_DURATION, WINDOW, clamp, mix, smooth } from "./style";

type View = { x: number; y: number; scale: number };
type Beat = {
  from: number;
  duration: number;
  image: string;
  heading: string;
  label: string;
  start: View;
  end: View;
};

const BEATS: Beat[] = [
  {
    from: 0, duration: 90, image: "editor.png",
    heading: "Your screenshots, in one canvas", label: "Open Screenshot Generator",
    start: { x: 960, y: 625, scale: 0.88 }, end: { x: 980, y: 605, scale: 0.93 },
  },
  {
    from: 90, duration: 120, image: "agent-intake.png",
    heading: "Start with your app", label: "Screenshots in",
    start: { x: 960, y: 595, scale: 0.93 }, end: { x: 1030, y: 620, scale: 1.12 },
  },
  {
    from: 210, duration: 180, image: "editor-agent.png",
    heading: "Ask for the whole set", label: "Desktop agent",
    start: { x: 1080, y: 530, scale: 1.18 }, end: { x: 1420, y: 416, scale: 1.85 },
  },
  {
    from: 390, duration: 150, image: "editor-agent.png",
    heading: "Review the result in your canvas", label: "Your project",
    start: { x: 1420, y: 416, scale: 1.85 }, end: { x: 988, y: 554, scale: 1.03 },
  },
  {
    from: 540, duration: 150, image: "editor-detail.png",
    heading: "Every element stays editable", label: "Make it your own",
    start: { x: 975, y: 580, scale: 0.95 }, end: { x: 1050, y: 550, scale: 1.23 },
  },
  {
    from: 690, duration: 90, image: "localization.png",
    heading: "One layout, in your languages", label: "Languages",
    start: { x: 970, y: 675, scale: 0.83 }, end: { x: 970, y: 675, scale: 0.9 },
  },
  {
    from: 780, duration: 90, image: "export.png",
    heading: "Export for the stores", label: "App Store and Play Store",
    start: { x: 970, y: 580, scale: 1.08 }, end: { x: 970, y: 600, scale: 1.18 },
  },
  {
    from: 870, duration: 90, image: "editor.png",
    heading: "Open Screenshot Generator", label: "Open the editor at openscrgen.app",
    start: { x: 980, y: 605, scale: 0.96 }, end: { x: 960, y: 625, scale: 0.88 },
  },
];

const Backdrop: React.FC<{ frame: number; loop?: boolean }> = ({ frame, loop = false }) => {
  const cycle = loop ? Math.sin((frame / HERO_DURATION) * Math.PI * 2) : Math.sin(frame / 230);
  return (
    <AbsoluteFill style={{ background: L.background }}>
      <AbsoluteFill style={{
        background: `radial-gradient(ellipse at ${26 + cycle * 5}% 25%, rgba(94,157,157,0.23), transparent 60%), radial-gradient(ellipse at 85% ${72 + cycle * 4}%, rgba(167,140,69,0.12), transparent 54%)`,
      }} />
      <AbsoluteFill style={{
        background: "linear-gradient(180deg, rgba(3,13,14,0.06), rgba(3,13,14,0.42))",
      }} />
    </AbsoluteFill>
  );
};

const Product: React.FC<{ image: string; view: View; opacity?: number; hero?: boolean }> = ({ image, view, opacity = 1, hero = false }) => (
  <div style={{
    position: "absolute", inset: 0, opacity,
    transformOrigin: "0 0",
    transform: `translate(${960 - view.scale * view.x}px, ${(hero ? 420 : 590) - view.scale * view.y}px) scale(${view.scale})`,
  }}>
    <div style={{
      position: "absolute", left: hero ? 16 : WINDOW.x, top: hero ? 16 : WINDOW.y,
      width: hero ? 1888 : WINDOW.width, height: hero ? 1062 : WINDOW.height,
      border: `1px solid ${L.stroke}`, borderRadius: 15, overflow: "hidden",
      background: L.surface,
      boxShadow: "0 34px 90px rgba(0,0,0,0.43), 0 2px 16px rgba(0,0,0,0.24)",
    }}>
      <Img src={staticFile(`launch/${image}`)} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  </div>
);

const Caption: React.FC<{ heading: string; label: string; opacity: number }> = ({ heading, label, opacity }) => (
  <div style={{ position: "absolute", left: 104, top: 49, opacity, transform: `translateY(${(1 - opacity) * 8}px)` }}>
    <div style={{ fontFamily: BODY, color: L.teal, fontSize: 17, fontWeight: 500, marginBottom: 12 }}>
      {label}
    </div>
    <div style={{ fontFamily: DISPLAY, color: L.ink, fontWeight: 500, fontSize: 49, lineHeight: 1.12, letterSpacing: -1.6 }}>
      {heading}
    </div>
  </div>
);

const FilmBeat: React.FC<{ beat: Beat; last: boolean }> = ({ beat, last }) => {
  const frame = useCurrentFrame();
  const progress = smooth((frame - 12) / (beat.duration - 30));
  const view = {
    x: mix(beat.start.x, beat.end.x, progress),
    y: mix(beat.start.y, beat.end.y, progress),
    scale: mix(beat.start.scale, beat.end.scale, progress),
  };
  const enter = beat.from === 0 ? 1 : smooth(frame / 12);
  const leave = last ? 1 : 1 - smooth((frame - beat.duration + 12) / 12);
  const captionOpacity = Math.min(enter, leave);
  const agentFlow = beat.from === 210;
  return (
    <AbsoluteFill>
      {agentFlow ? (
        <>
          {frame < 57 && <Product image="editor-agent-prompt.png" view={view} opacity={enter} />}
          {frame >= 45 && frame < 117 && <Product image="editor-agent-working.png" view={view} opacity={enter * smooth((frame - 45) / 12)} />}
          {frame >= 105 && <Product image={beat.image} view={view} opacity={enter * smooth((frame - 105) / 12)} />}
        </>
      ) : <Product image={beat.image} view={view} opacity={enter} />}
      <Caption heading={beat.heading} label={beat.label} opacity={captionOpacity} />
    </AbsoluteFill>
  );
};

const FilmFurniture: React.FC<{ frame: number }> = ({ frame }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <div style={{
      position: "absolute", top: 52, right: 104, display: "flex", alignItems: "center", gap: 13,
      fontFamily: BODY, fontSize: 17, fontWeight: 500, color: L.secondary,
    }}>
      <Img src={staticFile("logo.svg")} style={{ width: 31, height: 31 }} />
      <span>Open Screenshot Generator</span>
    </div>
    <div style={{
      position: "absolute", bottom: 31, left: 104, right: 104,
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 40,
      fontFamily: BODY, fontSize: 15, color: L.secondary,
    }}>
      <span style={{
        background: "rgba(5,18,19,0.88)", border: `1px solid ${L.stroke}`,
        borderRadius: 8, padding: "8px 13px",
      }}>Example workflow</span>
      <div style={{ width: 190, height: 2, background: "rgba(166,190,190,0.2)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${clamp(frame / (LAUNCH_DURATION - 1)) * 100}%`, background: L.gold }} />
      </div>
    </div>
  </AbsoluteFill>
);

export const PromoLaunch: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Backdrop frame={frame} />
      {BEATS.map((beat, index) => (
        <Sequence key={beat.from} from={beat.from} durationInFrames={beat.duration + (index < BEATS.length - 1 ? 12 : 0)}>
          <FilmBeat beat={beat} last={index === BEATS.length - 1} />
        </Sequence>
      ))}
      <FilmFurniture frame={frame} />
      <Audio src={staticFile("launch/score.m4a")} volume={(f) => interpolate(
        f, [0, 22, LAUNCH_DURATION - 55, LAUNCH_DURATION - 1], [0, 0.72, 0.72, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )} />
    </AbsoluteFill>
  );
};

export const HeroLaunch: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / HERO_DURATION;
  const visit = (1 - Math.cos(t * Math.PI * 2)) / 2;
  const view = {
    x: mix(960, 1080, visit),
    y: mix(400, 370, visit) + Math.sin(t * Math.PI * 2) * 4,
    scale: mix(1.01, 1.17, visit),
  };
  return (
    <AbsoluteFill>
      <Backdrop frame={frame} loop />
      <Product image="editor-agent.png" view={view} hero />
    </AbsoluteFill>
  );
};

export { LAUNCH_DURATION, HERO_DURATION };
