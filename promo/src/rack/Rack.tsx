import React from "react";
import {
  C, COLS, FLOOR_Y, G, RACK_H, RACK_W, ROWS, ROW0, STEP,
  colX, landFrame, rowY, slotOf,
} from "./style";
import { Holes, Screw } from "./kit";
import { Module } from "./Module";
import { Header } from "./Header";
import { Cables } from "./Cables";
import { FEATURES } from "./copy";

/**
 * The world: a room (wall and floor) and the rack in it. The rack face is the
 * plane z = 0; positive z comes towards the camera. Everything here is placed
 * with absolute px in rack space and rendered inside the camera's 3D context.
 */

const abs = (x: number, y: number, w: number, h: number, extra?: React.CSSProperties): React.CSSProperties => ({
  position: "absolute",
  left: x,
  top: y,
  width: w,
  height: h,
  ...extra,
});

const WOOD_GRAIN =
  "repeating-linear-gradient(90deg, rgba(90,40,15,0.0) 0px, rgba(90,40,15,0.10) 2px, rgba(90,40,15,0.0) 5px, rgba(255,220,180,0.06) 9px, rgba(90,40,15,0.0) 13px)";

const Room: React.FC = () => (
  <>
    {/* wall, well behind the rack */}
    <div
      style={abs(RACK_W / 2 - 7000, -5200, 14000, 11000, {
        transform: "translateZ(-1500px)",
        background: `radial-gradient(ellipse 45% 30% at 50% 22%, rgba(255,226,200,0.85), rgba(255,226,200,0) 70%), linear-gradient(180deg, ${C.wallTop} 0%, ${C.wallMid} 48%, ${C.wallLow} 100%)`,
      })}
    />
    {/* floor, from the wall to well past the camera */}
    <div
      style={abs(RACK_W / 2 - 7000, FLOOR_Y, 14000, 9000, {
        transformOrigin: "50% 0",
        transform: "translateZ(-1500px) rotateX(90deg)",
        background: `linear-gradient(180deg, ${C.floorFar} 0%, ${C.floor} 22%, #E3BFCD 60%, #E8C7D2 100%)`,
      })}
    >
      {/* the rack's soft contact shadow, 1500 px from the wall */}
      <div
        style={abs(7000 - RACK_W / 2 - 160, 1500 - 300, RACK_W + 320, 600, {
          borderRadius: "50%",
          background: "radial-gradient(ellipse at 50% 50%, rgba(80,30,55,0.55), rgba(80,30,55,0.2) 45%, rgba(80,30,55,0) 72%)",
        })}
      />
      {/* where the light from the top left falls past the rack */}
      <div
        style={abs(7000 - RACK_W / 2 - 900, 1500 + 120, 1400, 1600, {
          borderRadius: "50%",
          background: "radial-gradient(ellipse at 50% 40%, rgba(255,226,214,0.45), rgba(255,226,214,0) 70%)",
        })}
      />
    </div>
  </>
);

const Upright: React.FC<{ side: "left" | "right" }> = ({ side }) => {
  const x = side === "left" ? 0 : RACK_W - G.WOOD;
  const h = RACK_H + 30;
  const face: React.CSSProperties = {
    background: `${WOOD_GRAIN}, linear-gradient(90deg, ${C.woodA} 0%, ${C.woodB} 45%, ${C.woodA} 100%)`,
  };
  return (
    <>
      <div
        style={abs(x, -10, G.WOOD, h, {
          ...face,
          borderRadius: 6,
          boxShadow: "inset 2px 0 0 rgba(255,210,170,0.35), inset -3px 0 0 rgba(60,25,10,0.35)",
        })}
      />
      {/* outer side face, going back from the front edge */}
      <div
        style={abs(side === "left" ? 0 : RACK_W, -10, G.WOOD_D, h, {
          ...face,
          background: `${WOOD_GRAIN}, linear-gradient(90deg, ${C.woodDark}, ${C.woodA})`,
          transformOrigin: "0 50%",
          transform: "rotateY(90deg)",
          filter: side === "left" ? "brightness(1.05)" : "brightness(0.78)",
        })}
      />
      {/* foot */}
      <div
        style={abs(x + 14, RACK_H + 20, G.WOOD - 28, FLOOR_Y - RACK_H - 20, {
          background: "linear-gradient(90deg, #1E1C1B, #3A3734 50%, #1E1C1B)",
          borderRadius: "4px 4px 10px 10px",
        })}
      />
    </>
  );
};

const Blank: React.FC<{ col: number; row: number }> = ({ col, row }) => (
  <div
    style={abs(colX(col), rowY(row), G.MW, G.MH, {
      transform: "translateZ(-4px)",
      borderRadius: 8,
      background:
        "repeating-linear-gradient(180deg, rgba(255,255,255,0.0) 0px, rgba(255,255,255,0.35) 2px, rgba(0,0,0,0.05) 3px, rgba(255,255,255,0.0) 6px), linear-gradient(180deg, #E2DFDB, #CFCBC6)",
      boxShadow: "inset 0 2px 8px rgba(0,0,0,0.18)",
    })}
  >
    {/* the vent in the middle of a blank panel */}
    <div
      style={abs(G.MW / 2 - 130, G.MH / 2 - 34, 260, 68, {
        backgroundImage: "radial-gradient(circle at 5px 5px, rgba(80,70,60,0.55) 2.6px, transparent 3.4px)",
        backgroundSize: "13px 13px",
        opacity: 0.8,
      })}
    />
    <Screw x={18} y={18} d={13} />
    <Screw x={G.MW - 18} y={18} d={13} turn={90} />
    <Screw x={18} y={G.MH - 18} d={13} turn={150} />
    <Screw x={G.MW - 18} y={G.MH - 18} d={13} turn={10} />
  </div>
);

const Rails: React.FC = () => {
  const inner = G.WOOD;
  const innerW = RACK_W - 2 * G.WOOD;
  const rail: React.CSSProperties = {
    background: `linear-gradient(180deg, #FBF8F2 0%, ${C.rail} 45%, ${C.railShade} 100%)`,
    boxShadow: "0 3px 6px rgba(70,40,30,0.18)",
  };
  return (
    <>
      {/* back of the rack, seen in the gaps */}
      <div style={abs(inner, G.CAP, innerW, RACK_H - G.CAP, { background: "#BDB6AE", transform: "translateZ(-14px)" })} />
      {/* top lid, its underside and the plinth */}
      <div
        style={abs(-12, -10, RACK_W + 24, G.CAP + 10, {
          background: "linear-gradient(180deg, #FFFFFF, #F1ECE3 70%, #DCD4C6)",
          borderRadius: 6,
          boxShadow: "0 6px 14px rgba(70,40,30,0.22)",
        })}
      />
      <div
        style={abs(-12, G.CAP, RACK_W + 24, G.WOOD_D, {
          background: "linear-gradient(180deg, #E8E1D5, #CFC6B7)",
          transformOrigin: "50% 0",
          transform: "rotateX(-90deg)",
        })}
      />
      <div style={abs(inner, RACK_H - G.BASE, innerW, G.BASE, { ...rail, borderRadius: 4 })}>
        <Holes x={30} y={G.BASE / 2} len={innerW - 60} pitch={22} d={6} />
      </div>
      {/* horizontal rails: under the header and between every row */}
      {Array.from({ length: ROWS + 1 }, (_, r) => {
        const y = r === 0 ? G.CAP + G.HEAD : rowY(r - 1) + G.MH;
        return (
          <div key={r} style={abs(inner, y, innerW, G.RAIL, rail)}>
            <Holes x={24} y={G.RAIL / 2} len={innerW - 48} pitch={20} d={5} />
          </div>
        );
      })}
      {/* vertical rails: against the wood and between the columns */}
      {Array.from({ length: COLS + 1 }, (_, c) => {
        const x = c === 0 ? G.WOOD : c === COLS ? RACK_W - G.WOOD - G.SIDE : colX(c) - G.CGAP;
        const w = c === 0 || c === COLS ? G.SIDE : G.CGAP;
        return (
          <div key={`v${c}`} style={abs(x, ROW0 - G.RAIL, w, RACK_H - G.BASE - ROW0 + G.RAIL, { ...rail, boxShadow: "none" })}>
            <Holes x={w / 2} y={16} len={RACK_H - G.BASE - ROW0} pitch={20} d={5} vertical />
          </div>
        );
      })}
    </>
  );
};

/**
 * Slide offset of module k at frame f: from below (columns 1, 3) or above
 * (column 2). It is still moving when it hits the stop on its landing frame,
 * on the beat, then rebounds a little and settles.
 */
const slide = (k: number, f: number) => {
  const local = f - landFrame(k);
  const { col } = slotOf(k);
  const dir = col === 1 ? -1 : 1;
  const far = (G.MH + G.RAIL) * 1.35;
  if (local < 0) {
    const u = Math.min(1, -local / -STEP.slideFrom);
    // fast at first, slowing, but still moving when it hits
    const d = 0.35 * u + 0.65 * u * u;
    return { dy: dir * d * far, dz: 2 + d * 140, moving: true };
  }
  const bounce = 16 * Math.exp(-local / 4.5) * Math.sin(local * 0.5);
  // never behind the blank panels
  return { dy: dir * bounce, dz: 2, moving: local < 18 };
};

/** Motion blur for a sliding module: copies along its path, averaged. */
const BLUR_SAMPLES = 9;
const SHUTTER = 0.75;

const PlacedModule: React.FC<{ k: number; frame: number }> = ({ k, frame }) => {
  const { col, row } = slotOf(k);
  const now = slide(k, frame);
  const copies = now.moving ? BLUR_SAMPLES : 1;
  return (
    <div
      style={abs(colX(col), rowY(row), G.MW, G.MH, {
        transform: `translate3d(0px, ${now.dy}px, ${now.dz}px)`,
        transformStyle: "flat",
      })}
    >
      {/* the module's shadow on the rack */}
      <div
        style={abs(10, 22, G.MW - 10, G.MH - 6, {
          borderRadius: 12,
          background: "rgba(70,35,30,0.32)",
          filter: "blur(14px)",
          opacity: 1 - Math.min(1, now.dz / 140) * 0.6,
        })}
      />
      {Array.from({ length: copies }, (_, i) => {
        const t = frame - (copies === 1 ? 0 : SHUTTER * (i / (copies - 1)));
        const s = slide(k, t);
        return (
          <div
            key={i}
            style={abs(0, s.dy - now.dy, G.MW, G.MH, { opacity: 1 / (i + 1) })}
          >
            <Module k={k} frame={frame} />
          </div>
        );
      })}
    </div>
  );
};

export const Rack: React.FC<{ frame: number }> = ({ frame }) => (
  <>
    <Room />
    <Upright side="left" />
    <Upright side="right" />
    <Rails />
    <div style={abs(G.WOOD + G.SIDE, G.CAP, 3 * G.MW + 2 * G.CGAP, G.HEAD)}>
      <Header frame={frame} />
    </div>
    {Array.from({ length: COLS * ROWS }, (_, i) => (
      <Blank key={i} col={Math.floor(i / ROWS)} row={i % ROWS} />
    ))}
    {FEATURES.map((_, k) =>
      frame >= landFrame(k) + STEP.slideFrom ? <PlacedModule key={k} k={k} frame={frame} /> : null,
    )}
    <div style={abs(0, 0, RACK_W, RACK_H, { transform: "translateZ(10px)" })}>
      <Cables frame={frame} />
    </div>
  </>
);
