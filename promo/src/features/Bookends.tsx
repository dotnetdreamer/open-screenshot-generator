import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { HOOK_STATS, RELEASES, SCORE_LEFT, SCORE_RIGHT, V, outQuint, ramp, rise } from "./style";
import { F_HEAD } from "./style";
import { Gold, Head, Kicker, PAD, Rail, Stat, Sub, TickRow, Teal, Underline } from "./ui";

type Beat = { local: number; len: number };

/**
 * Cold open. Four numbers, then the promise they add up to.
 *
 * The numbers are counted rather than typed because the whole film is about a
 * product that keeps growing, and a counter says that before a word does.
 */
export const Hook: React.FC<Beat> = ({ local }) => (
  <AbsoluteFill
    style={{
      alignItems: "center",
      justifyContent: "center",
      padding: `0 ${PAD}px`,
      textAlign: "center",
    }}
  >
    <div style={{ display: "flex", justifyContent: "center" }}>
      <Kicker local={local} delay={0} color={V.teal}>
        Free and open source
      </Kicker>
    </div>

    <div style={{ marginTop: 26 }}>
      <Head local={local} delay={8} size={104} align="center" width={1320}>
        Everything your store listing needs
      </Head>
    </div>

    <div style={{ marginTop: 22 }}>
      <Sub local={local} delay={20} size={32} align="center" width={900}>
        One browser tab, or the desktop app, from blank canvas to store ready files
      </Sub>
    </div>

    <div
      style={{
        display: "flex",
        gap: 96,
        marginTop: 62,
        justifyContent: "center",
        alignItems: "flex-start",
      }}
    >
      {HOOK_STATS.map((stat, i) => (
        <Stat
          key={stat.label}
          value={stat.value}
          label={stat.label}
          local={local}
          delay={46 + i * 9}
        />
      ))}
    </div>
  </AbsoluteFill>
);

/** The turn: the film stops describing the product and starts dating it. */
export const RailCard: React.FC<Beat> = ({ local }) => {
  const reveal = ramp(local, 12, 46, outQuint);
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: `0 ${PAD}px`,
        textAlign: "center",
      }}
    >
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Kicker local={local} delay={0} color={V.gold}>
          What&apos;s new
        </Kicker>
      </div>
      <div style={{ marginTop: 22 }}>
        <Head local={local} delay={6} size={88} align="center">
          Six weeks of releases
        </Head>
      </div>
      <div style={{ marginTop: 46, width: 1920 - PAD * 2 }}>
        <Rail items={RELEASES} active={-1} reveal={reveal} />
      </div>
    </AbsoluteFill>
  );
};

/**
 * The scoreboard. Left is the table stakes, right is the part that is usually
 * behind a plan. Nothing here is measured against a named tool, on purpose.
 */
export const Score: React.FC<Beat> = ({ local }) => (
  <AbsoluteFill style={{ padding: `0 ${PAD}px`, justifyContent: "center" }}>
    <div style={{ textAlign: "center", marginBottom: 46 }}>
      <Head local={local} delay={0} size={62} align="center">
        The short version
      </Head>
    </div>
    <div style={{ display: "flex", gap: 110 }}>
      <div style={{ flex: 1 }}>
        <Kicker local={local} delay={10} color={V.teal} size={19}>
          What you would expect
        </Kicker>
        <div style={{ marginTop: 26 }}>
          {SCORE_LEFT.map((row, i) => (
            <TickRow key={row} local={local} delay={20 + i * 6}>
              {row}
            </TickRow>
          ))}
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <Kicker local={local} delay={52} color={V.gold} size={19}>
          What usually costs extra
        </Kicker>
        <div style={{ marginTop: 26 }}>
          {SCORE_RIGHT.map((row, i) => (
            <TickRow key={row} local={local} delay={62 + i * 8} accent={V.gold}>
              {row}
            </TickRow>
          ))}
        </div>
      </div>
    </div>
    <div style={{ textAlign: "center", marginTop: 44 }}>
      <Sub local={local} delay={106} size={26} align="center" color={V.sub}>
        Every line of it in the free build, and in the repository
      </Sub>
    </div>
  </AbsoluteFill>
);

/** Wordmark, address, and the two facts worth leaving on screen. */
export const Outro: React.FC<Beat> = ({ local }) => {
  const pop = ramp(local, 30, 30, outQuint);
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: `0 ${PAD}px`,
        textAlign: "center",
      }}
    >
      <div style={{ ...rise(local, 0, 30, 26) }}>
        <Img src={staticFile("logo.svg")} style={{ width: 118, height: 118 }} />
      </div>

      <div style={{ marginTop: 26 }}>
        <Head local={local} delay={8} size={82} align="center">
          Open Screenshot Generator
        </Head>
      </div>

      <div style={{ marginTop: 18 }}>
        <Sub local={local} delay={18} size={30} align="center" width={880}>
          <Teal>Canva for App Store and Play Store graphics</Teal>
        </Sub>
      </div>

      <div
        style={{
          marginTop: 40,
          padding: "16px 40px 18px",
          borderRadius: 99,
          border: `1px solid rgba(212,175,55,0.5)`,
          background: "rgba(212,175,55,0.10)",
          fontFamily: F_HEAD,
          opacity: pop,
          transform: `scale(${0.88 + pop * 0.12})`,
        }}
      >
        <span
          style={{
            fontFamily: F_HEAD,
            fontSize: 42,
            fontWeight: 700,
            color: V.goldSoft,
            letterSpacing: "-0.01em",
          }}
        >
          openscrgen.app
        </span>
      </div>

      <div style={{ marginTop: 30 }}>
        <Sub local={local} delay={52} size={24} align="center" color={V.dim}>
          Browser, Windows, macOS and Linux <Gold>·</Gold> MIT licensed{" "}
          <Gold>·</Gold> nothing leaves your machine unless you ask
        </Sub>
      </div>

      <div style={{ marginTop: 34, display: "flex", justifyContent: "center" }}>
        <Underline local={local} delay={58} width={420} />
      </div>
    </AbsoluteFill>
  );
};
