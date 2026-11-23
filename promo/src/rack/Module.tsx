import React from "react";
import { ACCENTS, BEAT, C, F_MONO, F_SANS, FACES, G, STEP, clamp, landFrame, perChar, ramp, rnd, signalFrame } from "./style";
import { Jack, Knob, KnobTone, Led, Screw, Toggle, Tri } from "./kit";
import { FEATURES } from "./copy";
import { DEMOS } from "./demos";

/**
 * One rack module: a pastel face with the feature's name, a line of plain
 * words, a small screen and the hardware around it. The screen goes from
 * STANDBY to BOOT to the feature's own demo once the module is patched.
 * Drawn at G.MW x G.MH in its own px; the rack places it.
 */

export const SCREEN = { x: 44, y: 200, w: 560, h: 196 };
/** Jack centres in module px, used by the cables. */
export const JACK_TOP = { x: 52, y: 40 };
export const JACK_BOTTOM = { x: 50, y: 440 };

/** How many characters of `text` have been typed at local frame `f`. */
export const typed = (text: string, f: number, perChar = 1.6) =>
  text.slice(0, clamp(Math.floor(f / perChar), 0, text.length));

const KNOB_TONES: [KnobTone, KnobTone][] = [
  ["white", "dark"], ["dark", "coral"], ["dark", "white"], ["white", "coral"], ["white", "dark"], ["dark", "white"],
];

export const Module: React.FC<{ k: number; frame: number }> = ({ k, frame }) => {
  const face = FACES[k];
  const accent = ACCENTS[k];
  const feat = FEATURES[k];
  const land = landFrame(k);
  const local = frame - land;
  const ink = face.dark ? "#F3EFE8" : C.ink;
  const sub = face.dark ? "rgba(243,239,232,0.78)" : C.inkSub;
  const patched = local >= STEP.patched;
  const command = `/add ${feat.name}`;
  const typing = typed(command, local - STEP.typeFrom, perChar(command));
  const cursorOn = Math.floor(frame / 16) % 2 === 0;
  const [toneA, toneB] = KNOB_TONES[k % KNOB_TONES.length];
  // knobs settle to their own angle when the module boots, then drift with the demo
  const boot = ramp(local, STEP.boot, 26);
  const wob = (s: number) => Math.sin((frame + s * 50) / (38 + s * 7)) * 9 * clamp((local - STEP.patched) / 20);
  const angleA = -140 + boot * (130 + rnd(k * 3) * 120) + wob(1);
  const angleB = -140 + boot * (90 + rnd(k * 5) * 160) + wob(2);
  const angleC = -120 + boot * (60 + rnd(k * 7) * 180) + wob(3);
  const Demo = DEMOS[k];
  // the wide shot's signal reaches this module at the end of its cable
  const arrive = signalFrame(k) + BEAT / 4;
  const pulse = frame >= arrive ? Math.exp(-(frame - arrive) / 7) : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: G.MW,
        height: G.MH,
        borderRadius: 10,
        background: `linear-gradient(172deg, ${face.a} 0%, ${face.b} 100%)`,
        boxShadow: face.dark
          ? "inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -2px 0 rgba(0,0,0,0.35)"
          : "inset 0 1px 0 rgba(255,255,255,0.8), inset 0 -2px 0 rgba(0,0,0,0.08)",
        overflow: "hidden",
        fontFamily: F_SANS,
      }}
    >
      {/* faint sheen across the face */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(115deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.08) 100%)",
        }}
      />
      <Screw x={16} y={16} dark={face.dark} turn={20 + k * 13} />
      <Screw x={G.MW - 16} y={16} dark={face.dark} turn={60 + k * 7} />
      <Screw x={16} y={G.MH - 16} dark={face.dark} turn={110 + k * 11} />
      <Screw x={G.MW - 16} y={G.MH - 16} dark={face.dark} turn={150 + k * 5} />

      <Jack x={JACK_TOP.x} y={JACK_TOP.y} d={30} dark={face.dark} />
      <Tri x={84} y={41} s={15} color={face.dark ? "rgba(255,255,255,0.55)" : "rgba(40,38,36,0.55)"} />
      <div style={{ position: "absolute", left: 100, top: 37, width: 74, height: 6, borderRadius: 3, background: accent }} />
      <Led x={G.MW - 92} y={40} color={C.green} on={patched ? 1 : 0} />
      <Led
        x={G.MW - 62}
        y={40}
        color="#FFFFFF"
        on={patched ? 0.4 + 0.6 * (Math.sin((frame + k * 17) / 7) > 0.2 ? 1 : 0.2) : local > 0 ? 0.3 : 0}
      />

      <div
        style={{
          position: "absolute",
          left: 42,
          top: 62,
          fontSize: feat.name.length > 15 ? 66 : 74,
          fontWeight: 800,
          letterSpacing: "-0.035em",
          lineHeight: 1,
          color: ink,
          whiteSpace: "nowrap",
        }}
      >
        {feat.name}
      </div>
      <div
        style={{
          position: "absolute",
          left: 44,
          top: 146,
          fontSize: 31,
          fontWeight: 500,
          letterSpacing: "-0.012em",
          color: sub,
          whiteSpace: "nowrap",
        }}
      >
        {feat.sub}
      </div>

      <Screen k={k} local={local} frame={frame} name={feat.name} Demo={Demo} />

      <Knob x={690} y={256} d={86} tone={toneA} angle={angleA} />
      <Knob x={800} y={256} d={86} tone={toneB} angle={angleB} />
      <Toggle x={690} y={350} up={patched} />
      <Knob x={800} y={352} d={50} tone={face.dark ? "dark" : "white"} angle={angleC} />

      <Jack x={JACK_BOTTOM.x} y={JACK_BOTTOM.y} d={28} dark={face.dark} />
      <Jack x={88} y={JACK_BOTTOM.y} d={28} dark={face.dark} />
      <Tri x={120} y={JACK_BOTTOM.y + 1} s={14} color={face.dark ? "rgba(255,255,255,0.5)" : "rgba(40,38,36,0.5)"} />
      {/* the module's own little terminal line */}
      <div
        style={{
          position: "absolute",
          left: 140,
          top: 420,
          width: 520,
          height: 40,
          borderRadius: 7,
          background: "#161615",
          boxShadow: "inset 0 2px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.25)",
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          fontFamily: F_MONO,
          fontSize: 19,
          color: "#DAD6CE",
          whiteSpace: "pre",
          overflow: "hidden",
        }}
      >
        <span style={{ color: "#8E8981" }}>{"> "}</span>
        <span>{patched ? command : typing}</span>
        {!patched && cursorOn ? <span style={{ display: "inline-block", width: 10, height: 20, background: C.coral, marginLeft: 2 }} /> : null}
        <span style={{ flex: 1 }} />
        {patched ? (
          <span style={{ color: C.green, opacity: ramp(local, STEP.patched, 8) }}>{"✓ patched"}</span>
        ) : null}
      </div>
      <div
        style={{
          position: "absolute",
          right: 46,
          top: 420,
          fontFamily: F_MONO,
          fontSize: 30,
          fontWeight: 500,
          color: ink,
          opacity: 0.85,
        }}
      >
        {String(k + 1).padStart(2, "0")}
      </div>
      {pulse > 0.01 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 10,
            background: "radial-gradient(ellipse at 8% 10%, rgba(255,255,255,0.95), rgba(255,255,255,0.35) 45%, rgba(255,255,255,0.12))",
            opacity: pulse * 0.55,
          }}
        />
      ) : null}
    </div>
  );
};

const Screen: React.FC<{
  k: number;
  local: number;
  frame: number;
  name: string;
  Demo: React.FC<{ f: number; frame: number }>;
}> = ({ k, local, frame, name, Demo }) => {
  const booting = local >= STEP.boot && local < STEP.patched;
  const live = local >= STEP.patched;
  const bootP = ramp(local, STEP.boot, STEP.patched - STEP.boot - 2, (t) => t);
  // a glare sweeps across the glass as the module boots
  const sweep = clamp((local - STEP.boot) / 26);
  const num = String(k + 1).padStart(2, "0");
  return (
    <div
      style={{
        position: "absolute",
        left: SCREEN.x,
        top: SCREEN.y,
        width: SCREEN.w,
        height: SCREEN.h,
        borderRadius: 18,
        background: "linear-gradient(180deg, #3B3936, #23211F)",
        boxShadow: "0 2px 0 rgba(255,255,255,0.35), 0 6px 14px rgba(40,20,10,0.28)",
        padding: 6,
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 13,
          overflow: "hidden",
          background: C.screen,
          boxShadow: "inset 0 3px 10px rgba(0,0,0,0.85)",
        }}
      >
        {!live ? (
          <>
            {/* grid */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
                backgroundSize: "28px 28px",
              }}
            />
            <div style={{ position: "absolute", left: 14, top: 10, display: "flex", alignItems: "center", gap: 7 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: booting ? C.green : C.coral,
                  boxShadow: `0 0 6px ${booting ? C.green : C.coral}`,
                }}
              />
              <span style={{ fontFamily: F_MONO, fontSize: 12, color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em" }}>
                {booting ? `BOOT · ${num}` : "STANDBY"}
              </span>
            </div>
            <span
              style={{
                position: "absolute",
                right: 14,
                top: 10,
                fontFamily: F_MONO,
                fontSize: 12,
                color: "rgba(255,255,255,0.45)",
              }}
            >
              {booting ? `${Math.round(bootP * 100)}%` : num}
            </span>
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 14,
              }}
            >
              <span
                style={{
                  fontFamily: F_SANS,
                  fontWeight: 800,
                  fontSize: name.length > 15 ? 36 : 42,
                  letterSpacing: "-0.03em",
                  color: booting ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.2)",
                  textShadow: booting ? "0 0 18px rgba(255,255,255,0.25)" : "none",
                }}
              >
                {name}
              </span>
              <div
                style={{
                  width: 300,
                  height: 5,
                  borderRadius: 3,
                  background: "rgba(255,255,255,0.1)",
                  opacity: booting ? 1 : 0,
                  overflow: "hidden",
                }}
              >
                <div style={{ width: `${bootP * 100}%`, height: "100%", background: C.green, boxShadow: `0 0 8px ${C.green}` }} />
              </div>
            </div>
          </>
        ) : (
          <Demo f={local - STEP.patched} frame={frame} />
        )}
        {/* glass: the boot glare, then a still reflection */}
        <div
          style={{
            position: "absolute",
            top: -40,
            bottom: -40,
            width: 160,
            left: -200 + sweep * 760,
            background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.32), rgba(255,255,255,0))",
            transform: "skewX(-18deg)",
            opacity: sweep > 0 && sweep < 1 ? 1 : 0,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 13,
            background: "linear-gradient(160deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0) 35%)",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
};
