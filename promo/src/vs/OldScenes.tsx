import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import {
  F_BODY,
  F_HEAD,
  F_MONO,
  V,
  clamp,
  holdFade,
  inOutQuint,
  outQuint,
  ramp,
  rise,
  rnd,
} from "./style";
import { GridLines, Head, Sub, useTall, usePad } from "./ui";

/**
 * The four "old way" beats. They share one drained grade and one HUD (applied
 * by the sequencer), and every prop here is drawn rather than screenshotted:
 * the gag is about the shape of the work, and imitating a real competitor's
 * chrome would be both wrong and unnecessary.
 */

const panel = (r = 12): React.CSSProperties => ({
  background: V.old.panel,
  border: `1px solid ${V.old.line}`,
  borderRadius: r,
});

// ---------------------------------------------------------------------------
// 1. Placing every frame by hand
// ---------------------------------------------------------------------------

export const OldTool: React.FC<{ local: number; len: number }> = ({ local, len }) => {
  const tall = useTall();
  const pad = usePad();
  const fade = holdFade(local, len, 14, 16);

  // The phone gets dragged, overshoots, gets nudged back. Four hand-set stops
  // rather than a tween, so it reads as fiddling instead of animation.
  const stops = [
    { at: 24, x: 0, y: 0 },
    { at: 52, x: 96, y: -34 },
    { at: 74, x: 78, y: -12 },
    { at: 96, x: 86, y: -20 },
    { at: 118, x: 84, y: -18 },
  ];
  let dx = 0;
  let dy = 0;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (local >= b.at) {
      dx = b.x;
      dy = b.y;
    } else if (local > a.at) {
      const p = inOutQuint(clamp((local - a.at) / (b.at - a.at)));
      dx = a.x + (b.x - a.x) * p;
      dy = a.y + (b.y - a.y) * p;
      break;
    }
  }

  const W = tall ? 912 : 1040;
  const H = tall ? 800 : 560;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AbsoluteFill
        style={{
          flexDirection: tall ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: tall ? 56 : 78,
          padding: pad,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22, width: tall ? "100%" : 560 }}>
          <Head size={tall ? 78 : 78} local={local} delay={6} color={V.old.ink}>
            Open a design tool
          </Head>
          <Sub size={tall ? 31 : 29} local={local} delay={18} color={V.old.sub} width={tall ? "100%" : 520}>
            Draw the frame, drop the screenshot in, nudge it until the edges line up, then
            do the next one
          </Sub>
        </div>

        {/* Generic design-tool window. Deliberately no product's branding. */}
        <div style={{ ...panel(14), width: W, height: H, overflow: "hidden", flexShrink: 0 }}>
          <div
            style={{
              height: 40,
              borderBottom: `1px solid ${V.old.line}`,
              display: "flex",
              alignItems: "center",
              gap: 8,
              paddingLeft: 16,
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{ width: 10, height: 10, borderRadius: 99, background: "rgba(255,255,255,0.16)" }}
              />
            ))}
            <span
              style={{
                marginLeft: 14,
                fontFamily: F_MONO,
                fontSize: 14,
                color: V.old.sub,
              }}
            >
              screenshot_01_final_v4_REAL.psd
            </span>
          </div>

          <div style={{ display: "flex", height: H - 40 }}>
            {/* Layer stack, growing one row at a time */}
            <div style={{ width: 190, borderRight: `1px solid ${V.old.line}`, padding: 12 }}>
              {Array.from({ length: 11 }, (_, i) => {
                const on = ramp(local, 10 + i * 7, 10);
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      height: 26,
                      opacity: 0.28 + on * 0.72,
                      paddingLeft: (i % 3) * 10,
                    }}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        background: "rgba(255,255,255,0.22)",
                      }}
                    />
                    <span
                      style={{
                        height: 7,
                        width: 60 + rnd(i) * 60,
                        borderRadius: 99,
                        background: "rgba(255,255,255,0.20)",
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Canvas with the frame being pushed around */}
            <div style={{ flex: 1, position: "relative", background: "#151818", overflow: "hidden" }}>
              <GridLines opacity={0.85} size={40} color="rgba(255,255,255,0.09)" />
              {/* Alignment guides that snap to the frame as it is dragged.
                  Dashed and anchored to the phone rather than full-height
                  rules, which otherwise read as window panes. */}
              {ramp(local, 46, 8) > 0 && (
                <>
                  <div
                    style={{
                      position: "absolute",
                      left: `calc(50% + ${dx}px)`,
                      top: "12%",
                      bottom: "12%",
                      width: 0,
                      borderLeft: "2px dashed rgba(255,255,255,0.5)",
                      opacity: ramp(local, 46, 8),
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: `calc(50% + ${dy}px)`,
                      left: "14%",
                      right: "14%",
                      height: 0,
                      borderTop: "2px dashed rgba(255,255,255,0.5)",
                      opacity: ramp(local, 58, 8),
                    }}
                  />
                </>
              )}
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: 172,
                  height: 352,
                  marginLeft: -86 + dx,
                  marginTop: -176 + dy,
                  borderRadius: 22,
                  border: "2px solid rgba(255,255,255,0.32)",
                  background: "linear-gradient(180deg,#232525,#141515)",
                  boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
                }}
              >
                {/* A raw, unstyled app screen, which is exactly what gets
                    dragged in before any of the dressing happens. */}
                <Img
                  src={staticFile("vs/raw-screen.png")}
                  style={{
                    position: "absolute",
                    inset: 8,
                    width: "calc(100% - 16px)",
                    height: "calc(100% - 16px)",
                    objectFit: "cover",
                    borderRadius: 16,
                  }}
                />
                {/* Selection handles */}
                {[
                  [0, 0],
                  [1, 0],
                  [0, 1],
                  [1, 1],
                ].map(([hx, hy], i) => (
                  <span
                    key={i}
                    style={{
                      position: "absolute",
                      left: `calc(${hx * 100}% - 4px)`,
                      top: `calc(${hy * 100}% - 4px)`,
                      width: 8,
                      height: 8,
                      background: "#fff",
                      borderRadius: 2,
                    }}
                  />
                ))}
              </div>

              {/* Cursor */}
              <svg
                width="26"
                height="30"
                viewBox="0 0 26 30"
                style={{
                  position: "absolute",
                  left: `calc(50% + ${dx + 74}px)`,
                  top: `calc(50% + ${dy + 34}px)`,
                  filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.7))",
                }}
              >
                <path d="M3 2 L3 24 L9 18.5 L13 27 L17 25 L13 17 L21 17 Z" fill="#fff" stroke="#111" strokeWidth="1.2" />
              </svg>

              {/* Inspector readout that never quite settles */}
              <div
                style={{
                  position: "absolute",
                  right: 14,
                  bottom: 14,
                  ...panel(8),
                  padding: "10px 14px",
                  fontFamily: F_MONO,
                  fontSize: 14,
                  color: V.old.sub,
                  lineHeight: 1.7,
                }}
              >
                <div>
                  X <span style={{ color: V.old.ink }}>{(412 + dx).toFixed(1)}</span>
                </div>
                <div>
                  Y <span style={{ color: V.old.ink }}>{(688 + dy).toFixed(1)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 2. Every store size, again
// ---------------------------------------------------------------------------

const SIZES = [
  ["iPhone 6.9\"", "1290 × 2796"],
  ["iPhone 6.5\"", "1242 × 2688"],
  ["iPad 13\"", "2064 × 2752"],
  ["iPad 11\"", "1668 × 2420"],
  ["Android phone", "1080 × 1920"],
  ["7\" tablet", "1024 × 1820"],
  ["10\" tablet", "1440 × 2560"],
  ["Feature graphic", "1024 × 500"],
];

export const OldSizes: React.FC<{ local: number; len: number }> = ({ local, len }) => {
  const tall = useTall();
  const pad = usePad();
  const fade = holdFade(local, len, 14, 16);
  const cols = tall ? 2 : 4;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AbsoluteFill
        style={{
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: tall ? 46 : 54,
          padding: pad,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          <Head size={tall ? 76 : 80} local={local} delay={4} color={V.old.ink} align="center">
            Now do it again for every size
          </Head>
          <Sub size={tall ? 30 : 29} local={local} delay={16} color={V.old.sub} align="center" width={720}>
            Each store slot wants its own pixel dimensions, so the layout gets rebuilt from
            scratch every time
          </Sub>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: tall ? 14 : 18,
            width: tall ? "100%" : 1360,
          }}
        >
          {SIZES.map(([label, dims], i) => {
            const at = 26 + i * 11;
            const on = ramp(local, at, 14);
            const done = ramp(local, at + 26, 10);
            return (
              <div
                key={label}
                style={{
                  ...panel(10),
                  padding: tall ? "16px 18px" : "20px 22px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  opacity: 0.18 + on * 0.82,
                  transform: `translateY(${(1 - on) * 14}px)`,
                }}
              >
                <div
                  style={{
                    fontFamily: F_BODY,
                    fontWeight: 600,
                    fontSize: tall ? 19 : 21,
                    color: V.old.ink,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  {label}
                  <span
                    style={{
                      width: 15,
                      height: 15,
                      borderRadius: 99,
                      border: `2px solid ${done > 0.5 ? V.old.sub : "rgba(255,255,255,0.18)"}`,
                      borderTopColor: done > 0.5 ? V.old.sub : "transparent",
                      transform: `rotate(${done > 0.5 ? 0 : local * 14}deg)`,
                    }}
                  />
                </div>
                <div style={{ fontFamily: F_MONO, fontSize: tall ? 16 : 18, color: V.old.sub }}>
                  {dims}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    height: 4,
                    borderRadius: 99,
                    background: "rgba(255,255,255,0.08)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${ramp(local, at + 4, 30) * 100}%`,
                      background: "rgba(255,255,255,0.28)",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 3. Every language, again
// ---------------------------------------------------------------------------

const LOCALES = [
  "en-US", "de-DE", "fr-FR", "es-ES", "it-IT", "pt-BR", "ja-JP", "ko-KR",
  "zh-Hans", "zh-Hant", "nl-NL", "sv-SE", "pl-PL", "tr-TR", "ru-RU", "ar-SA",
  "hi-IN", "th-TH", "vi-VN", "id-ID", "cs-CZ", "da-DK", "fi-FI", "el-GR",
];

export const OldLangs: React.FC<{ local: number; len: number }> = ({ local, len }) => {
  const tall = useTall();
  const pad = usePad();
  const fade = holdFade(local, len, 14, 16);
  const cols = tall ? 4 : 8;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AbsoluteFill
        style={{
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: tall ? 44 : 52,
          padding: pad,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          <Head size={tall ? 76 : 80} local={local} delay={4} color={V.old.ink} align="center">
            And again for every language
          </Head>
          <Sub size={tall ? 30 : 29} local={local} delay={16} color={V.old.sub} align="center" width={740}>
            Retype the headline, refit the line breaks, export the whole set again, and
            repeat it the day the copy changes
          </Sub>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: tall ? 10 : 14,
            width: tall ? "100%" : 1400,
          }}
        >
          {LOCALES.map((code, i) => {
            const on = ramp(local, 22 + i * 3.2, 12);
            return (
              <div
                key={code}
                style={{
                  ...panel(8),
                  padding: tall ? "12px 8px" : "16px 10px",
                  textAlign: "center",
                  fontFamily: F_MONO,
                  fontSize: tall ? 16 : 19,
                  color: V.old.ink,
                  opacity: 0.16 + on * 0.84,
                  transform: `scale(${0.9 + on * 0.1})`,
                }}
              >
                {code}
              </div>
            );
          })}
        </div>

        {/* The multiplication, spelled out */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: tall ? 16 : 26,
            fontFamily: F_HEAD,
            fontWeight: 700,
            fontSize: tall ? 38 : 44,
            color: V.old.sub,
            ...rise(local, 74, 26, 18),
          }}
        >
          <span>8 sizes</span>
          <span style={{ color: "rgba(255,255,255,0.22)" }}>×</span>
          <span>24 languages</span>
          <span style={{ color: "rgba(255,255,255,0.22)" }}>×</span>
          <span>5 screens</span>
          <span style={{ color: "rgba(255,255,255,0.22)" }}>=</span>
          <span style={{ color: V.red }}>960 files</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 4. Rejected, then billed
// ---------------------------------------------------------------------------

export const OldPay: React.FC<{ local: number; len: number }> = ({ local, len }) => {
  const tall = useTall();
  const pad = usePad();
  const fade = holdFade(local, len, 14, 18);
  const shake = local > 26 && local < 44 ? Math.sin((local - 26) * 1.5) * (44 - local) * 0.5 : 0;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <AbsoluteFill
        style={{
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: tall ? 40 : 46,
          padding: pad,
        }}
      >
        <Head size={tall ? 76 : 80} local={local} delay={4} color={V.old.ink} align="center">
          Upload. Wait. Get bounced
        </Head>

        {/* Store rejection */}
        <div
          style={{
            ...panel(12),
            borderColor: "rgba(196,87,76,0.5)",
            padding: tall ? "20px 24px" : "24px 32px",
            display: "flex",
            alignItems: "center",
            gap: 18,
            transform: `translateX(${shake}px)`,
            opacity: ramp(local, 22, 10),
            maxWidth: tall ? "100%" : 880,
          }}
        >
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 99,
              background: "rgba(196,87,76,0.16)",
              border: `2px solid ${V.red}`,
              color: V.red,
              display: "grid",
              placeItems: "center",
              fontFamily: F_HEAD,
              fontWeight: 700,
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            !
          </span>
          <div style={{ fontFamily: F_BODY, fontSize: tall ? 21 : 24, color: V.old.ink, lineHeight: 1.4 }}>
            The dimensions of one or more screenshots are wrong
            <div style={{ fontSize: tall ? 17 : 19, color: V.old.sub, marginTop: 4 }}>
              Expected 2064 × 2752, received 2048 × 2732
            </div>
          </div>
        </div>

        {/* The paid alternative, watermark and all */}
        <div
          style={{
            display: "flex",
            flexDirection: tall ? "column" : "row",
            gap: tall ? 18 : 26,
            alignItems: "stretch",
            ...rise(local, 54, 28, 26),
          }}
        >
          <div
            style={{
              ...panel(12),
              padding: tall ? "22px 26px" : "26px 34px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minWidth: tall ? undefined : 340,
            }}
          >
            <div
              style={{
                fontFamily: F_BODY,
                fontSize: 17,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: V.old.sub,
              }}
            >
              Or subscribe
            </div>
            <div style={{ fontFamily: F_HEAD, fontWeight: 700, fontSize: tall ? 46 : 56, color: V.old.ink }}>
              $29<span style={{ fontSize: tall ? 22 : 26, color: V.old.sub }}> / month</span>
            </div>
            <div style={{ fontFamily: F_BODY, fontSize: tall ? 18 : 20, color: V.old.sub }}>
              Billed yearly, cancel anytime
            </div>
          </div>

          <div
            style={{
              ...panel(12),
              width: tall ? undefined : 340,
              minHeight: tall ? 150 : undefined,
              position: "relative",
              overflow: "hidden",
              display: "grid",
              placeItems: "center",
            }}
          >
            <div
              style={{
                fontFamily: F_HEAD,
                fontWeight: 700,
                fontSize: tall ? 30 : 34,
                color: "rgba(255,255,255,0.30)",
                transform: "rotate(-14deg)",
                letterSpacing: "0.08em",
                opacity: ramp(local, 70, 16),
              }}
            >
              FREE PLAN WATERMARK
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "repeating-linear-gradient(-14deg, rgba(255,255,255,0.035) 0 22px, transparent 22px 44px)",
              }}
            />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
