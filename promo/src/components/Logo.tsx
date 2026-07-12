import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * The app icon rebuilt as an animatable component (mirrors public/logo.svg):
 * teal gradient tile, two phone outlines, speaker pill, sun, mountains,
 * and four gold selection handles that fly in and snap to the corners.
 */
export const Logo: React.FC<{
  size: number;
  /** Local frame at which assembly starts. */
  startAt?: number;
  /** Compress or stretch the choreography. 1 = default. */
  speed?: number;
}> = ({ size, startAt = 0, speed = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = (frame - startAt) * speed;

  const pop = (delay: number, damping = 13, stiffness = 140) =>
    spring({ frame: f - delay, fps, config: { damping, stiffness, mass: 0.7 } });

  const fade = (delay: number, len = 8) =>
    interpolate(f - delay, [0, len], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  const tile = pop(0, 16, 120);
  const backPhone = fade(8, 10);
  const backPhoneY = interpolate(pop(8, 15), [0, 1], [40, 0]);
  const frontPhone = fade(14, 10);
  const frontPhoneY = interpolate(pop(14, 15), [0, 1], [56, 0]);
  const pill = pop(24);
  const sun = pop(28, 10, 170);
  const mountains = pop(33, 15, 130);
  const mountainsY = interpolate(mountains, [0, 1], [70, 0]);

  // Handles fly in from well outside the tile and snap to the corners.
  const handleTargets = [
    { x: 184, y: 90 },
    { x: 372, y: 90 },
    { x: 184, y: 418 },
    { x: 372, y: 418 },
  ];
  const handleFrom = [
    { x: -140, y: -160 },
    { x: 640, y: -140 },
    { x: -160, y: 640 },
    { x: 660, y: 660 },
  ];

  return (
    <svg width={size} height={size} viewBox="0 0 512 512" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="asBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6FB3B5" />
          <stop offset="1" stopColor="#457E80" />
        </linearGradient>
      </defs>
      <g
        transform={`translate(256 256) scale(${tile}) translate(-256 -256)`}
        opacity={Math.min(1, tile * 1.4)}
      >
        <rect width="512" height="512" rx="112" fill="url(#asBg)" />
        <g opacity={backPhone} transform={`translate(0 ${backPhoneY})`}>
          <rect
            x="118"
            y="72"
            width="188"
            height="328"
            rx="44"
            fill="none"
            stroke="#FFFFFF"
            strokeOpacity="0.4"
            strokeWidth="26"
          />
        </g>
        <g opacity={frontPhone} transform={`translate(0 ${frontPhoneY})`}>
          <rect
            x="206"
            y="112"
            width="188"
            height="328"
            rx="44"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="26"
          />
        </g>
        <g transform={`translate(300 148) scale(${pill}) translate(-300 -148)`}>
          <rect x="272" y="142" width="56" height="12" rx="6" fill="#FFFFFF" />
        </g>
        <g transform={`translate(262 212) scale(${sun}) translate(-262 -212)`}>
          <circle cx="262" cy="212" r="20" fill="#D4AF37" />
        </g>
        <g
          opacity={Math.min(1, mountains * 1.3)}
          transform={`translate(0 ${mountainsY})`}
        >
          <path d="M232 396 L282 318 L314 352 L352 300 L368 396 Z" fill="#FFFFFF" fillOpacity="0.9" />
        </g>
      </g>
      {handleTargets.map((tgt, i) => {
        const p = pop(20 + i * 3, 12, 150);
        const from = handleFrom[i];
        const x = interpolate(p, [0, 1], [from.x, tgt.x]);
        const y = interpolate(p, [0, 1], [from.y, tgt.y]);
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width="44"
            height="44"
            rx="10"
            fill="#D4AF37"
            opacity={fade(20 + i * 3, 5)}
          />
        );
      })}
    </svg>
  );
};
