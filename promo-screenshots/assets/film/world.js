// The set's measurements, in metres. Y is up, the ring of screens is centred on
// the origin and every screen faces the centre. Screen i sits at angle a(i) and
// the next one is to the camera's right, so the truck pans right like the reference.

export const R = 8.8; // radius of the screen ring (16 panels of 3.2 m + 0.25 m gaps)
export const N = 16;
export const DELTA = (Math.PI * 2) / N;
export const a = (i) => -i * DELTA;

export const SCREEN = { w: 3.2, h: 4.0, y0: 0.72 };
SCREEN.yc = SCREEN.y0 + SCREEN.h / 2;

/** Where the camera stands for a screen: 5.6 m in front of it, a little below its middle. */
export const CAM = { dist: 5.6, y: 2.1, lookY: 2.9, fov: 52 };
/**
 * Props stand 2.5 m in front of their screen (3.1 m from the camera). At that
 * distance the frame's bottom edge is about 1.05 m up, so a prop's top at
 * 1.5 to 1.7 m fills the bottom fifth of the frame, as in the reference.
 */
export const PROP_R = R - 2.5;

export const SLATE = { y: 2.25, w: 1.52, h: 1.62, clap: 0.24 };

export const polar = (r, ang, y = 0) => [r * Math.sin(ang), y, r * Math.cos(ang)];
