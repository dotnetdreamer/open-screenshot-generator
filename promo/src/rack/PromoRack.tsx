import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, H, SHOT, TOTAL, W, beat, ramp, rnd } from "./style";
import { PERSPECTIVE, cameraAt, cameraTransform } from "./camera";
import { Rack } from "./Rack";
import { EndCard } from "./EndCard";
import { grainUrl } from "./kit";

export const RACK_DURATION = TOTAL;

/** The rack through the camera. */
const Scene: React.FC<{ frame: number }> = ({ frame }) => {
  const cam = cameraAt(frame);
  return (
    <AbsoluteFill style={{ perspective: PERSPECTIVE, perspectiveOrigin: "50% 50%", overflow: "hidden", background: C.wallMid }}>
      <div
        style={{
          position: "absolute",
          left: W / 2,
          top: H / 2,
          width: 0,
          height: 0,
          transformStyle: "preserve-3d",
          transform: cameraTransform(cam),
        }}
      >
        <Rack frame={frame} />
      </div>
    </AbsoluteFill>
  );
};

/**
 * Motion blur for the camera, cheap enough for the pull back: everything moves
 * by about the same amount when the camera travels, and the edges move most
 * when it zooms, so one even blur plus one that grows towards the edges reads
 * as a streak. (Re-rendering the whole rack a dozen times a frame, the honest
 * way, stalled the render on the office PC.)
 */
const CameraBlur: React.FC<{ frame: number }> = ({ frame }) => {
  // only the pull back moves fast enough to need it (and a cut must not count as motion)
  if (frame < beat(SHOT.PULL) || frame > beat(SHOT.WIDE) + 2) return null;
  const a = cameraAt(frame - 0.5);
  const b = cameraAt(frame + 0.5);
  const zoom = Math.abs(Math.log(b.s) - Math.log(a.s)) * 800;
  const pan = Math.hypot(b.x - a.x, b.y - a.y) * b.s;
  const even = Math.min(6, Math.max(0, pan - 6) * 0.16);
  const edge = Math.min(13, zoom * 0.3);
  if (even < 0.3 && edge < 0.3) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {even >= 0.3 ? <AbsoluteFill style={{ backdropFilter: `blur(${even}px)`, WebkitBackdropFilter: `blur(${even}px)` }} /> : null}
      {edge >= 0.3 ? (
        <AbsoluteFill
          style={{
            backdropFilter: `blur(${edge}px)`,
            WebkitBackdropFilter: `blur(${edge}px)`,
            maskImage: "radial-gradient(ellipse 62% 58% at 50% 50%, transparent 18%, #000 92%)",
            WebkitMaskImage: "radial-gradient(ellipse 62% 58% at 50% 50%, transparent 18%, #000 92%)",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * Depth of field: the picture softens towards the top and bottom edges, like a
 * close lens on a small object. Strong on the close shots, light on the wide.
 */
const DepthOfField: React.FC<{ frame: number }> = ({ frame }) => {
  const wide = ramp(frame, beat(SHOT.PULL), beat(SHOT.WIDE) - beat(SHOT.PULL));
  const k = 1 - 0.75 * wide;
  const band = (edge: "top" | "bottom", size: number, blur: number) => (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        [edge]: 0,
        height: `${size}%`,
        backdropFilter: `blur(${blur * k}px)`,
        WebkitBackdropFilter: `blur(${blur * k}px)`,
        maskImage: `linear-gradient(${edge === "top" ? "180deg" : "0deg"}, #000 0%, rgba(0,0,0,0.6) 45%, transparent 100%)`,
        WebkitMaskImage: `linear-gradient(${edge === "top" ? "180deg" : "0deg"}, #000 0%, rgba(0,0,0,0.6) 45%, transparent 100%)`,
      }}
    />
  );
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {band("top", 30, 3.5)}
      {band("top", 14, 7)}
      {band("bottom", 28, 4)}
      {band("bottom", 13, 8)}
    </AbsoluteFill>
  );
};

/** Warm light from the top left, a soft vignette and fine grain. */
const Grade: React.FC<{ frame: number }> = ({ frame }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <AbsoluteFill
      style={{
        background: "radial-gradient(ellipse 80% 55% at 18% 0%, rgba(255,196,160,0.30), rgba(255,196,160,0) 70%)",
        mixBlendMode: "screen",
      }}
    />
    <AbsoluteFill
      style={{
        background: "radial-gradient(ellipse 75% 70% at 50% 48%, rgba(0,0,0,0) 55%, rgba(70,25,40,0.30) 100%)",
        mixBlendMode: "multiply",
      }}
    />
    <AbsoluteFill
      style={{
        backgroundImage: grainUrl,
        backgroundSize: "256px 256px",
        backgroundPosition: `${Math.floor(rnd(frame) * 256)}px ${Math.floor(rnd(frame + 999) * 256)}px`,
        opacity: 0.09,
        mixBlendMode: "overlay",
      }}
    />
  </AbsoluteFill>
);

/**
 * Laid out at 1080 x 1350 and scaled to the composition, so the same numbers
 * serve the 1440 x 1800 master and a quick 0.75 scale review render.
 */
export const PromoRack: React.FC<{ withMusic?: boolean }> = ({ withMusic = true }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: C.wallMid }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transform: `scale(${width / W})`, transformOrigin: "0 0" }}>
        <Scene frame={frame} />
        <CameraBlur frame={frame} />
        <DepthOfField frame={frame} />
        <EndCard frame={frame} />
        <Grade frame={frame} />
      </div>
      {withMusic ? <Audio src={staticFile("rack/score.m4a")} /> : null}
    </AbsoluteFill>
  );
};
