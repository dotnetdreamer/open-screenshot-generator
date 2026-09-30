// The empty project a Claude Code run starts in: how big its artboard is, and
// what it is called until the agent names it.

interface Size {
  width: number;
  height: number;
}

/**
 * Store sizes by the shape of the screenshots, so the agent starts on an
 * artboard that fits what it was given. Each shot that looks like a device
 * votes; ties go to the phone, which is what most people are making. A shot
 * shaped like no device (a cropped screen, a window capture) does not vote,
 * and with no votes at all the project gets the default size.
 */
const PHONE: Size = { width: 1290, height: 2796 };
const TABLET: Size = { width: 2064, height: 2752 };
const WATCH: Size = { width: 422, height: 514 };
const MAC: Size = { width: 2560, height: 1600 };
const PHONE_LANDSCAPE: Size = { width: 2796, height: 1290 };
const TABLET_LANDSCAPE: Size = { width: 2752, height: 2064 };

// Height over width. Phones are 1.78 (16:9) and taller. iPads run from 1.33
// (13") to 1.52 (mini), and Android tablets reach 1.6 (16:10). Watches are
// about 1.22 at a few hundred pixels wide.
function sizeFor(shot: Size): Size | null {
  const { width, height } = shot;
  if (width <= 0 || height <= 0) return null;
  if (height >= width) {
    const ratio = height / width;
    if (ratio >= 1.65) return PHONE;
    if (ratio >= 1.3) return width >= 700 ? TABLET : null;
    if (ratio >= 1.15 && width < 700) return WATCH;
    return null;
  }
  // Landscape: phones are 2.16, Macs 1.54 to 1.78, iPads 1.33 to 1.45.
  const ratio = width / height;
  if (ratio >= 1.9) return PHONE_LANDSCAPE;
  if (ratio >= 1.47) return MAC;
  if (ratio >= 1.3) return TABLET_LANDSCAPE;
  return null;
}

export function pickCanvasSize(screenshots: Size[], fallback: Size): Size {
  const votes = new Map<Size, number>();
  for (const shot of screenshots) {
    const size = sizeFor(shot);
    if (size) votes.set(size, (votes.get(size) ?? 0) + 1);
  }
  if (!votes.size) return fallback;
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
