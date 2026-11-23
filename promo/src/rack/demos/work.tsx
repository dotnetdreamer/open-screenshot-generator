import React from "react";
import { F_MONO, F_SANS } from "../style";
import { Abs, Bar, Check, Chip, JuniperIcon, Label, Txt, UI, p, pop } from "./ui";
import type { DemoProps } from "./types";

/** Column three: how you work with it, and the last step, sending the set. */

const Board: React.FC<{ x: number; y: number; tone: string; accent: string }> = ({ x, y, tone, accent }) => (
  <Abs x={x} y={y} w={74} h={116} style={{ borderRadius: 7, background: tone, overflow: "hidden" }}>
    <div style={{ margin: "9px 8px 0", height: 6, borderRadius: 3, background: accent, width: 46 }} />
    <div style={{ margin: "4px 8px 0", height: 4, borderRadius: 2, background: accent, opacity: 0.5, width: 32 }} />
    <div style={{ position: "absolute", left: 14, right: 14, top: 34, bottom: -10, borderRadius: 9, border: `2px solid ${accent}`, background: "rgba(255,255,255,0.4)" }} />
  </Abs>
);

const Cursor: React.FC<{ x: number; y: number; color: string; name: string }> = ({ x, y, color, name }) => (
  <Abs x={x} y={y}>
    <svg width={16} height={18} viewBox="0 0 16 18" style={{ display: "block", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))" }}>
      <path d="M1 1 L1 15 L5 11 L8 17 L10.5 16 L7.6 10 L13 10 Z" fill={color} stroke="#FFFFFF" strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
    <span
      style={{
        position: "absolute",
        left: 12,
        top: 14,
        padding: "2px 6px",
        borderRadius: 5,
        background: color,
        color: "#161615",
        fontFamily: F_SANS,
        fontSize: 10,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {name}
    </span>
  </Abs>
);

export const EditTogetherDemo: React.FC<DemoProps> = ({ f }) => {
  const t = Math.max(0, f);
  const people = [
    { n: "Ana", c: "#F2A48F", x: 150 + 70 * Math.sin(t / 23), y: 70 + 30 * Math.sin(t / 17 + 1) },
    { n: "Sam", c: UI.blue, x: 330 + 60 * Math.sin(t / 19 + 2), y: 90 + 34 * Math.cos(t / 21) },
    { n: "Lee", c: UI.green, x: 250 + 80 * Math.cos(t / 27 + 1), y: 120 + 20 * Math.sin(t / 15) },
  ];
  // Sam is moving the headline on the second board
  const drag = 10 * Math.sin(t / 19 + 2);
  return (
    <>
      <Label>EDIT TOGETHER</Label>
      <Abs x={360} y={8} style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex" }}>
          {people.map((m, i) => (
            <div
              key={m.n}
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                background: m.c,
                border: "2px solid #141413",
                marginLeft: i ? -6 : 0,
                fontFamily: F_SANS,
                fontSize: 9,
                fontWeight: 800,
                color: "#161615",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transform: `scale(${pop(f, i * 5, 10)})`,
              }}
            >
              {m.n[0]}
            </div>
          ))}
        </div>
        <span style={{ width: 7, height: 7, borderRadius: 4, background: UI.green, boxShadow: `0 0 6px ${UI.green}` }} />
        <Txt size={11} color={UI.sub}>In the room</Txt>
      </Abs>
      <Abs x={14} y={36} w={520} h={140} style={{ borderRadius: 8, background: "#201F1D", overflow: "hidden" }}>
        <Board x={60} y={12} tone="#F6F2E9" accent={UI.forest} />
        <Board x={160} y={12} tone="#DDEDE2" accent={UI.forest2} />
        <Board x={260} y={12} tone="#E7E9FB" accent={UI.berry} />
        <Board x={360} y={12} tone="#FBE7DF" accent="#C4573E" />
        <Abs x={166 + drag} y={20} w={62} h={16} style={{ border: `1.5px solid ${UI.blue}`, borderRadius: 3 }} />
        {people.map((m) => (
          <Cursor key={m.n} x={m.x} y={m.y - 36} color={m.c} name={m.n} />
        ))}
      </Abs>
    </>
  );
};

const VERSIONS = [
  { n: "Version 4", d: "just now" },
  { n: "Version 3", d: "4 min ago · 3 boards · 1.2 MB" },
  { n: "Version 2", d: "1 h ago · 3 boards · 1.1 MB" },
  { n: "Version 1", d: "yesterday · 2 boards" },
];

export const VersionsDemo: React.FC<DemoProps> = ({ f }) => {
  const sel = f < 14 ? 0 : f < 20 ? 1 : 2;
  const back = f > 30;
  const press = f >= 26 && f < 32 ? 0.92 : 1;
  const tones = back ? ["#FBE7DF", "#F6F2E9", "#FBE7DF"] : ["#DDEDE2", "#E7E9FB", "#DDEDE2"];
  return (
    <>
      <Label right="SAVE THIS STATE">VERSIONS</Label>
      <Abs x={14} y={30} w={330}>
        {VERSIONS.map((v, i) => (
          <div
            key={v.n}
            style={{
              height: 32,
              borderRadius: 7,
              padding: "0 10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: i === sel ? "rgba(134,207,198,0.16)" : "transparent",
              border: `1px solid ${i === sel ? "rgba(134,207,198,0.5)" : "transparent"}`,
              marginBottom: 4,
              opacity: p(f, i * 3, 8),
            }}
          >
            <div>
              <Txt size={12.5} weight={700} style={{ display: "block" }}>{v.n}</Txt>
              <Txt size={9.5} color={UI.sub} style={{ display: "block" }}>{v.d}</Txt>
            </div>
            {i === sel && sel === 2 ? (
              // the panel's own button: an arrow going back, titled "Put this state back on the canvas"
              <div style={{ position: "relative", transform: `scale(${press})` }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: f >= 24 ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width={13} height={13} viewBox="0 0 16 16">
                    <path d="M3 8 A5 5 0 1 0 5 4" fill="none" stroke={f >= 24 ? "#161615" : UI.text} strokeWidth={1.8} strokeLinecap="round" />
                    <path d="M2.5 2.5 L5 4 L3.5 6.5" fill="none" stroke={f >= 24 ? "#161615" : UI.text} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    bottom: 30,
                    padding: "4px 8px",
                    borderRadius: 5,
                    background: "#F2EEE7",
                    color: "#161615",
                    fontFamily: F_SANS,
                    fontSize: 10,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    opacity: p(f, 18, 6) * (1 - p(f, 34, 6)),
                  }}
                >
                  Put this state back on the canvas
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </Abs>
      <Abs x={360} y={36} w={174} h={130} style={{ borderRadius: 8, background: "#201F1D", overflow: "hidden" }}>
        {tones.map((c, i) => (
          <Abs key={i} x={12 + i * 54} y={16} w={46} h={78} style={{ borderRadius: 5, background: c, transition: "none" }}>
            <div style={{ margin: "7px 6px 0", height: 4, borderRadius: 2, background: back ? "#C4573E" : UI.forest }} />
            <div style={{ position: "absolute", left: 9, right: 9, top: 22, bottom: -6, borderRadius: 6, border: `1.5px solid ${back ? "#C4573E" : UI.forest}` }} />
          </Abs>
        ))}
        <Abs x={12} y={102} style={{ display: "flex", alignItems: "center", gap: 6, opacity: back ? 1 : 0.0 }}>
          <svg width={14} height={14} viewBox="0 0 16 16">
            <path d="M3 8 A5 5 0 1 0 5 4" fill="none" stroke={UI.teal} strokeWidth={1.8} strokeLinecap="round" />
            <path d="M2.5 2.5 L5 4 L3.5 6.5" fill="none" stroke={UI.teal} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <Txt size={11} color={UI.teal}>Version 2 is back</Txt>
        </Abs>
      </Abs>
    </>
  );
};

const DriveIcon: React.FC = () => (
  <svg width={26} height={23} viewBox="0 0 26 23">
    <path d="M9 1 L17 1 L26 16 L22 22 Z" fill="#F4C451" />
    <path d="M9 1 L0 16 L4 22 L13 7 Z" fill="#3D9A5C" />
    <path d="M4 22 L22 22 L26 16 L8 16 Z" fill="#4A86E8" />
  </svg>
);

const GistIcon: React.FC = () => (
  <div
    style={{
      width: 26,
      height: 26,
      borderRadius: 13,
      background: "#F2EEE7",
      color: "#161615",
      fontFamily: F_MONO,
      fontSize: 12,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    {"{}"}
  </div>
);

export const StorageDemo: React.FC<DemoProps> = ({ f }) => {
  const dest = [
    { n: "Google Drive", d: "a folder per project", icon: <DriveIcon />, at: 6, y: 42 },
    { n: "GitHub", d: "a secret gist per project", icon: <GistIcon />, at: 16, y: 104 },
  ];
  return (
    <>
      <Label right="TO YOUR OWN STORAGE">SAVING</Label>
      <Abs x={20} y={52} w={150} h={84} style={{ borderRadius: 10, background: UI.panel2, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <JuniperIcon s={30} />
          <div>
            <Txt size={14} weight={800} style={{ display: "block" }}>Juniper</Txt>
            <Txt size={10} color={UI.sub} style={{ display: "block" }}>3 boards</Txt>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Bar v={p(f, 4, 30)} w={124} h={4} color={UI.teal} />
        </div>
      </Abs>
      <svg width={548} height={184} style={{ position: "absolute", left: 0, top: 0 }}>
        {dest.map((d, i) => {
          const y1 = 94;
          const y2 = d.y + 18;
          const path = `M172 ${y1} C 250 ${y1}, 260 ${y2}, 330 ${y2}`;
          const t = ((Math.max(0, f - d.at) % 22) / 22);
          const live = f > d.at && f < d.at + 40;
          const x = 172 + (330 - 172) * t;
          const yy = y1 + (y2 - y1) * (3 * t * t - 2 * t * t * t);
          return (
            <g key={i}>
              <path d={path} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={2} strokeDasharray="4 5" />
              {live ? <circle cx={x} cy={yy} r={4} fill={UI.teal} /> : null}
            </g>
          );
        })}
      </svg>
      {dest.map((d) => {
        const saved = f > d.at + 30;
        return (
          <Abs key={d.n} x={336} y={d.y} w={198} h={40} style={{ display: "flex", alignItems: "center", gap: 10, opacity: p(f, d.at - 4, 8) }}>
            {d.icon}
            <div style={{ flex: 1 }}>
              <Txt size={13} weight={700} style={{ display: "block" }}>{d.n}</Txt>
              <Txt size={10} color={UI.sub} style={{ display: "block" }}>{saved ? "Saved" : d.d}</Txt>
            </div>
            <Check s={16} on={p(f, d.at + 30, 8)} />
          </Abs>
        );
      })}
    </>
  );
};

const CLIENTS = ["Claude Code", "Claude Desktop", "VS Code", "Cursor"];

export const McpDemo: React.FC<DemoProps> = ({ f }) => (
  <>
    <Label right="SETTINGS">MCP SERVER</Label>
    <Abs x={16} y={32} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: UI.green, boxShadow: `0 0 8px ${UI.green}` }} />
      <Txt size={14} mono color={UI.teal}>http://127.0.0.1:8722/mcp</Txt>
    </Abs>
    <Abs x={16} y={62} w={330} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      {CLIENTS.map((c, i) => {
        const on = p(f, 6 + i * 7, 8);
        return (
          <div
            key={c}
            style={{
              height: 44,
              borderRadius: 8,
              background: UI.panel2,
              padding: "0 10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              border: `1px solid ${on > 0.5 ? "rgba(134,217,160,0.35)" : "transparent"}`,
            }}
          >
            <Txt size={12.5} weight={600}>{c}</Txt>
            <Check s={15} on={on} />
          </div>
        );
      })}
    </Abs>
    <Abs x={366} y={56} w={168} h={106} style={{ borderRadius: 10, background: UI.panel2, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <Txt size={46} weight={800} style={{ transform: `scale(${pop(f, 30, 12)})` }}>{Math.round(49 * p(f, 30, 16))}</Txt>
      <Txt size={11} color={UI.sub}>tools for your AI</Txt>
    </Abs>
  </>
);

const Monitor: React.FC<{ x: number; children?: React.ReactNode; on?: boolean }> = ({ x, children, on }) => (
  <>
    <Abs
      x={x}
      y={30}
      w={226}
      h={118}
      style={{
        borderRadius: 8,
        border: "3px solid #4A4743",
        background: on ? "#262421" : "#1B1A18",
        overflow: "hidden",
      }}
    >
      {children}
    </Abs>
    <Abs x={x + 98} y={148} w={30} h={10} style={{ background: "#4A4743" }} />
    <Abs x={x + 78} y={158} w={70} h={5} style={{ background: "#4A4743", borderRadius: 3 }} />
  </>
);

const PanelStack: React.FC<{ w: number }> = ({ w }) => (
  <div style={{ width: w, height: "100%", background: "#33312D", padding: 6, display: "flex", flexDirection: "column", gap: 5 }}>
    {["Properties", "Layers"].map((n) => (
      <div key={n} style={{ borderRadius: 4, background: "#3E3B37", padding: "4px 6px", flex: 1 }}>
        <div style={{ fontFamily: F_SANS, fontSize: 9, fontWeight: 700, color: UI.text, whiteSpace: "nowrap" }}>{n}</div>
        {[0.8, 0.55, 0.7].map((v, i) => (
          <div key={i} style={{ height: 3, width: `${v * 100}%`, borderRadius: 2, background: "rgba(255,255,255,0.18)", marginTop: 4 }} />
        ))}
      </div>
    ))}
  </div>
);

export const SecondScreenDemo: React.FC<DemoProps> = ({ f }) => {
  const fly = p(f, 8, 26, (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2));
  // the panel leaves the editor's right edge and fills the second screen
  const px = 14 + 168 + fly * (296 - 168 + 3);
  const pw = 56 + fly * (220 - 56);
  return (
    <>
      <Label right="MOVE TO NEW WINDOW">PANELS</Label>
      <Monitor x={14} on>
        <div style={{ display: "flex", height: "100%" }}>
          <div style={{ flex: 1, display: "flex", gap: 6, padding: 10, alignItems: "flex-start" }}>
            {["#F6F2E9", "#DDEDE2", "#E7E9FB"].map((c) => (
              <div key={c} style={{ width: 38, height: 70, borderRadius: 4, background: c }} />
            ))}
          </div>
          <div style={{ width: 56 * (1 - fly), overflow: "hidden" }} />
        </div>
      </Monitor>
      <Monitor x={296} on={fly > 0.6} />
      <Abs x={px} y={33} w={pw} h={112} style={{ borderRadius: fly > 0.95 ? 5 : 3, overflow: "hidden", boxShadow: fly > 0 && fly < 1 ? "0 10px 24px rgba(0,0,0,0.5)" : "none" }}>
        <PanelStack w={pw} />
      </Abs>
      <Abs x={14} y={166}>
        <Txt size={10.5} color={UI.sub}>Panels open in a window of their own</Txt>
      </Abs>
    </>
  );
};

export const UploadDemo: React.FC<DemoProps> = ({ f }) => {
  // done well before the camera pulls back, about fifty frames after patching
  const v = p(f, 2, 32, (t) => t);
  const R = 46;
  const L = 2 * Math.PI * R;
  const done = f > 35;
  const rows = [
    // Apple takes up to 10 screenshots a size, Google Play up to 8 for phones
    { n: "App Store Connect", at: 2, len: 28, of: 10 },
    { n: "Google Play", at: 6, len: 28, of: 8 },
  ];
  return (
    <>
      <Label right="DESKTOP APP">STORE UPLOAD</Label>
      <Abs x={24} y={32} w={120} h={120}>
        <svg width={120} height={120} viewBox="0 0 120 120">
          <circle cx={60} cy={60} r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={8} />
          <circle
            cx={60}
            cy={60}
            r={R}
            fill="none"
            stroke={done ? UI.green : UI.blue}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={`${L * v} ${L}`}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {done ? (
            <div style={{ transform: `scale(${pop(f, 35, 12)})` }}>
              <Check s={58} />
            </div>
          ) : (
            <Txt size={24} weight={800}>{Math.round(v * 100)}%</Txt>
          )}
        </div>
      </Abs>
      <Abs x={168} y={40} w={366}>
        {rows.map((r) => {
          const k = p(f, r.at, r.len, (t) => t);
          const sent = k >= 1;
          return (
            <div key={r.n} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <Txt size={13.5} weight={700}>{r.n}</Txt>
                <Txt size={11} color={sent ? UI.green : UI.sub} weight={sent ? 700 : 500}>
                  {sent ? "✓ Sent" : `${Math.round(k * r.of)} of ${r.of}`}
                </Txt>
              </div>
              <Bar v={k} w={366} h={7} color={sent ? UI.green : UI.blue} />
            </div>
          );
        })}
        <Txt size={10.5} color={UI.dim}>Straight from the app, no other tool</Txt>
      </Abs>
    </>
  );
};

