import React from "react";
import { C, FONT_BODY } from "../theme";

/**
 * Minimal desktop-window chrome around a screenshot: traffic lights,
 * a centered address pill, and the content below.
 */
export const Window: React.FC<{
  width: number;
  height: number;
  title?: string;
  children: React.ReactNode;
}> = ({ width, height, title = "Open Screenshot Generator", children }) => {
  const bar = 52;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 18,
        overflow: "hidden",
        border: `1px solid ${C.stroke}`,
        background: "#101B1B",
        boxShadow:
          "0 40px 90px rgba(0,0,0,0.55), 0 12px 30px rgba(0,0,0,0.4)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: bar,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          gap: 9,
          background: "rgba(255,255,255,0.05)",
          borderBottom: `1px solid ${C.strokeSoft}`,
          position: "relative",
        }}
      >
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <span
            key={c}
            style={{ width: 13, height: 13, borderRadius: 999, background: c }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            fontFamily: FONT_BODY,
            fontSize: 17,
            fontWeight: 500,
            color: C.sub,
            background: "rgba(0,0,0,0.25)",
            border: `1px solid ${C.strokeSoft}`,
            borderRadius: 8,
            padding: "5px 22px",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
      </div>
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>{children}</div>
    </div>
  );
};
