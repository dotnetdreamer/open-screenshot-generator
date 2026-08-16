import React from "react";
import { AbsoluteFill } from "remotion";
import { Logo } from "../components/Logo";
import { F_BODY, F_HEAD, F_MONO, V, clamp, holdFade, outQuint, ramp, rise, rnd } from "./style";
import { Gold, Head, Sub, Teal, useTall, usePad } from "./ui";

// ---------------------------------------------------------------------------
// Hook: the problem, stated in one number
// ---------------------------------------------------------------------------

export const Hook: React.FC<{ local: number; len: number }> = ({ local, len }) => {
  const tall = useTall();
  const pad = usePad();
  const fade = holdFade(local, len, 10, 16);

  // 40 empty slots stamp in, which is roughly what a single release across both
  // stores actually asks for once sizes and locales are counted.
  const slots = 40;
  const cols = tall ? 8 : 10;
  const count = Math.round(ramp(local, 44, 56) * slots);

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AbsoluteFill
        style={{
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: tall ? 44 : 50,
          padding: pad,
        }}
      >
        <Head size={tall ? 76 : 86} local={local} delay={2} align="center">
          You shipped the app
        </Head>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: tall ? 12 : 10,
            // Narrow on purpose: at slot aspect 9/19.5 a full-width grid is
            // taller than the frame, and forty small slots read as "a lot"
            // better than eight big ones anyway.
            width: tall ? 640 : 560,
            ...rise(local, 38, 24, 20),
          }}
        >
          {Array.from({ length: slots }, (_, i) => {
            const on = i < count;
            return (
              <div
                key={i}
                style={{
                  aspectRatio: "9 / 19.5",
                  borderRadius: 6,
                  border: `1px ${on ? "solid" : "dashed"} ${
                    on ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.09)"
                  }`,
                  background: on ? "rgba(255,255,255,0.045)" : "transparent",
                  transform: `scale(${on ? 1 : 0.9})`,
                  transition: "none",
                }}
              />
            );
          })}
        </div>

        <Head size={tall ? 52 : 58} local={local} delay={62} align="center" width={tall ? "100%" : 1200}>
          Both stores want <Gold>forty pictures</Gold> back
        </Head>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Turn: the grade breaks and the product lands
// ---------------------------------------------------------------------------

export const Turn: React.FC<{ local: number; len: number }> = ({ local, len }) => {
  const tall = useTall();
  const pad = usePad();
  const out = 1 - ramp(local, len - 14, 14);
  // A light bar sweeps across on the cut and takes the grey with it.
  const sweep = ramp(local, 0, 26, outQuint);

  return (
    <AbsoluteFill style={{ opacity: out }}>
      <AbsoluteFill
        style={{
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: tall ? 30 : 34,
          padding: pad,
        }}
      >
        <div style={{ opacity: ramp(local, 12, 18) }}>
          <Logo size={tall ? 176 : 168} startAt={14} speed={1.15} />
        </div>

        <Head size={tall ? 72 : 84} local={local} delay={26} align="center" width={tall ? "100%" : 1400}>
          Open Screenshot Generator
        </Head>
        <Sub size={tall ? 32 : 34} local={local} delay={38} align="center" color={V.teal}>
          One tool for every store slot
        </Sub>
      </AbsoluteFill>

      {/* The sweep itself */}
      <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            top: "-20%",
            bottom: "-20%",
            left: `${-40 + sweep * 165}%`,
            width: "42%",
            background:
              "linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(212,175,55,0.20) 38%, rgba(255,255,255,0.55) 52%, rgba(111,179,181,0.20) 66%, rgba(255,255,255,0) 100%)",
            filter: "blur(26px)",
            opacity: 1 - sweep * 0.55,
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Outro: the offer, then the address
// ---------------------------------------------------------------------------

export const Outro: React.FC<{ local: number; len: number }> = ({ local, len }) => {
  const tall = useTall();
  const pad = usePad();
  const fade = holdFade(local, len, 14, 22);

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AbsoluteFill
        style={{
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: tall ? 28 : 32,
          padding: pad,
        }}
      >
        <div style={{ opacity: ramp(local, 0, 14) }}>
          <Logo size={tall ? 152 : 142} startAt={4} speed={1.2} />
        </div>

        <Head size={tall ? 66 : 78} local={local} delay={18} align="center" width={tall ? "100%" : 1400}>
          Free forever. <Gold>No account. No watermark</Gold>
        </Head>

        <div
          style={{
            display: "flex",
            gap: tall ? 12 : 16,
            flexWrap: "wrap",
            justifyContent: "center",
            ...rise(local, 32, 24, 18),
          }}
        >
          {["Browser and desktop", "MIT licensed", "Source on GitHub"].map((t) => (
            <span
              key={t}
              style={{
                padding: tall ? "11px 20px" : "12px 24px",
                borderRadius: 99,
                border: `1px solid ${V.stroke}`,
                background: V.glass,
                fontFamily: F_BODY,
                fontWeight: 500,
                fontSize: tall ? 20 : 23,
                color: V.sub,
              }}
            >
              {t}
            </span>
          ))}
        </div>

        <div
          style={{
            marginTop: tall ? 14 : 18,
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: tall ? "18px 34px" : "20px 44px",
            borderRadius: 99,
            background: V.gold,
            color: "#0A0B0B",
            fontFamily: F_HEAD,
            fontWeight: 700,
            fontSize: tall ? 34 : 40,
            letterSpacing: "-0.01em",
            boxShadow: "0 24px 70px rgba(212,175,55,0.28)",
            ...rise(local, 46, 28, 24),
          }}
        >
          openscrgen.app
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
