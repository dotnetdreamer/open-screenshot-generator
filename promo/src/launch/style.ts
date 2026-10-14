import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";

const display = loadFont("normal", {
  weights: ["500", "700"],
  subsets: ["latin"],
});

export const DISPLAY = display.fontFamily;
export const BODY = 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif';
export const LAUNCH_DURATION = 960;
export const HERO_DURATION = 300;

export const L = {
  background: "#061314",
  surface: "#0C1C1E",
  ink: "#F2F2E9",
  secondary: "#A5BABB",
  teal: "#91C4C4",
  gold: "#D4B35F",
  stroke: "rgba(165,202,201,0.24)",
};

export const WINDOW = { x: 86, y: 184, width: 1748, height: 983.25 };
export const clamp = (value: number) => Math.min(1, Math.max(0, value));
export const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
export const mix = (a: number, b: number, value: number) => a + (b - a) * value;
