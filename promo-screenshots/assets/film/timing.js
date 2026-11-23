// Every time in the film, in seconds, on the bars of the music: intro.mp3 at
// 120 BPM, so a bar is 2.0 s (120 frames at 60 fps) and a beat 0.5 s. Bar k
// starts at bar(k); the track's crash is on bar 0, its drop on bar 2 and its
// final hit on bar 18 (scripts/arrange-music.cjs). Edit the two together.

export const FPS = 60;
export const W = 1440;
export const H = 1800;
export const BPM = 120;
export const BEAT = 60 / BPM; // 0.5 s
export const BAR = 4 * BEAT; // 2.0 s
export const BAR0 = 0.5; // the crash; before it the camera cranes up on the pickup
export const bar = (k) => BAR0 + k * BAR;

export const SCREENS = 16;
/** A pan lasts this long from its downbeat (the reference: ~0.75 s). */
export const PAN = 0.75;

/** When the camera starts moving towards screen i (screen 0: the crane up from t = 0). */
export const panStart = (i) => (i === 0 ? 0 : bar(i));
/** When the camera has landed on screen i. */
export const landAt = (i) => (i === 0 ? BAR0 : bar(i) + PAN);
/** When the camera starts leaving screen i. */
export const leaveAt = (i) => (i === SCREENS - 1 ? SHOT.WHIP : bar(i + 1));

export const SHOT = {
  WHIP: bar(16), // 32.5: whip out and round to the wide shot (track bar 22)
  WIDE: bar(16) + 0.7, // 33.2: the wide shot settles, a slow push begins
  APPROACH: bar(17.5), // 35.5: on into the slate as the fill runs
  CLAP: bar(18), // 36.5: the sticks close on the track's final hit
  END: bar(19.75), // 40.0
};

export const DURATION = SHOT.END;
export const FRAMES = Math.round(DURATION * FPS);
