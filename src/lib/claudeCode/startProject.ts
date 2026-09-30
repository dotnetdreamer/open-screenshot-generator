// The empty project a Claude Code run starts in: how big its artboard is, and
// what it is called until the agent names it.

interface Size {
  width: number;
  height: number;
}

/**
 * Store sizes by the shape of the screenshots, so the agent starts on an
 * artboard that fits what it was given. Each shot votes; ties go to the phone,
 * which is what most people are making.
 */
const PHONE: Size = { width: 1290, height: 2796 };
const TABLET: Size = { width: 2064, height: 2752 };
const WATCH: Size = { width: 422, height: 514 };
const MAC: Size = { width: 2560, height: 1600 };
const PHONE_LANDSCAPE: Size = { width: 2796, height: 1290 };
const TABLET_LANDSCAPE: Size = { width: 2752, height: 2064 };

function sizeFor(shot: Size): Size {
  const { width, height } = shot;
  if (width <= 0 || height <= 0) return PHONE;
  if (height >= width) {
    const ratio = height / width;
    if (ratio >= 1.4) return PHONE;
    // A watch screenshot is about as square as a tablet one but a fraction of
    // the pixels.
    return width < 700 ? WATCH : TABLET;
  }
  const ratio = width / height;
  if (ratio >= 1.9) return PHONE_LANDSCAPE;
  if (ratio >= 1.4) return MAC;
  return TABLET_LANDSCAPE;
}

export function pickCanvasSize(screenshots: Size[], fallback: Size): Size {
  if (!screenshots.length) return fallback;
  const votes = new Map<Size, number>();
  for (const shot of screenshots) {
    const size = sizeFor(shot);
    votes.set(size, (votes.get(size) ?? 0) + 1);
  }
  let best = PHONE;
  let bestVotes = -1;
  for (const [size, count] of votes) {
    if (count > bestVotes || (count === bestVotes && size === PHONE)) {
      best = size;
      bestVotes = count;
    }
  }
  return { ...best };
}

/** What a project is called when the instruction does not name the app. */
export const PLACEHOLDER_PROJECT_NAME = 'Claude Code project';

/**
 * "Droply screenshots" when the instruction names the app ("an app called
 * Droply"), otherwise a plain placeholder the agent is told it may replace.
 */
export function projectNameFromInstruction(instruction: string): string {
  const named = /\b(?:called|named)\s+["']?([A-Z0-9][\w&.+-]*(?:\s+[A-Z0-9][\w&.+-]*){0,2})/.exec(instruction);
  if (named) return `${named[1].replace(/[.,;:!?]+$/, '')} screenshots`;
  return PLACEHOLDER_PROJECT_NAME;
}
