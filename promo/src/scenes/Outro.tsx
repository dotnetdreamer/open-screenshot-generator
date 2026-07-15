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

const PILL_START = 56;

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pillRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  // GSAP elastic pop for the URL pill, scrubbed by frame for determinism.
  useEffect(() => {
    if (!pillRef.current) return;
    const tl = gsap
      .timeline({ paused: true })
      .from(pillRef.current, {
        scale: 0.4,
        y: 90,
        opacity: 0,
        duration: 1.2,
        ease: "elastic.out(1, 0.45)",
      });
    tlRef.current = tl;
    return () => {
      tl.kill();
    };
  }, []);
  useEffect(() => {
    tlRef.current?.time(Math.max(0, (frame - PILL_START) / fps), true);
  }, [frame, fps]);

  const name = spring({
    frame: frame - 26,
    fps,
    config: { damping: 19, stiffness: 110, mass: 0.9 },
  });
  const free = spring({ frame: frame - 44, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 36,
          marginTop: -20,
        }}
      >
        <Logo size={230} startAt={0} speed={1.6} />
        {/* Two lines: the name on one line would overflow the 1080-wide
            portrait cut, which reuses this scene. */}
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            fontSize: 84,
            lineHeight: 1.04,
            letterSpacing: "-0.02em",
            textAlign: "center",
            color: C.ink,
            opacity: Math.min(1, name * 1.5),
            transform: `translateY(${interpolate(name, [0, 1], [40, 0])}px)`,
          }}
        >
          Open Screenshot
          <br />
          Generator
        </div>
        <div
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 400,
            fontSize: 30,
            color: C.sub,
            opacity: free,
            transform: `translateY(${interpolate(free, [0, 1], [20, 0])}px)`,
            textShadow: "0 2px 18px rgba(6,13,13,0.9)",
          }}
        >
          Free, open source, and ready when you are
        </div>
        <div
          ref={pillRef}
          style={{
            fontFamily: FONT_BODY,
            fontWeight: 600,
            fontSize: 30,
            color: C.bg,
            background: `linear-gradient(120deg, ${C.teal}, ${C.tealDeep})`,
            borderRadius: 999,
            padding: "20px 46px",
            marginTop: 14,
            boxShadow: "0 18px 50px rgba(111,179,181,0.3)",
          }}
        >
          openscrgen.app
        </div>
      </div>
    </AbsoluteFill>
  );
};
