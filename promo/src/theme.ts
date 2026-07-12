import { loadFont as loadGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

const grotesk = loadGrotesk("normal", { weights: ["500", "700"] });
const inter = loadInter("normal", { weights: ["400", "500", "600"] });

export const FONT_DISPLAY = grotesk.fontFamily;
export const FONT_BODY = inter.fontFamily;

export const C = {
  bg: "#060D0D",
  bgSoft: "#0B1616",
  ink: "#F2F7F6",
  sub: "#9FB6B5",
  teal: "#6FB3B5",
  tealDeep: "#457E80",
  tealDark: "#1C3536",
  gold: "#D4AF37",
  goldSoft: "#E8CE7A",
  card: "rgba(255,255,255,0.045)",
  stroke: "rgba(255,255,255,0.10)",
  strokeSoft: "rgba(255,255,255,0.06)",
};

/** Video-wide layout constants. */
export const PAD = 120;
