import React from "react";
import { Img, staticFile } from "remotion";

/**
 * CSS-built device mockups so screens can show real skeleton screenshots
 * (the palette's 3D renders carry placeholder screens, which would read
 * as broken in a promo).
 */
export const PhoneMock: React.FC<{ screen: string; height: number }> = ({
  screen,
  height,
}) => {
  const H = height;
  const W = H * 0.492;
  const bezel = W * 0.045;
  const bodyRadius = W * 0.17;

  return (
    <div
      style={{
        width: W,
        height: H,
        borderRadius: bodyRadius,
        background: "linear-gradient(155deg, #3c4348 0%, #16191b 30%, #101315 70%, #272c30 100%)",
        padding: bezel,
        boxSizing: "border-box",
        position: "relative",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: bodyRadius - bezel,
          overflow: "hidden",
          position: "relative",
          background: "#000",
          border: `${Math.max(2, W * 0.012)}px solid #000`,
          boxSizing: "border-box",
        }}
      >
        <Img
          src={staticFile(screen)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        {/* Dynamic island */}
        <div
          style={{
            position: "absolute",
            top: H * 0.022,
            left: "50%",
            transform: "translateX(-50%)",
            width: W * 0.3,
            height: H * 0.026,
            borderRadius: 999,
            background: "#000",
          }}
        />
        {/* Glass sheen */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(115deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 28%, transparent 45%)",
          }}
        />
      </div>
    </div>
  );
};

export const WatchMock: React.FC<{ screen: string; height: number }> = ({
  screen,
  height,
}) => {
  const H = height;
  const W = H * 0.86;
  const bezel = W * 0.055;
  const radius = W * 0.28;
  const strapW = W * 0.52;

  return (
    <div
      style={{
        position: "relative",
        width: W,
        height: H * 1.6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Straps */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: strapW,
          height: H * 0.42,
          borderRadius: `${strapW * 0.24}px ${strapW * 0.24}px 6px 6px`,
          background: "linear-gradient(180deg, #23282b, #191d20)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: strapW,
          height: H * 0.42,
          borderRadius: `6px 6px ${strapW * 0.24}px ${strapW * 0.24}px`,
          background: "linear-gradient(0deg, #23282b, #191d20)",
        }}
      />
      {/* Crown */}
      <div
        style={{
          position: "absolute",
          right: -W * 0.035,
          top: "38%",
          width: W * 0.07,
          height: H * 0.14,
          borderRadius: 4,
          background: "linear-gradient(90deg, #3a4145, #22272a)",
        }}
      />
      {/* Case */}
      <div
        style={{
          width: W,
          height: H,
          borderRadius: radius,
          background:
            "linear-gradient(155deg, #454c52 0%, #1a1e21 35%, #14181a 70%, #2c3236 100%)",
          padding: bezel,
          boxSizing: "border-box",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: radius - bezel,
            overflow: "hidden",
            background: "#000",
            border: `${Math.max(2, W * 0.02)}px solid #000`,
            boxSizing: "border-box",
            position: "relative",
          }}
        >
          <Img
            src={staticFile(screen)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(115deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.02) 30%, transparent 50%)",
            }}
          />
        </div>
      </div>
    </div>
  );
};
