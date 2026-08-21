import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { F_BODY, F_HEAD, F_MONO, V, clamp, outQuint, ramp, rise, rnd } from "./style";

export { Kicker, Head, Sub, Gold, Teal, Grain, Vignette, GridLines, Glow, Motes } from "../vs/ui";

/** Safe margin. The cut is 16:9 only, but this keeps the sizes in one place. */
export const PAD = 128;

// ---------------------------------------------------------------------------
// Plates
// ---------------------------------------------------------------------------

/**
 * A piece of real app footage in a window frame.
 *
 * Everything in this film that looks like the product is the product: the
 * plates come out of the running editor (scripts/capture-features*.js) and are
 * cropped to the one region the beat is about (scripts/crop-features.js), which
 * is the difference between a readable panel and a grey slab.
 */
export const Shot: React.FC<{
  src: string;
  width: number;
  local?: number;
  delay?: number;
  /** Ken Burns amount across the scene, 0 to switch it off. */
  drift?: number;
  from?: "left" | "right" | "up";
  title?: string;
  radius?: number;
  glow?: string;
  style?: React.CSSProperties;
  /** Cuts the plate off at this height and fades the bottom edge out. */
  fadeBottom?: number;
}> = ({
  src,
  width,
  local = 999,
  delay = 0,
  drift = 0.04,
  from = "right",
  title,
  radius = 16,
  glow = "rgba(111,179,181,0.18)",
  style,
  fadeBottom,
}) => {
  const p = ramp(local, delay, 34, outQuint);
  const slide = from === "left" ? -70 : from === "right" ? 70 : 0;
  const lift = from === "up" ? 60 : 0;
  // A long, slow push. Starts a touch wide so the last frame is the sharpest.
  const k = clamp((local - delay) / 150);
  const zoom = 1 + drift * (1 - k);
  return (
    <div
      style={{
        position: "relative",
        width,
        borderRadius: radius,
        overflow: "hidden",
        background: "#0B1112",
        border: `1px solid ${V.stroke}`,
        boxShadow: `0 46px 130px rgba(0,0,0,0.7), 0 0 80px ${glow}`,
        opacity: p,
        transform: `translate3d(${(1 - p) * slide}px, ${(1 - p) * lift}px, 0) scale(${
          0.97 + p * 0.03
        })`,
        ...style,
      }}
    >
      {title ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderBottom: `1px solid ${V.strokeSoft}`,
            background: "rgba(255,255,255,0.03)",
            fontFamily: F_BODY,
            fontSize: 15,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: V.dim,
          }}
        >
          <span style={{ display: "flex", gap: 5 }}>
            {["#3A4445", "#3A4445", "#3A4445"].map((c, i) => (
              <span key={i} style={{ width: 7, height: 7, borderRadius: 99, background: c }} />
            ))}
          </span>
          {title}
        </div>
      ) : null}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          maxHeight: fadeBottom,
          WebkitMaskImage: fadeBottom
            ? "linear-gradient(180deg, #000 76%, rgba(0,0,0,0) 100%)"
            : undefined,
        }}
      >
        <Img
          src={staticFile(`features/${src}.png`)}
          style={{
            display: "block",
            width: "100%",
            transform: `scale(${zoom})`,
            transformOrigin: "50% 40%",
          }}
        />
      </div>
    </div>
  );
};

/** Small floating panel that overlaps a Shot, for the detail inside a beat. */
export const Inset: React.FC<{
  children: React.ReactNode;
  local?: number;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ children, local = 999, delay = 0, style }) => {
  const p = ramp(local, delay, 26, outQuint);
  return (
    <div
      style={{
        position: "absolute",
        borderRadius: 14,
        overflow: "hidden",
        border: `1px solid rgba(255,255,255,0.14)`,
        boxShadow: "0 30px 80px rgba(0,0,0,0.75)",
        background: "#0B1112",
        opacity: p,
        transform: `translateY(${(1 - p) * 22}px) scale(${0.94 + p * 0.06})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Release rail
// ---------------------------------------------------------------------------

/** The gold date chip that labels every second-act beat. */
export const DateChip: React.FC<{ children: React.ReactNode; local?: number; delay?: number }> = ({
  children,
  local = 999,
  delay = 0,
}) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      padding: "7px 16px 8px",
      borderRadius: 99,
      border: `1px solid rgba(212,175,55,0.42)`,
      background: "rgba(212,175,55,0.10)",
      fontFamily: F_MONO,
      fontSize: 21,
      letterSpacing: "0.08em",
      color: V.goldSoft,
      ...rise(local, delay, 22, 14),
    }}
  >
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: 99,
        background: V.gold,
        boxShadow: `0 0 14px ${V.gold}`,
      }}
    />
    {children}
  </div>
);

/**
 * The release timeline that rides the whole second act.
 *
 * One node per entry in RELEASES, drawn once and lit as the film reaches it, so
 * the beats read as a run of dated releases rather than a list of features.
 * `active` is an index; anything before it is already spent.
 */
export const Rail: React.FC<{
  items: { date: string; label: string }[];
  active: number;
  opacity?: number;
  reveal?: number;
  width?: number;
}> = ({ items, active, opacity = 1, reveal = 1, width = 1920 - PAD * 2 }) => {
  const gap = width / (items.length - 1);
  return (
    <div style={{ position: "relative", width, height: 74, opacity }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 22,
          width,
          height: 1,
          background: "rgba(255,255,255,0.12)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 22,
          width: width * clamp(reveal),
          height: 1,
          background: `linear-gradient(90deg, ${V.tealDeep}, ${V.gold})`,
          boxShadow: `0 0 18px rgba(212,175,55,0.5)`,
        }}
      />
      {items.map((item, i) => {
        const at = i * gap;
        const on = i <= active;
        const isNow = i === active;
        return (
          <div
            key={item.date}
            style={{
              position: "absolute",
              left: at,
              top: 0,
              transform: "translateX(-50%)",
              textAlign: "center",
              opacity: reveal >= i / (items.length - 1) ? 1 : 0,
            }}
          >
            <div
              style={{
                width: isNow ? 13 : 8,
                height: isNow ? 13 : 8,
                margin: isNow ? "16px auto 0" : "18px auto 0",
                borderRadius: 99,
                background: isNow ? V.gold : on ? V.teal : "rgba(255,255,255,0.22)",
                boxShadow: isNow ? `0 0 20px ${V.gold}` : "none",
              }}
            />
            <div
              style={{
                marginTop: 12,
                fontFamily: F_MONO,
                fontSize: 17,
                letterSpacing: "0.06em",
                whiteSpace: "nowrap",
                color: isNow ? V.goldSoft : on ? V.sub : V.dim,
              }}
            >
              {item.date}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Type extras
// ---------------------------------------------------------------------------

/** A number that counts up into place, for the hook. */
export const Stat: React.FC<{
  value: number;
  label: string;
  local: number;
  delay?: number;
}> = ({ value, label, local, delay = 0 }) => {
  const p = ramp(local, delay, 40, outQuint);
  const shown = Math.round(value * p);
  return (
    <div style={{ ...rise(local, delay, 26, 22) }}>
      <div
        style={{
          fontFamily: F_HEAD,
          fontWeight: 700,
          fontSize: 92,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          color: V.ink,
        }}
      >
        {shown}
      </div>
      <div
        style={{
          marginTop: 12,
          fontFamily: F_BODY,
          fontSize: 22,
          letterSpacing: "0.02em",
          color: V.sub,
          maxWidth: 240,
        }}
      >
        {label}
      </div>
    </div>
  );
};

/** One line of the scoreboard, with the tick landing on its own beat. */
export const TickRow: React.FC<{
  children: React.ReactNode;
  local: number;
  delay: number;
  accent?: string;
}> = ({ children, local, delay, accent = V.teal }) => {
  const p = ramp(local, delay, 22, outQuint);
  const pop = ramp(local, delay + 4, 16, outQuint);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "13px 0",
        borderBottom: `1px solid ${V.strokeSoft}`,
        opacity: p,
        transform: `translateX(${(1 - p) * 22}px)`,
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          width: 30,
          height: 30,
          borderRadius: 99,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `${accent}22`,
          border: `1px solid ${accent}66`,
          transform: `scale(${0.6 + pop * 0.4})`,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M3 8.4 6.3 11.6 13 4.8"
            stroke={accent}
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="16"
            strokeDashoffset={16 * (1 - pop)}
          />
        </svg>
      </span>
      <span style={{ fontFamily: F_BODY, fontSize: 27, color: V.ink, lineHeight: 1.3 }}>
        {children}
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Drawn pieces, for the beats no screenshot can carry
// ---------------------------------------------------------------------------

/**
 * Two displays side by side, the editor on one and the torn off dock on the
 * other. Drawn rather than photographed because a second monitor is a fact
 * about the desk, not about the app, and no capture can show it.
 */
export const Monitors: React.FC<{
  local: number;
  delay?: number;
  main: React.ReactNode;
  side: React.ReactNode;
  scale?: number;
}> = ({ local, delay = 0, main, side, scale = 1 }) => {
  const p = ramp(local, delay, 30, outQuint);
  const q = ramp(local, delay + 22, 34, outQuint);
  const screen = (w: number, h: number, child: React.ReactNode, shift: number) => (
    <div
      style={{
        width: w,
        transform: `translateY(${(1 - p) * shift}px)`,
      }}
    >
      <div
        style={{
          width: w,
          height: h,
          borderRadius: 12,
          overflow: "hidden",
          background: "#0A0F10",
          border: `1px solid rgba(255,255,255,0.13)`,
          boxShadow: "0 40px 110px rgba(0,0,0,0.7)",
        }}
      >
        {child}
      </div>
      {/* Stand */}
      <div style={{ width: w * 0.16, height: 16, margin: "0 auto", background: "#1B2223" }} />
      <div
        style={{
          width: w * 0.34,
          height: 8,
          margin: "0 auto",
          borderRadius: 4,
          background: "#222A2B",
        }}
      />
    </div>
  );
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 40,
        opacity: p,
        transform: `scale(${scale})`,
        transformOrigin: "50% 100%",
      }}
    >
      {screen(760, 470, main, 30)}
      <div style={{ opacity: q, transform: `translateX(${(1 - q) * 40}px)` }}>
        {screen(300, 400, side, 18)}
      </div>
    </div>
  );
};

/** The other half of the live editing beat: two people, one board. */
export const CollabBoard: React.FC<{ local: number; delay?: number }> = ({ local, delay = 0 }) => {
  const p = ramp(local, delay, 30, outQuint);
  const t = Math.max(0, local - delay) / 30;
  const people = [
    { name: "Sam", color: V.teal, x: 0.28, y: 0.34, phase: 0 },
    { name: "Ash", color: V.gold, x: 0.66, y: 0.6, phase: 2.4 },
  ];
  return (
    <div
      style={{
        position: "relative",
        width: 900,
        height: 470,
        borderRadius: 16,
        background: "#0B1112",
        border: `1px solid ${V.stroke}`,
        boxShadow: "0 46px 130px rgba(0,0,0,0.7)",
        opacity: p,
        overflow: "hidden",
      }}
    >
      {/* Three artboards, the shape of the canvas without the chrome */}
      <div style={{ display: "flex", gap: 26, padding: "44px 40px" }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 380,
              borderRadius: 10,
              background: i === 1 ? "#111A1B" : "#0E1516",
              border: `1px solid ${i === 1 ? "rgba(111,179,181,0.45)" : V.strokeSoft}`,
            }}
          >
            <div
              style={{
                margin: "26px 22px 0",
                height: 16,
                borderRadius: 4,
                background: i === 1 ? "rgba(212,175,55,0.75)" : "rgba(255,255,255,0.16)",
                width: i === 1 ? "72%" : "58%",
              }}
            />
            <div
              style={{
                margin: "12px 22px 0",
                height: 10,
                borderRadius: 4,
                background: "rgba(255,255,255,0.10)",
                width: "44%",
              }}
            />
            <div
              style={{
                margin: "26px auto 0",
                width: "62%",
                height: 236,
                borderRadius: 18,
                background: "#0A1011",
                border: `1px solid rgba(255,255,255,0.09)`,
              }}
            />
          </div>
        ))}
      </div>

      {people.map((person) => {
        const x = (person.x + Math.sin(t * 0.9 + person.phase) * 0.045) * 900;
        const y = (person.y + Math.cos(t * 0.7 + person.phase) * 0.05) * 470;
        return (
          <div key={person.name} style={{ position: "absolute", left: x, top: y }}>
            <svg width="26" height="30" viewBox="0 0 26 30" style={{ display: "block" }}>
              <path
                d="M3 2 L3 23 L9 18 L13 27 L17 25 L13 16 L21 15 Z"
                fill={person.color}
                stroke="#05090A"
                strokeWidth="1.4"
              />
            </svg>
            <div
              style={{
                marginTop: 2,
                marginLeft: 14,
                padding: "3px 10px 4px",
                borderRadius: 7,
                background: person.color,
                color: "#06110F",
                fontFamily: F_BODY,
                fontWeight: 600,
                fontSize: 16,
                whiteSpace: "nowrap",
              }}
            >
              {person.name}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * The operator dashboard, rebuilt rather than screenshotted: it only exists
 * against a running box with real accounts on it, and this is a promo, not a
 * report. The numbers are obviously round for the same reason.
 */
export const DashCard: React.FC<{ local: number; delay?: number; style?: React.CSSProperties }> = ({
  local,
  delay = 0,
  style,
}) => {
  const p = ramp(local, delay, 28, outQuint);
  const tiles = [
    { label: "Posts", value: "1,284" },
    { label: "People", value: "310" },
    { label: "Storage", value: "6.4 GB" },
  ];
  return (
    <div
      style={{
        width: 470,
        padding: "22px 24px 26px",
        borderRadius: 14,
        background: "#0B1112",
        border: `1px solid ${V.stroke}`,
        boxShadow: "0 30px 90px rgba(0,0,0,0.75)",
        opacity: p,
        transform: `translateY(${(1 - p) * 20}px)`,
        ...style,
      }}
    >
      <div
        style={{
          fontFamily: F_BODY,
          fontSize: 15,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: V.dim,
        }}
      >
        Your feed, your dashboard
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 16 }}>
        {tiles.map((tile) => (
          <div
            key={tile.label}
            style={{
              flex: 1,
              padding: "12px 14px 14px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${V.strokeSoft}`,
            }}
          >
            <div style={{ fontFamily: F_HEAD, fontWeight: 700, fontSize: 30, color: V.ink }}>
              {tile.value}
            </div>
            <div style={{ marginTop: 4, fontFamily: F_BODY, fontSize: 15, color: V.sub }}>
              {tile.label}
            </div>
          </div>
        ))}
      </div>
      {/* A week of growth, drawn from a fixed seed so renders match */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 74, marginTop: 18 }}>
        {Array.from({ length: 14 }, (_, i) => {
          const h = (0.32 + rnd(i * 5.1) * 0.5 + i * 0.022) * 74;
          const grow = clamp((ramp(local, delay + 10 + i * 2, 22, outQuint)));
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: h * grow,
                borderRadius: 3,
                background: i > 10 ? V.gold : V.tealDeep,
                opacity: 0.85,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

/**
 * A row of counted chips, for the template beat.
 *
 * The numbers are the counts the start dialog shows on its own tabs; they are
 * typeset here rather than cropped from it because a 46px tall strip of real
 * tab bar is unreadable at any size that fits beside a headline.
 */
export const CountChips: React.FC<{
  items: { n: number; label: string }[];
  local: number;
  delay?: number;
}> = ({ items, local, delay = 0 }) => (
  <div style={{ display: "flex", gap: 10, flexWrap: "nowrap" }}>
    {items.map((item, i) => {
      const p = ramp(local, delay + i * 5, 22, outQuint);
      return (
        <div
          key={item.label}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 9,
            padding: "8px 15px 10px",
            borderRadius: 99,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${V.stroke}`,
            opacity: p,
            transform: `translateY(${(1 - p) * 14}px)`,
          }}
        >
          <span style={{ fontFamily: F_HEAD, fontWeight: 700, fontSize: 24, color: V.gold }}>
            {item.n}
          </span>
          <span style={{ fontFamily: F_BODY, fontSize: 19, color: V.sub, whiteSpace: "nowrap" }}>
            {item.label}
          </span>
        </div>
      );
    })}
  </div>
);

/**
 * The agent prompt, retypeset.
 *
 * The dialog itself is 1400 CSS px wide, and nothing that wide is legible in a
 * 1920 frame beside a column of copy, so the beat shows the real dialog softly
 * behind and puts the one line that matters at a size you can actually read.
 * The words are the app's own placeholder, not an invented example.
 */
export const PromptCard: React.FC<{
  local: number;
  delay?: number;
  children: React.ReactNode;
  width?: number;
}> = ({ local, delay = 0, children, width = 820 }) => {
  const p = ramp(local, delay, 30, outQuint);
  const caret = Math.floor(local / 8) % 2 === 0 ? 1 : 0.15;
  return (
    <div
      style={{
        width,
        padding: "26px 30px 30px",
        borderRadius: 16,
        background: "rgba(8,14,15,0.94)",
        border: `1px solid rgba(212,175,55,0.32)`,
        boxShadow: "0 40px 110px rgba(0,0,0,0.8), 0 0 70px rgba(212,175,55,0.12)",
        opacity: p,
        transform: `translateY(${(1 - p) * 24}px)`,
      }}
    >
      <div
        style={{
          fontFamily: F_BODY,
          fontSize: 16,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: V.dim,
        }}
      >
        Tell the agent what you want
      </div>
      <div
        style={{
          marginTop: 16,
          fontFamily: F_MONO,
          fontSize: 27,
          lineHeight: 1.45,
          color: V.ink,
        }}
      >
        {children}
        <span style={{ color: V.gold, opacity: caret }}>▌</span>
      </div>
    </div>
  );
};

/** A terminal line, for the one MCP command that starts the whole thing. */
export const Terminal: React.FC<{
  local: number;
  delay?: number;
  children: React.ReactNode;
  width?: number;
  style?: React.CSSProperties;
}> = ({ local, delay = 0, children, width = 760, style }) => {
  const p = ramp(local, delay, 26, outQuint);
  return (
    <div
      style={{
        width,
        borderRadius: 12,
        overflow: "hidden",
        background: "rgba(6,11,12,0.96)",
        border: `1px solid rgba(111,179,181,0.35)`,
        boxShadow: "0 30px 80px rgba(0,0,0,0.8)",
        opacity: p,
        transform: `translateY(${(1 - p) * 18}px)`,
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "10px 14px",
          borderBottom: `1px solid ${V.strokeSoft}`,
        }}
      >
        {["#3A4445", "#3A4445", "#3A4445"].map((c, i) => (
          <span key={i} style={{ width: 8, height: 8, borderRadius: 99, background: c }} />
        ))}
      </div>
      <div
        style={{
          padding: "16px 18px 18px",
          fontFamily: F_MONO,
          fontSize: 20,
          lineHeight: 1.5,
          color: V.teal,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: V.dim }}>$ </span>
        {children}
      </div>
    </div>
  );
};

/** Horizontal light sweep, used as the accent under a headline. */
export const Underline: React.FC<{ local: number; delay?: number; width?: number }> = ({
  local,
  delay = 0,
  width = 260,
}) => {
  const p = ramp(local, delay, 26, outQuint);
  return (
    <div
      style={{
        width: width * p,
        height: 3,
        borderRadius: 2,
        background: `linear-gradient(90deg, ${V.gold}, rgba(212,175,55,0))`,
      }}
    />
  );
};

/** Two-column beat layout: copy on one side, footage on the other. */
export const Split: React.FC<{
  copy: React.ReactNode;
  visual: React.ReactNode;
  side?: "left" | "right";
  gap?: number;
  copyWidth?: number;
  align?: "center" | "flex-start";
  /** Lifts the beat off centre, so the release rail has the bottom to itself. */
  offsetY?: number;
}> = ({ copy, visual, side = "right", gap = 88, copyWidth = 620, align = "center", offsetY = 0 }) => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        flexDirection: side === "right" ? "row" : "row-reverse",
        alignItems: align,
        justifyContent: "center",
        gap,
        padding: `0 ${PAD}px`,
        width,
        height,
        transform: `translateY(${offsetY}px)`,
      }}
    >
      <div style={{ flex: `0 0 ${copyWidth}px`, maxWidth: copyWidth }}>{copy}</div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: side === "right" ? "flex-start" : "flex-end",
          position: "relative",
        }}
      >
        {visual}
      </div>
    </AbsoluteFill>
  );
};
