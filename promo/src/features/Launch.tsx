import React from "react";
import { AbsoluteFill } from "remotion";
import { COPY, F_BODY, V, clamp, outExpo, outQuint, ramp } from "./style";
import { FILES } from "./rects.generated";
import { ProductBeat, R, mid } from "./kit";
import { AppWindow, BeatCopy, Cursor, PAD, Ring, Still } from "./ui";

type P = { local: number; len: number };

/** Bars 25 and 26: every store size in one pass, and the size Apple requires ticked for you. */
export const ExportSizes: React.FC<P> = ({ local }) => {
  const SHOT = "features2/flows/export.png";
  const MISSING = "features2/flows/export-missing.png";
  const sizes = R(SHOT, "store-sizes", { x: 505, y: 308, w: 430, h: 214 });
  const count = R(SHOT, "file-count", { x: 505, y: 732, w: 430, h: 54 });
  const button = mid(R(SHOT, "export-button", { x: 862, y: 810, w: 72, h: 40 }));
  const required = R(MISSING, "required-size", { x: 505, y: 358, w: 430, h: 32 });
  const hasMissing = FILES.has(MISSING);
  return (
    <ProductBeat
      local={local}
      beat={COPY.exportSizes}
      hue="gold"
      shots={hasMissing ? [{ src: SHOT }, { src: MISSING, at: 66 }] : [{ src: SHOT }]}
      cam={[
        { at: 0, z: 1.15, x: 720, y: 450 },
        { at: 24, z: 1.85, x: sizes.x + sizes.w / 2, y: sizes.y + sizes.h / 2 + 10 },
        { at: 46, z: 1.85, x: count.x + count.w / 2, y: count.y - 60 },
        { at: 66, z: 1.85, x: count.x + count.w / 2, y: count.y - 60 },
        ...(hasMissing
          ? [
              { at: 72, z: 1.5 },
              { at: 116, z: 2.1, x: required.x + required.w / 2, y: required.y + 20 },
            ]
          : [{ at: 116, z: 1.6, x: button.x - 150, y: button.y - 120 }]),
      ]}
      overlay={
        local < 66 ? (
          <>
            <Ring rect={sizes} local={local} delay={26} color={V.gold} hold={20} />
            <Ring rect={count} local={local} delay={48} color={V.gold} />
          </>
        ) : (
          <Ring rect={required} local={local} delay={84} color={V.gold} radius={8} />
        )
      }
    />
  );
};

/**
 * Bars 27 to 29. The upload runs through the break bar, quiet, and lands on
 * the drop as done: the copy waits for the drop too.
 *
 * The capture froze at 8 of 20, so the bar and the line above it are redrawn
 * in the dialog's own colours (sampled from the capture) and count on to 20,
 * naming files the way the app does: board number, board name, language, size.
 */
const BOARD_NAMES = ["Habits", "Goal", "Reminders", "Hydration", "Tracking"];
const UPLOAD_LOCALES = ["en-US", "de-DE", "ja", "ar-SA"];

export const Upload: React.FC<P> = ({ local }) => {
  const UP = "features2/flows/publish-uploading.png";
  const DONE = "features2/flows/publish-done.png";
  const bar = R(UP, "progress-bar", { x: 409, y: 736, w: 622, h: 16 });
  const done = R(DONE, "done-message", { x: 409, y: 690, w: 618, h: 62 });
  const growth = R(DONE, "see-results-in-growth", { x: 599, y: 726, w: 143, h: 16 });
  const fill = clamp(0.4 + 0.6 * ((local - 4) / 50));
  const n = Math.max(8, Math.min(20, Math.ceil(fill * 20)));
  const file = `${String(((n - 1) % 5) + 1).padStart(2, "0")}_${BOARD_NAMES[(n - 1) % 5]}_${UPLOAD_LOCALES[Math.floor((n - 1) / 5)]}_1206x2622.png`;
  const copyLocal = local - 60;
  return (
    <AbsoluteFill>
      <ProductBeat
        local={local}
        beat={COPY.upload}
        hideCopy
        hue="gold"
        shots={[{ src: UP }, { src: DONE, at: 60 }]}
        cam={[
          { at: 0, z: 1.55, x: bar.x + bar.w / 2, y: bar.y - 70 },
          { at: 56, z: 1.75, x: bar.x + bar.w / 2, y: bar.y - 60 },
          { at: 66, z: 1.3, x: done.x + done.w / 2, y: done.y - 60 },
          { at: 112, z: 1.85, x: done.x + done.w / 2, y: done.y + done.h / 2 },
        ]}
        overlay={
          local < 62 ? (
            <>
              <div style={{ position: "absolute", left: bar.x - 4, top: bar.y - 24, width: bar.w + 8, height: 19, background: "#14161A" }} />
              <div
                style={{
                  position: "absolute",
                  left: bar.x,
                  top: bar.y - 21,
                  fontFamily: F_BODY,
                  fontSize: 12,
                  lineHeight: "14px",
                  color: "#9EA7B3",
                  whiteSpace: "nowrap",
                }}
              >
                Uploading {file} ({n} of 20)
              </div>
              <div style={{ position: "absolute", left: bar.x, top: bar.y - 0.5, width: bar.w, height: 16, borderRadius: 8, background: "#2B2F36", overflow: "hidden" }}>
                <div style={{ width: `${fill * 100}%`, height: "100%", borderRadius: 8, background: "#6DAEB0", boxShadow: "0 0 10px rgba(109,174,176,0.6)" }} />
              </div>
            </>
          ) : (
            <>
              <Ring rect={done} local={local} delay={70} color={V.gold} />
              <Ring rect={growth} local={local} delay={96} color="#7FC8A0" radius={6} pad={5} />
            </>
          )
        }
      />
      {copyLocal >= 0 ? (
        <div style={{ position: "absolute", left: PAD, top: 0, bottom: 0, display: "flex", alignItems: "center" }}>
          <BeatCopy beat={COPY.upload} local={copyLocal} hue="gold" width={570} size={64} />
        </div>
      ) : (
        <div style={{ position: "absolute", left: PAD, top: 0, bottom: 0, display: "flex", alignItems: "center" }}>
          <div
            style={{
              fontFamily: F_BODY,
              fontWeight: 600,
              fontSize: 26,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: V.goldSoft,
              opacity: ramp(local, 6, 14, outQuint) * (1 - ramp(local, 54, 6, outQuint)),
            }}
          >
            Uploading {n} of 20
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

/** Bars 30 and 31: make the site, then home, support and privacy pages, at its own address. */
export const Site: React.FC<P> = ({ local }) => {
  const START = "features2/flows/website-start.png";
  const HOME = "features2/flows/website-home.png";
  const SUPPORT = "features2/flows/website-support.png";
  const PRIVACY = "features2/flows/website-privacy.png";
  const PUB = "features2/flows/website-published.png";
  const make = mid(R(START, "make-my-website", { x: 88, y: 650, w: 172, h: 44 }));
  const frame = R(HOME, "preview-frame", { x: 636, y: 124, w: 788, h: 760 });
  const links = R(PUB, "site-links", { x: 256, y: 131, w: 347, h: 148 });
  const online = R(PUB, "online-status", { x: 934, y: 18, w: 55, h: 24 });
  const published = FILES.has(PUB);
  const fx = frame.x + frame.w / 2;
  const fy = frame.y + frame.h / 2;
  return (
    <ProductBeat
      local={local}
      beat={COPY.site}
      hue="gold"
      shots={[
        { src: START },
        { src: HOME, at: 26 },
        { src: SUPPORT, at: 48 },
        { src: PRIVACY, at: 68 },
        ...(published ? [{ src: PUB, at: 88 }] : []),
      ]}
      cam={[
        { at: 0, z: 1 },
        { at: 26, z: 1 },
        { at: 40, z: 1.62, x: fx, y: fy - 40 },
        { at: 86, z: 1.62, x: fx, y: fy - 20 },
        { at: 92, z: 1.15 },
        { at: 118, z: 1.85, x: links.x + links.w / 2 + 40, y: links.y + links.h / 2 + 10 },
      ]}
      overlay={
        <>
          {local < 26 ? (
            <Cursor
              local={local}
              appear={2}
              keys={[
                { at: 2, x: make.x + 220, y: make.y + 120 },
                { at: 16, x: make.x, y: make.y },
                { at: 20, x: make.x, y: make.y, click: true },
              ]}
            />
          ) : null}
          {published && local >= 88 ? (
            <>
              <Ring rect={online} local={local} delay={92} color="#7FC8A0" radius={8} />
              <Ring rect={links} local={local} delay={100} color={V.gold} />
            </>
          ) : null}
        </>
      }
    />
  );
};

/** Bars 32 and 33: every launch size drawn from the same screenshots, then opened to edit. */
export const Social: React.FC<P> = ({ local }) => {
  const FLOW = "features2/more/social/flow.png";
  const RESULT = "features2/more/social/result.png";
  const shots = R(FLOW, "screenshots", { x: 65, y: 185, w: 1310, h: 228 });
  const formats = R(FLOW, "formats", { x: 65, y: 539, w: 1310, h: 36 });
  const card = R(FLOW, "styleCard", { x: 477, y: 616, w: 400, h: 262 });
  const open = mid(R(FLOW, "openButton", { x: 791, y: 837, w: 73, h: 28 }));
  const board = R(RESULT, "board", { x: 362, y: 156, w: 622, h: 327 });
  const tab = R(RESULT, "tab", { x: 558, y: 7, w: 216, h: 33 });
  return (
    <ProductBeat
      local={local}
      beat={COPY.social}
      hue="gold"
      shots={[{ src: FLOW }, { src: RESULT, at: 70 }]}
      cam={[
        { at: 0, z: 1 },
        { at: 22, z: 1.55, x: 520, y: shots.y + shots.h / 2 + 20 },
        { at: 44, z: 1.3, x: 700, y: (formats.y + card.y + card.h) / 2 + 30 },
        { at: 70, z: 1.3, x: 700, y: (formats.y + card.y + card.h) / 2 + 30 },
        { at: 76, z: 1.05 },
        { at: 118, z: 1.5, x: board.x + board.w / 2, y: board.y + board.h / 2 - 30 },
      ]}
      overlay={
        local < 70 ? (
          <>
            <Ring rect={formats} local={local} delay={44} color={V.gold} hold={26} />
            <Ring rect={card} local={local} delay={52} color={V.gold} />
            <Cursor
              local={local}
              appear={48}
              keys={[
                { at: 48, x: open.x + 200, y: open.y - 120 },
                { at: 62, x: open.x, y: open.y },
                { at: 66, x: open.x, y: open.y, click: true },
              ]}
            />
          </>
        ) : (
          <>
            <Ring rect={tab} local={local} delay={84} color={V.teal} radius={8} />
            <Ring rect={board} local={local} delay={92} color={V.gold} />
          </>
        )
      }
    />
  );
};

/** Bars 34 and 35: the iOS 27 header on Juniper's product page, then its search art. */
export const Header: React.FC<P> = ({ local }) => {
  const LISTING = "features2/more/header/listing.png";
  const SEARCH = "features2/more/header/listing-search.png";
  const header = R(LISTING, "headerArt", { x: 423, y: 159, w: 306, h: 158 });
  const checks = R(LISTING, "headerCheck", { x: 1152, y: 104, w: 264, h: 166 });
  const art = R(SEARCH, "searchArt", { x: 438, y: 324, w: 276, h: 154 });
  return (
    <ProductBeat
      local={local}
      beat={COPY.header}
      hue="gold"
      shots={[{ src: LISTING }, { src: SEARCH, at: 62 }]}
      cam={[
        { at: 0, z: 1 },
        { at: 20, z: 1.7, x: header.x + header.w / 2, y: header.y + header.h / 2 + 70 },
        { at: 40, z: 1.7, x: header.x + header.w / 2, y: header.y + header.h / 2 + 70 },
        { at: 58, z: 1.55, x: checks.x + checks.w / 2 - 80, y: checks.y + checks.h / 2 },
        { at: 66, z: 1.15 },
        { at: 116, z: 1.9, x: art.x + art.w / 2, y: art.y + art.h / 2 },
      ]}
      overlay={
        local < 62 ? (
          <>
            <Ring rect={header} local={local} delay={22} color={V.gold} hold={28} radius={14} />
            <Ring rect={checks} local={local} delay={48} color="#7FC8A0" />
          </>
        ) : (
          <Ring rect={art} local={local} delay={86} color={V.gold} radius={12} />
        )
      }
    />
  );
};

export { Cursor, outQuint };
