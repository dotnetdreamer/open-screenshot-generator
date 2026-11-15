import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { CHAPTERS, F_BODY, F_HEAD, F_MONO, V, clamp, outExpo, outQuint, ramp, rnd, type Beat } from "./style";
import { FILES } from "./rects.generated";

export { Grain, Vignette, GridLines } from "../vs/ui";

/** Safe margin on the 1920 frame. */
export const PAD = 112;

export const GREEN = "#7FC8A0";
export const HUES = { teal: V.teal, gold: V.gold, green: GREEN } as const;
export type Hue = keyof typeof HUES;

const inOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** A camera move: a quick start, a long soft landing. */
export const camEase = (t: number) => {
  const c = clamp(t);
  return c < 0.35 ? inOutCubic(c / 0.35) * 0.55 : 0.55 + 0.45 * outQuint((c - 0.35) / 0.65);
};

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/**
 * A line of words that rise out of a mask one after another. `accent` is a
 * substring of `text` set in the accent colour; the rest stays ink.
 */
export const Words: React.FC<{
  text: string;
  accent?: string;
  accentColor?: string;
  local: number;
  delay?: number;
  stagger?: number;
  size: number;
  color?: string;
  weight?: number;
  font?: string;
  align?: "left" | "center";
  width?: number;
  lineHeight?: number;
  tracking?: string;
  shadow?: boolean;
}> = ({
  text,
  accent,
  accentColor = V.gold,
  local,
  delay = 0,
  stagger = 2.4,
  size,
  color = V.ink,
  weight = 700,
  font = F_HEAD,
  align = "left",
  width,
  lineHeight = 1.06,
  tracking = "-0.028em",
  shadow = true,
}) => {
  const words = text.split(" ");
  const accentWords = new Set<number>();
  if (accent) {
    const at = text.indexOf(accent);
    if (at >= 0) {
      const before = text.slice(0, at).split(" ").filter(Boolean).length;
      const count = accent.split(" ").length;
      for (let i = 0; i < count; i += 1) accentWords.add(before + i);
    }
  }
  return (
    <div
      style={{
        fontFamily: font,
        fontWeight: weight,
        fontSize: size,
        lineHeight,
        letterSpacing: tracking,
        color,
        textAlign: align,
        maxWidth: width,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: align === "center" ? "center" : "flex-start",
        columnGap: "0.26em",
        textShadow: shadow ? "0 6px 40px rgba(0,0,0,0.55)" : undefined,
      }}
    >
      {words.map((word, i) => {
        const p = ramp(local, delay + i * stagger, 20, outExpo);
        return (
          <span
            key={i}
            style={{ display: "inline-block", overflow: "hidden", paddingBottom: "0.08em", marginBottom: "-0.08em" }}
          >
            <span
              style={{
                display: "inline-block",
                transform: `translateY(${(1 - p) * 105}%)`,
                color: accentWords.has(i) ? accentColor : undefined,
              }}
            >
              {word}
            </span>
          </span>
        );
      })}
    </div>
  );
};

/** A plain line that fades and lifts in, for the supporting copy. */
export const Line: React.FC<{
  children: React.ReactNode;
  local: number;
  delay?: number;
  size?: number;
  color?: string;
  align?: "left" | "center";
  width?: number;
  weight?: number;
  font?: string;
}> = ({ children, local, delay = 0, size = 28, color = V.sub, align = "left", width, weight = 400, font = F_BODY }) => {
  const p = ramp(local, delay, 22, outQuint);
  return (
    <div
      style={{
        fontFamily: font,
        fontWeight: weight,
        fontSize: size,
        lineHeight: 1.42,
        color,
        textAlign: align,
        maxWidth: width,
        opacity: p,
        transform: `translateY(${(1 - p) * 18}px)`,
        textShadow: "0 4px 24px rgba(0,0,0,0.6)",
      }}
    >
      {children}
    </div>
  );
};

/** The two small labels a beat can carry: what is new, and what needs the desktop app. */
export const Chip: React.FC<{ kind: "new" | "desktop"; local: number; delay?: number }> = ({ kind, local, delay = 0 }) => {
  const p = ramp(local, delay, 18, outQuint);
  const isNew = kind === "new";
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        padding: "7px 15px 8px",
        borderRadius: 99,
        fontFamily: F_BODY,
        fontWeight: 600,
        fontSize: 18,
        letterSpacing: "0.02em",
        color: isNew ? "#1B1503" : V.ink,
        background: isNew ? `linear-gradient(135deg, ${V.goldSoft}, ${V.gold})` : "rgba(255,255,255,0.06)",
        border: isNew ? "none" : "1px solid rgba(255,255,255,0.16)",
        boxShadow: isNew ? "0 0 28px rgba(212,175,55,0.35)" : "none",
        opacity: p,
        transform: `translateY(${(1 - p) * 10}px) scale(${0.9 + 0.1 * p})`,
      }}
    >
      {isNew ? (
        <svg width="14" height="14" viewBox="0 0 16 16">
          <path d="M8 1.5 9.6 6.4 14.5 8 9.6 9.6 8 14.5 6.4 9.6 1.5 8 6.4 6.4Z" fill="#1B1503" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="2.5" width="13" height="9" rx="1.6" stroke={V.ink} strokeWidth="1.4" />
          <path d="M5.5 14h5M8 11.5V14" stroke={V.ink} strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
      {isNew ? "New" : "In the desktop app"}
    </div>
  );
};

/** Gold rule that draws itself under a headline. */
export const Rule: React.FC<{ local: number; delay?: number; width?: number; color?: string }> = ({
  local,
  delay = 0,
  width = 150,
  color = V.gold,
}) => (
  <div
    style={{
      width: width * ramp(local, delay, 24, outQuint),
      height: 3,
      borderRadius: 2,
      background: `linear-gradient(90deg, ${color}, rgba(212,175,55,0))`,
    }}
  />
);

/** The copy column every product beat shares: labels, headline, rule, supporting lines. */
export const BeatCopy: React.FC<{
  beat: Beat;
  local: number;
  hue?: Hue;
  width?: number;
  size?: number;
  align?: "left" | "center";
  /** When each supporting line arrives, if not one after the other. */
  subAt?: number[];
}> = ({ beat, local, hue = "teal", width = 600, size = 66, align = "left", subAt }) => {
  const accent = hue === "gold" ? V.goldSoft : HUES[hue];
  const chips = [beat.isNew ? "new" : null, beat.desktop ? "desktop" : null].filter(Boolean) as ("new" | "desktop")[];
  return (
    <div style={{ width, display: "flex", flexDirection: "column", alignItems: align === "center" ? "center" : "flex-start" }}>
      {chips.length ? (
        <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
          {chips.map((c, i) => (
            <Chip key={c} kind={c} local={local} delay={2 + i * 4} />
          ))}
        </div>
      ) : null}
      <Words text={beat.head} accent={beat.accent} accentColor={accent} local={local} delay={3} size={size} width={width} align={align} />
      <div style={{ marginTop: 22 }}>
        <Rule local={local} delay={14} color={accent} />
      </div>
      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 4 }}>
        {beat.sub.map((line, i) => (
          <Line key={line} local={local} delay={subAt?.[i] ?? 16 + i * 8} width={width} align={align}>
            {line}
          </Line>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// The app window and its camera
// ---------------------------------------------------------------------------

/** Captures are 1440 x 900 CSS px at 2x. */
export const CAP_W = 1440;
export const CAP_H = 900;

export type Rect = { x: number; y: number; w: number; h: number };
export type CamKey = { at: number; z: number; x?: number; y?: number; rect?: Rect; pad?: number };

/** Focus point and zoom for a keyframe; a rect becomes its centre and the zoom that fits it. */
function resolveKey(k: CamKey): { z: number; x: number; y: number } {
  if (k.rect) {
    const pad = k.pad ?? 1.25;
    const fit = Math.min(CAP_W / (k.rect.w * pad), CAP_H / (k.rect.h * pad));
    return { z: Math.max(1, Math.min(k.z || fit, fit)), x: k.rect.x + k.rect.w / 2, y: k.rect.y + k.rect.h / 2 };
  }
  return { z: k.z, x: k.x ?? CAP_W / 2, y: k.y ?? CAP_H / 2 };
}

/** The camera at a local frame: eased between keyframes, clamped so no edge of the capture shows. */
export function camAt(keys: CamKey[], local: number) {
  const ks = keys.map((k) => ({ at: k.at, ...resolveKey(k) }));
  let cur = ks[0];
  if (local >= ks[ks.length - 1].at) cur = ks[ks.length - 1];
  else {
    for (let i = 0; i < ks.length - 1; i += 1) {
      const a = ks[i];
      const b2 = ks[i + 1];
      if (local >= a.at && local < b2.at) {
        const p = camEase((local - a.at) / (b2.at - a.at));
        cur = { at: local, z: a.z + (b2.z - a.z) * p, x: a.x + (b2.x - a.x) * p, y: a.y + (b2.y - a.y) * p };
        break;
      }
    }
  }
  const halfW = CAP_W / 2 / cur.z;
  const halfH = CAP_H / 2 / cur.z;
  return { z: cur.z, x: clamp(cur.x, halfW, CAP_W - halfW), y: clamp(cur.y, halfH, CAP_H - halfH) };
}

/**
 * A window holding real app footage, with a camera inside it.
 *
 * The window frame stays put; the capture moves under it, so a push into one
 * button reads like a screen recording zooming in rather than like the window
 * flying at the viewer. Several captures crossfade in order (`shots`), and
 * anything passed as `overlay` is drawn in the capture's own CSS px, so rings
 * and the cursor stay glued to the UI they point at while the camera moves.
 */
export const AppWindow: React.FC<{
  local: number;
  width: number;
  shots: { src: string; at?: number }[];
  cam?: CamKey[];
  title?: string;
  enter?: number;
  overlay?: React.ReactNode;
  tilt?: number;
  glow?: string;
  style?: React.CSSProperties;
  /** The capture's own size, when it is not a 1440 x 900 window shot. */
  capture?: { w: number; h: number };
}> = ({ local, width, shots, cam = [{ at: 0, z: 1 }], title, enter = 0, overlay, tilt = 1, glow = "rgba(111,179,181,0.22)", style, capture }) => {
  const cw = capture?.w ?? CAP_W;
  const ch = capture?.h ?? CAP_H;
  const height = Math.round((width * ch) / cw);
  const barH = title === undefined ? 0 : 34;
  const p = ramp(local, enter, 30, outExpo);
  const c = capture ? { z: 1, x: cw / 2, y: ch / 2 } : camAt(cam, local);
  const k = width / cw;
  const tx = width / 2 - c.x * k * c.z;
  const ty = height / 2 - c.y * k * c.z;
  return (
    <div
      style={{
        width,
        height: height + barH,
        borderRadius: 14,
        overflow: "hidden",
        background: "#0B1011",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: `0 50px 140px rgba(0,0,0,0.72), 0 0 110px ${glow}`,
        opacity: p,
        transform: `perspective(2200px) rotateX(${(1 - p) * 9 * tilt}deg) rotateY(${(1 - p) * -12 * tilt}deg) translateY(${(1 - p) * 60}px) scale(${0.94 + 0.06 * p})`,
        transformOrigin: "50% 60%",
        ...style,
      }}
    >
      {barH ? (
        <div
          style={{
            height: barH,
            display: "flex",
            alignItems: "center",
            padding: "0 14px",
            gap: 8,
            background: "linear-gradient(180deg, #1A2021, #141A1B)",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            position: "relative",
          }}
        >
          {["#FF5F57", "#FEBC2E", "#28C840"].map((col) => (
            <span key={col} style={{ width: 12, height: 12, borderRadius: 99, background: col, opacity: 0.9 }} />
          ))}
          <span
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              textAlign: "center",
              fontFamily: F_BODY,
              fontWeight: 500,
              fontSize: 14,
              color: "rgba(244,248,247,0.62)",
            }}
          >
            {title}
          </span>
        </div>
      ) : null}
      <div style={{ position: "relative", width, height, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: cw,
            height: ch,
            transformOrigin: "0 0",
            transform: `translate(${tx}px, ${ty}px) scale(${k * c.z})`,
          }}
        >
          {shots.map((s, i) => {
            const next = shots[i + 1];
            const inP = i === 0 ? 1 : ramp(local, s.at ?? 0, 8, outQuint);
            const outP = next ? ramp(local, (next.at ?? 0) + 6, 4, outQuint) : 0;
            const o = inP * (1 - outP);
            if (o <= 0.001) return null;
            return (
              <Still
                key={s.src}
                src={s.src}
                style={{ position: "absolute", left: 0, top: 0, width: cw, height: ch, opacity: o }}
              />
            );
          })}
          {overlay}
        </div>
      </div>
    </div>
  );
};

/**
 * A footage image, or a labelled stand-in while the capture has not been made.
 * Only paths under features2/ are checked; anything else is assumed to ship.
 */
export const Still: React.FC<{ src: string; style?: React.CSSProperties }> = ({ src, style }) => {
  if (src.startsWith("features2/") && !FILES.has(src)) {
    return (
      <div
        style={{
          ...style,
          background: "repeating-linear-gradient(135deg, #10181A 0 22px, #0C1314 22px 44px)",
          border: "2px dashed rgba(212,175,55,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: F_MONO,
          fontSize: 26,
          color: V.goldSoft,
          boxSizing: "border-box",
        }}
      >
        {src}
      </div>
    );
  }
  return <Img src={staticFile(src)} style={style} />;
};

/** A ring that draws itself around a rect, in the capture's CSS px (put it in an AppWindow overlay). */
export const Ring: React.FC<{ rect: Rect; local: number; delay?: number; color?: string; pad?: number; radius?: number; hold?: number }> = ({
  rect,
  local,
  delay = 0,
  color = V.gold,
  pad = 6,
  radius = 10,
  hold = 999,
}) => {
  const p = ramp(local, delay, 16, outQuint);
  const out = ramp(local, delay + hold, 10, outQuint);
  if (p <= 0 || out >= 1) return null;
  const w = rect.w + pad * 2;
  const h = rect.h + pad * 2;
  const perim = 2 * (w + h);
  return (
    <svg
      style={{ position: "absolute", left: rect.x - pad - 4, top: rect.y - pad - 4, overflow: "visible", opacity: 1 - out }}
      width={w + 8}
      height={h + 8}
    >
      <rect
        x={4}
        y={4}
        width={w}
        height={h}
        rx={radius}
        fill="none"
        stroke={color}
        strokeWidth={2.4}
        strokeDasharray={perim}
        strokeDashoffset={perim * (1 - p)}
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />
    </svg>
  );
};

/** Dims everything outside a rect, so the eye lands on the one control that matters. */
export const Spot: React.FC<{ rect: Rect; local: number; delay?: number; amount?: number; w?: number; h?: number }> = ({
  rect,
  local,
  delay = 0,
  amount = 0.55,
  w = CAP_W,
  h = CAP_H,
}) => {
  const a = ramp(local, delay, 14, outQuint) * amount;
  if (a <= 0) return null;
  const shade = `rgba(3,6,7,${a})`;
  const r = { x: rect.x - 8, y: rect.y - 8, w: rect.w + 16, h: rect.h + 16 };
  return (
    <>
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: r.y, background: shade }} />
      <div style={{ position: "absolute", left: 0, top: r.y + r.h, width: w, height: h - r.y - r.h, background: shade }} />
      <div style={{ position: "absolute", left: 0, top: r.y, width: r.x, height: r.h, background: shade }} />
      <div style={{ position: "absolute", left: r.x + r.w, top: r.y, width: w - r.x - r.w, height: r.h, background: shade }} />
    </>
  );
};

export type CursorKey = { at: number; x: number; y: number; click?: boolean };

/**
 * The pointer, in capture px. Eased between waypoints, with a ripple and a
 * press on every click.
 */
export const Cursor: React.FC<{ keys: CursorKey[]; local: number; size?: number; appear?: number; vanish?: number }> = ({
  keys,
  local,
  size = 24,
  appear = 0,
  vanish = 9999,
}) => {
  let x = keys[0].x;
  let y = keys[0].y;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i];
    const b2 = keys[i + 1];
    if (local >= b2.at) {
      x = b2.x;
      y = b2.y;
    } else if (local >= a.at) {
      const p = inOutCubic(clamp((local - a.at) / (b2.at - a.at)));
      x = a.x + (b2.x - a.x) * p;
      y = a.y + (b2.y - a.y) * p;
      break;
    }
  }
  const o = ramp(local, appear, 8, outQuint) * (1 - ramp(local, vanish, 10, outQuint));
  const clicks = keys.filter((k) => k.click);
  const press = clicks.reduce((m, k) => {
    const d = local - k.at;
    return d >= 0 && d < 8 ? Math.max(m, 1 - Math.abs(d - 3) / 5) : m;
  }, 0);
  return (
    <>
      {clicks.map((k) => {
        const d = local - k.at;
        if (d < 0 || d > 22) return null;
        const q = d / 22;
        return (
          <div
            key={k.at}
            style={{
              position: "absolute",
              left: k.x - 30 * q - 6,
              top: k.y - 30 * q - 6,
              width: 12 + 60 * q,
              height: 12 + 60 * q,
              borderRadius: 999,
              border: `2.5px solid rgba(212,175,55,${0.9 * (1 - q)})`,
              background: `rgba(212,175,55,${0.18 * (1 - q)})`,
            }}
          />
        );
      })}
      <svg
        width={size}
        height={size * 1.3}
        viewBox="0 0 20 26"
        style={{
          position: "absolute",
          left: x - 2,
          top: y - 1,
          opacity: o,
          transform: `scale(${1 - press * 0.14})`,
          transformOrigin: "2px 1px",
          filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.55))",
        }}
      >
        <path d="M2 1.5v19.2l4.9-4.6 3.2 7.4 3.3-1.4-3.2-7.3 6.7-.2Z" fill="#fff" stroke="#111" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    </>
  );
};

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/**
 * A phone drawn in CSS around one of Juniper's screens. Used where the film
 * needs a phone the app is not drawing: the open, and the swipe through the
 * panorama. The 3D phones in chapter one are the app's own renders.
 */
export const Phone: React.FC<{
  src: string;
  width: number;
  rotY?: number;
  rotX?: number;
  rotZ?: number;
  style?: React.CSSProperties;
  screenStyle?: React.CSSProperties;
  children?: React.ReactNode;
  /** 0 to 1: a band of light crossing the glass, for the hero shots. */
  glare?: number;
}> = ({ src, width, rotY = 0, rotX = 0, rotZ = 0, style, screenStyle, children, glare }) => {
  const bezel = width * 0.032;
  const screenW = width - bezel * 2;
  const screenH = (screenW * 874) / 402;
  const radius = width * 0.16;
  return (
    <div
      style={{
        width,
        height: screenH + bezel * 2,
        borderRadius: radius,
        padding: bezel,
        background: "linear-gradient(145deg, #4A5254 0%, #22282A 38%, #0E1213 60%, #3A4244 100%)",
        boxShadow: `0 ${width * 0.12}px ${width * 0.3}px rgba(0,0,0,0.65), inset 0 0 0 ${Math.max(1, width * 0.004)}px rgba(255,255,255,0.18)`,
        transform: `perspective(${width * 6}px) rotateX(${rotX}deg) rotateY(${rotY}deg) rotateZ(${rotZ}deg)`,
        transformStyle: "preserve-3d",
        position: "relative",
        ...style,
      }}
    >
      <div
        style={{
          width: screenW,
          height: screenH,
          borderRadius: radius - bezel,
          overflow: "hidden",
          position: "relative",
          background: "#000",
          ...screenStyle,
        }}
      >
        <Img src={staticFile(src)} style={{ width: "100%", height: "100%", display: "block" }} />
        {children}
        <div
          style={{
            position: "absolute",
            top: screenW * 0.028,
            left: "50%",
            width: screenW * 0.31,
            height: screenW * 0.088,
            marginLeft: -screenW * 0.155,
            borderRadius: 99,
            background: "#050505",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(115deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 38%)",
            pointerEvents: "none",
          }}
        />
        {glare !== undefined && glare > 0 && glare < 1 ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: `linear-gradient(115deg, rgba(255,255,255,0) ${glare * 160 - 40}%, rgba(255,255,255,0.22) ${glare * 160 - 25}%, rgba(255,255,255,0) ${glare * 160 - 10}%)`,
              mixBlendMode: "screen",
            }}
          />
        ) : null}
      </div>
    </div>
  );
};

/** Juniper's icon: a sprig on forest green. */
export const JuniperIcon: React.FC<{ size: number; style?: React.CSSProperties }> = ({ size, style }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.225,
      background: "linear-gradient(150deg, #3E8A63 0%, #2D6A4F 55%, #1F4E3A 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: `0 ${size * 0.08}px ${size * 0.25}px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.12)`,
      ...style,
    }}
  >
    <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 64 64">
      <path d="M32 58V22" stroke="#F6F2E9" strokeWidth="4" strokeLinecap="round" />
      <path d="M32 40c-8-1-14-7-15-16 8 1 14 6 15 16zM32 32c8-1 14-7 15-16-8 1-14 6-15 16z" fill="#BFE3CC" />
      <circle cx="32" cy="15" r="6.5" fill="#7A80E6" />
      <circle cx="21" cy="47" r="4.5" fill="#4C55C9" />
      <circle cx="43" cy="45" r="4.5" fill="#4C55C9" />
    </svg>
  </div>
);

// ---------------------------------------------------------------------------
// Frame furniture
// ---------------------------------------------------------------------------

/** The chapter label in the top left, with three segments filling as the film goes. */
export const ChapterHud: React.FC<{ frame: number }> = ({ frame }) => {
  const idx = CHAPTERS.findIndex((c) => frame >= c.from && frame < c.to);
  const first = CHAPTERS[0].from;
  const last = CHAPTERS[CHAPTERS.length - 1].to;
  if (frame < first + 50 || frame >= last) return null;
  const o = ramp(frame, first + 50, 20, outQuint) * (1 - ramp(frame, last - 16, 16, outQuint));
  const ch = CHAPTERS[Math.max(0, idx)];
  const hue = HUES[ch.hue];
  const sinceStart = frame - ch.from;
  const swap = ramp(sinceStart, 0, 16, outExpo);
  return (
    <div style={{ position: "absolute", left: PAD, top: 52, opacity: o, display: "flex", alignItems: "center", gap: 18 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {CHAPTERS.map((c, i) => {
          const fill = i < idx ? 1 : i === idx ? clamp((frame - c.from) / (c.to - c.from)) : 0;
          return (
            <div key={c.n} style={{ width: 46, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.14)", overflow: "hidden" }}>
              <div style={{ width: `${fill * 100}%`, height: "100%", background: HUES[c.hue] }} />
            </div>
          );
        })}
      </div>
      <div
        style={{
          fontFamily: F_BODY,
          fontWeight: 600,
          fontSize: 19,
          letterSpacing: "0.04em",
          color: V.ink,
          opacity: swap,
          transform: `translateY(${(1 - swap) * 10}px)`,
          display: "flex",
          gap: 10,
          alignItems: "baseline",
        }}
      >
        <span style={{ fontFamily: F_MONO, color: hue }}>{ch.n}</span>
        <span>{ch.title}</span>
      </div>
    </div>
  );
};

/**
 * Wraps a scene in its entrance and exit, so two neighbours cross on every cut:
 * the old one pushes past the camera and blurs, the new one settles in from
 * slightly behind it.
 */
export const SceneFx: React.FC<{ local: number; len: number; children: React.ReactNode; hard?: boolean }> = ({
  local,
  len,
  children,
  hard,
}) => {
  const IN = hard ? 1 : 10;
  const pIn = ramp(local, 0, IN, outQuint);
  const pOut = ramp(local, len, 10, (t) => t * t);
  const scale = (1 - pIn) * -0.035 + pOut * 0.05 + 1;
  const blur = (1 - pIn) * 10 + pOut * 14;
  return (
    <AbsoluteFill
      style={{
        opacity: pIn * (1 - pOut),
        transform: `scale(${1 + (scale - 1)})`,
        filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** Backdrop: chapter coloured light pools, dust, grid, vignette, grain. */
export const Backdrop: React.FC<{
  frame: number;
  hueAt: (f: number) => { teal: number; gold: number; green: number };
  /** 0 to 1, how hard the light pools swell on this frame (the beat). */
  pulse?: number;
}> = ({ frame, hueAt, pulse = 0 }) => {
  const t = frame / 30;
  const raw = hueAt(frame);
  const lift = 1 + pulse * 0.35;
  const mix = { teal: raw.teal * lift, gold: raw.gold * lift, green: raw.green * lift };
  const pool = (rgb: string, a: number, x: number, y: number, s: number) =>
    `radial-gradient(${s}% ${s}% at ${x}% ${y}%, rgba(${rgb},${a}) 0%, rgba(${rgb},0) 72%)`;
  const layers = [
    pool("111,179,181", 0.2 * mix.teal, 30 + Math.sin(t * 0.33) * 8, 30 + Math.cos(t * 0.25) * 9, 48),
    pool("212,175,55", 0.2 * mix.gold + 0.07 * mix.teal, 70 + Math.cos(t * 0.29) * 7, 72 + Math.sin(t * 0.21) * 8, 52),
    pool("127,200,160", 0.2 * mix.green, 66 + Math.sin(t * 0.27) * 9, 28 + Math.cos(t * 0.31) * 7, 50),
    pool("111,179,181", 0.08 * (mix.gold + mix.green), 24, 80, 40),
  ];
  return (
    <AbsoluteFill style={{ background: V.bg }}>
      <AbsoluteFill style={{ background: layers.join(", ") }} />
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        {Array.from({ length: 30 }, (_, i) => {
          const x = rnd(i * 3.1) * 1920;
          const y = ((rnd(i * 7.7) * 1080 - t * (10 + rnd(i) * 22)) % 1160 + 1160) % 1160 - 40;
          const s = 1.2 + rnd(i * 2.3) * 2.6;
          const o = 0.18 + 0.45 * Math.abs(Math.sin(t * 0.6 + i));
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: s,
                height: s,
                borderRadius: 99,
                background: "rgba(232,206,122,0.7)",
                opacity: o,
                boxShadow: "0 0 8px rgba(232,206,122,0.6)",
              }}
            />
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** A full frame flash, for the crashes. */
export const Flash: React.FC<{ frame: number; at: number; strength?: number; color?: string }> = ({
  frame,
  at,
  strength = 0.3,
  color = "255,246,220",
}) => {
  const d = frame - at;
  if (d < 0 || d > 12) return null;
  const a = strength * Math.pow(1 - d / 12, 2.6);
  return <AbsoluteFill style={{ background: `rgba(${color},${a})`, pointerEvents: "none", mixBlendMode: "screen" }} />;
};

/**
 * Sparks thrown out from a point on a hit: deterministic, so every render of a
 * frame is the same frame.
 */
export const Burst: React.FC<{ local: number; x: number; y: number; count?: number; reach?: number; colors?: string[] }> = ({
  local,
  x,
  y,
  count = 46,
  reach = 520,
  colors = [V.goldSoft, V.gold, V.teal, "#FFFFFF"],
}) => {
  if (local < 0 || local > 50) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: count }, (_, i) => {
        const angle = rnd(i * 4.7) * Math.PI * 2;
        const speed = 0.35 + rnd(i * 9.1) * 0.65;
        const life = 26 + rnd(i * 2.9) * 22;
        const t = clamp(local / life);
        const d = outExpo(t) * reach * speed;
        const size = 2 + rnd(i * 6.3) * 4;
        const o = (1 - t) * (local < 2 ? local / 2 : 1);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x + Math.cos(angle) * d - size / 2,
              top: y + Math.sin(angle) * d * 0.8 - size / 2,
              width: size,
              height: size,
              borderRadius: 99,
              background: colors[i % colors.length],
              opacity: o,
              boxShadow: `0 0 ${size * 3}px ${colors[i % colors.length]}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** The local frame of the enclosing Sequence. */
export const useLocal = () => useCurrentFrame();
