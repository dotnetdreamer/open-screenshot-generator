import React, { useEffect, useRef } from "react";
import gsap from "gsap";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Logo } from "../components/Logo";
import { C, FONT_BODY, FONT_DISPLAY } from "../theme";

const NAME = "Artboard Studio";
const LETTERS_START = 30;

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const wordRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  // GSAP drives the wordmark: letters flip up with a back.out overshoot.
  // The timeline is paused and scrubbed to the current frame, so rendering
  // stays deterministic across threads.
  useEffect(() => {
    const ctx = gsap.context(() => {
      tlRef.current = gsap
        .timeline({ paused: true })
        .from(".ltr", {
          y: 110,
          opacity: 0,
          rotateX: -75,
          stagger: 0.05,
          duration: 0.9,
          ease: "back.out(1.6)",
        });
    }, wordRef);
    return () => ctx.revert();
  }, []);
  useEffect(() => {
    tlRef.current?.time(Math.max(0, (frame - LETTERS_START) / fps), true);
  }, [frame, fps]);

  const tag = spring({ frame: frame - 62, fps, config: { damping: 200 } });
  const glow = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(700px 520px at 50% 44%, rgba(111,179,181,${
            0.18 * glow
          }), transparent 70%)`,
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 44,
        }}
      >
        <Logo size={280} startAt={4} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
          }}
        >
          <div
            ref={wordRef}
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: 96,
              letterSpacing: "-0.02em",
              color: C.ink,
              perspective: 700,
              whiteSpace: "pre",
            }}
          >
            {NAME.split("").map((ch, i) => (
              <span
                key={i}
                className="ltr"
                style={{ display: "inline-block", transformStyle: "preserve-3d" }}
              >
                {ch === " " ? " " : ch}
              </span>
            ))}
          </div>
          <div
            style={{
              fontFamily: FONT_BODY,
              fontWeight: 400,
              fontSize: 34,
              color: C.sub,
              opacity: tag,
              transform: `translateY(${interpolate(tag, [0, 1], [24, 0])}px)`,
              textShadow: "0 2px 18px rgba(6,13,13,0.9)",
            }}
          >
            Make your app look as <span style={{ color: C.goldSoft }}>good</span> as it works
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
