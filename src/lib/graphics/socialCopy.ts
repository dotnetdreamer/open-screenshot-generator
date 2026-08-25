/**
 * Default marketing copy for a generated graphic.
 *
 * The competitor calls this "AI-powered copy" and spends a model call and a
 * progress bar on it. Read their own output and it is plainly a bank keyed on
 * the app name ("Builder, at a glance", "Power up Builder", "Builder feels
 * premium"), which is the right shape for the job and does not need a network
 * round trip, an API key, or a spinner. So this is a bank, it resolves in
 * microseconds, it works offline, and it is the same for everyone with the same
 * app name, which is what makes the deck stable while a user types.
 *
 * The AI agent is still there for the harder ask. Nobody should have to run it
 * to see their app in a layout.
 */

export interface CopyAngle {
  id: string;
  /** `{app}` is replaced with the app name. */
  headline: string;
  /** Used verbatim before the user has typed a name. */
  headlineNoName: string;
  subhead: string;
  /**
   * Which grounds this reads best on. A style picks from the matching pool so
   * a dark, cinematic layout does not get the calm wellness line.
   */
  tone: 'calm' | 'bold';
}

/**
 * Deliberately short. The shallowest surface here is a 1584x396 LinkedIn cover,
 * where a headline over about 28 characters has to drop to a size nobody reads,
 * so every line is written to survive that and `fitHeadline` trims the rest.
 */
export const COPY_ANGLES: CopyAngle[] = [
  {
    id: 'at-a-glance',
    headline: '{app}, at a glance',
    headlineNoName: 'Your app, at a glance',
    subhead: 'Everything it does, on one screen',
    tone: 'calm',
  },
  {
    id: 'meet',
    headline: 'Meet {app}',
    headlineNoName: 'Meet your new app',
    subhead: 'The one your day has been missing',
    tone: 'calm',
  },
  {
    id: 'out-now',
    headline: '{app} is out now',
    headlineNoName: 'Out now',
    subhead: 'On the App Store and Google Play',
    tone: 'bold',
  },
  {
    id: 'do-more',
    headline: 'Do more with {app}',
    headlineNoName: 'Do more, faster',
    subhead: 'Fast, quiet and out of your way',
    tone: 'bold',
  },
  {
    id: 'sorted',
    headline: 'Your day, sorted',
    headlineNoName: 'Your day, sorted',
    subhead: '{app} keeps it all in one place',
    tone: 'calm',
  },
  {
    id: 'try-free',
    headline: 'Try {app} free',
    headlineNoName: 'Try it free',
    subhead: 'No account needed to look around',
    tone: 'bold',
  },
  {
    id: 'premium',
    headline: '{app} feels premium',
    headlineNoName: 'Built to feel premium',
    subhead: 'Designed down to the last pixel',
    tone: 'bold',
  },
  {
    id: 'made-for-you',
    headline: 'Made for the way you work',
    headlineNoName: 'Made for the way you work',
    subhead: '{app} fits the habits you already have',
    tone: 'calm',
  },
  {
    id: 'fast-simple',
    headline: 'Fast. Simple. {app}',
    headlineNoName: 'Fast and simple',
    subhead: 'The shortest path from open to done',
    tone: 'bold',
  },
  {
    id: 'switch',
    headline: 'Why people switch',
    headlineNoName: 'Why people switch',
    subhead: 'Set {app} up once and forget the rest',
    tone: 'calm',
  },
];

export interface CopyContext {
  /** What the user typed, or '' before they have typed anything. */
  appName: string;
  /**
   * Bumped by the deck's "New copy" control. Rotating the whole bank rather
   * than randomising per card keeps every card's copy stable while the user
   * types, and still gives a different set on demand.
   */
  rotation?: number;
}

export interface ResolvedCopy {
  headline: string;
  subhead: string;
  /** The angle this came from, so a card can name it. */
  angleId: string;
}

/** Small, stable string hash. Same style always draws the same angle. */
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function fill(template: string, appName: string): string {
  // A name-free line still has to read: `{app} keeps it all in one place`
  // becomes `It keeps it all in one place`, never `keeps it all in one place`.
  if (!appName) {
    const filled = template.replace(/\{app\}/g, 'it');
    return filled.charAt(0).toUpperCase() + filled.slice(1);
  }
  return template.replace(/\{app\}/g, appName);
}

/**
 * The copy one style shows.
 *
 * `seed` is the style id, so a given style keeps its line as the user types the
 * app name and as formats are switched. That matters more than variety: a deck
 * whose copy reshuffles on every keystroke is unreadable.
 */
export function copyFor(seed: string, ctx: CopyContext, tone?: CopyAngle['tone']): ResolvedCopy {
  const pool = tone ? COPY_ANGLES.filter((angle) => angle.tone === tone) : COPY_ANGLES;
  const angles = pool.length > 0 ? pool : COPY_ANGLES;
  const index = (hash(seed) + (ctx.rotation ?? 0)) % angles.length;
  const angle = angles[index];
  const name = ctx.appName.trim();
  return {
    headline: name ? fill(angle.headline, name) : angle.headlineNoName,
    subhead: fill(angle.subhead, name),
    angleId: angle.id,
  };
}

/**
 * A headline short enough for the band it has to sit in.
 *
 * Trimming to a word boundary and dropping the tail beats shrinking the type:
 * on a 396px tall cover the difference between a 3 word line and a 7 word line
 * is the difference between readable at thumbnail size and not.
 */
export function fitHeadline(headline: string, maxChars: number): string {
  if (headline.length <= maxChars) return headline;
  const words = headline.split(' ');
  let out = '';
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > maxChars) break;
    out = next;
  }
  return out || headline.slice(0, maxChars);
}
