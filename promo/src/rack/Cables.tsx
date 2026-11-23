import React from "react";
import { ACCENTS, BEAT, G, RACK_H, RACK_W, colX, patchedFrame, ramp, rowY, signalFrame, slotOf, outCubic } from "./style";
import { JACK_BOTTOM, JACK_TOP } from "./Module";
import { HEAD_JACK } from "./Header";

/**
 * The patch cables, drawn in the rack plane just in front of the modules.
 * Cable k runs from the module before it (or the header for the first) to
 * module k, and is pulled out and plugged in as module k is patched.
 */

type P = { x: number; y: number };

const PAD = { x: 400, y: 600 };

const jack = (k: number, which: "top" | "bottom"): P => {
  const { col, row } = slotOf(k);
  const j = which === "top" ? JACK_TOP : JACK_BOTTOM;
  return { x: colX(col) + j.x, y: rowY(row) + j.y };
};

const headJack = (): P => ({ x: G.WOOD + G.SIDE + HEAD_JACK.x, y: G.CAP + HEAD_JACK.y });

/** Cubic bezier for cable k: [from, c1, c2, to]. */
export const cablePath = (k: number): [P, P, P, P] => {
  if (k === 0) {
    const a = headJack();
    const b = jack(0, "top");
    return [a, { x: a.x - 170, y: a.y + 40 }, { x: b.x - 170, y: b.y - 60 }, b];
  }
  const prev = slotOf(k - 1);
  const cur = slotOf(k);
  if (prev.col !== cur.col) {
    // between columns: along the bottom (0 to 1) or over the top (1 to 2)
    const atBottom = cur.row === 5;
    const a = jack(k - 1, atBottom ? "bottom" : "top");
    const b = jack(k, atBottom ? "bottom" : "top");
    const sag = atBottom ? 430 : -360;
    return [a, { x: a.x + 60, y: a.y + sag }, { x: b.x - 60, y: b.y + sag }, b];
  }
  const down = cur.row > prev.row;
  const a = jack(k - 1, down ? "bottom" : "top");
  const b = jack(k, down ? "top" : "bottom");
  const s = down ? 1 : -1;
  return [a, { x: a.x - 120, y: a.y + 70 * s }, { x: b.x - 120, y: b.y - 70 * s }, b];
};

const bez = ([a, b, c, d]: [P, P, P, P], t: number): P => {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
};

const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
};

const PLUG_IN = 16;

/** How far cable k is drawn, 0 to 1. */
export const cableReach = (k: number, frame: number) => ramp(frame, patchedFrame(k) - PLUG_IN, PLUG_IN, outCubic);

const pathD = (pts: P[]) => pts.map((p, i) => `${i ? "L" : "M"}${(p.x + PAD.x).toFixed(1)} ${(p.y + PAD.y).toFixed(1)}`).join(" ");

const Plug: React.FC<{ p: P; color: string; seat: number }> = ({ p, color, seat }) => {
  const s = 1 + 0.18 * Math.sin(Math.PI * seat) * (seat < 1 ? 1 : 0);
  return (
    <g transform={`translate(${p.x + PAD.x} ${p.y + PAD.y}) scale(${s})`}>
      <circle r={21} fill="rgba(60,30,20,0.28)" transform="translate(6 9)" />
      <circle r={20} fill={shade(color, 0.78)} />
      <circle r={16} fill={color} />
      <circle r={9} fill={shade(color, 0.9)} />
      <ellipse rx={8} ry={5} cx={-5} cy={-7} fill="rgba(255,255,255,0.55)" />
    </g>
  );
};

export const Cables: React.FC<{ frame: number; only?: number[] }> = ({ frame, only }) => {
  const ks = only ?? Array.from({ length: ACCENTS.length }, (_, k) => k);
  return (
    <svg
      width={RACK_W + 2 * PAD.x}
      height={RACK_H + 2 * PAD.y}
      style={{ position: "absolute", left: -PAD.x, top: -PAD.y, overflow: "visible" }}
    >
      {ks.map((k) => {
        const reach = cableReach(k, frame);
        if (reach <= 0) return null;
        const curve = cablePath(k);
        const n = 48;
        const pts: P[] = [];
        for (let i = 0; i <= n; i++) {
          const t = (i / n) * reach;
          // a little slack while the plug travels, gone once it is seated
          const p = bez(curve, t);
          const wob = (1 - reach) * Math.sin(t * Math.PI * 2 + frame / 3) * 18;
          pts.push({ x: p.x + wob, y: p.y });
        }
        const d = pathD(pts);
        const color = ACCENTS[k];
        const seat = ramp(frame, patchedFrame(k) - 2, 10, (t) => t);
        return (
          <g key={k}>
            <path d={d} fill="none" stroke="rgba(70,35,25,0.22)" strokeWidth={15} strokeLinecap="round" transform="translate(10 16)" />
            <path d={d} fill="none" stroke={shade(color, 0.74)} strokeWidth={16} strokeLinecap="round" />
            <path d={d} fill="none" stroke={color} strokeWidth={12} strokeLinecap="round" />
            <path d={d} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={3.5} strokeLinecap="round" transform="translate(-2 -3)" />
            <Plug p={curve[0]} color={color} seat={1} />
            <Plug p={pts[pts.length - 1]} color={color} seat={seat} />
          </g>
        );
      })}
      <Signal frame={frame} />
    </svg>
  );
};

/** How long the signal takes along one cable: a sixteenth note. */
const SIGNAL_LEN = BEAT / 4;

/**
 * On the whole rack, a light runs down the patch cable from the header through
 * every module in order, one cable a sixteenth note, through the track's fill.
 */
const Signal: React.FC<{ frame: number }> = ({ frame }) => {
  const k = ACCENTS.findIndex((_, i) => frame >= signalFrame(i) && frame < signalFrame(i) + SIGNAL_LEN);
  if (k < 0) return null;
  const t = (frame - signalFrame(k)) / SIGNAL_LEN;
  const curve = cablePath(k);
  const pts: P[] = [];
  const tail = 0.45;
  for (let i = 0; i <= 16; i++) pts.push(bez(curve, Math.max(0, t - tail + (i / 16) * tail)));
  const d = pathD(pts);
  const head = bez(curve, t);
  return (
    <g>
      <path d={d} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={30} strokeLinecap="round" />
      <path d={d} fill="none" stroke="#FFFFFF" strokeWidth={9} strokeLinecap="round" />
      <circle cx={head.x + PAD.x} cy={head.y + PAD.y} r={26} fill="rgba(255,255,255,0.45)" />
      <circle cx={head.x + PAD.x} cy={head.y + PAD.y} r={12} fill="#FFFFFF" />
    </g>
  );
};
