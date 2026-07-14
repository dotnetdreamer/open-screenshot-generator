import type { CatalogEntry } from './templateCatalog';
import { countDeviceSlots } from './templateCatalog';

/**
 * The compact catalog the agent prompt actually carries.
 *
 * The full catalog of ~65 templates serializes to ~62k characters, which is
 * too big for a chat composer: ChatGPT converts pastes over ~5k characters
 * into a RAG-chunked file attachment, and local models overflow their context
 * window. Both failure modes are silent. So the prompt gets two tiers instead:
 * a deterministically ranked shortlist with full slot detail, and a one-line
 * summary for everything else, together about a sixth of the old size.
 *
 * Element ids never appear in the prompt. Every template becomes t<n> and its
 * slots d<k>/x<k>, and `resolveAliases` maps a reply back to real ids before
 * validation. Positional refs survive weak models and chunked prompts: a model
 * cannot mis-transcribe a 40-character author id it never saw.
 *
 * Everything here is pure and deterministic. The alias map is built in the
 * same pass as the prompt text, so the two cannot drift within a run.
 */

export interface AliasMap {
  /** "t3" -> real template id. */
  templates: Record<string, string>;
  /** Real template id -> its ref, for replies that quote real ids anyway. */
  refsByTemplateId: Record<string, string>;
  /** "t3.d1" -> real element id. Slot refs are numbered ACROSS a template's
   * artboards (not per artboard) so a ref stays unambiguous even when the
   * model miscounts artboardIndex, preserving findTextElement's
   * search-other-artboards recovery. */
  devices: Record<string, string>;
  /** "t3.x1" -> real element id. */
  texts: Record<string, string>;
}

export interface CatalogArtifacts {
  catalogText: string;
  aliasMap: AliasMap;
  /** Real ids of the templates serialized with full slot detail. */
  shortlistIds: string[];
  /** False when the budget forced a slim-only catalog with no slot detail
   * (text can no longer be rewritten; selection and placement still work). */
  hasDetail: boolean;
}

export interface PrefilterInput {
  /** Pixel dimensions of the uploads; used to infer the canvas category. */
  screenshots: { width: number; height: number }[];
  instruction: string;
}

export interface CatalogBudget {
  /** Max characters for the catalog text. Providers with hard per-message
   * caps (ChatGPT free rejects ~4k+ char messages outright) get a small
   * budget and the serialization degrades stepwise to fit. */
  budgetChars?: number;
}

/**
 * Degradation ladder, tried in order until the catalog fits the budget.
 * The last rung drops slot detail entirely: the model can still pick a
 * template (placement falls back to reading order) but cannot rewrite copy.
 */
interface SerializeLevel {
  shortlist: number;
  snippet: number;
  detailDesc: number;
  tailDesc: number;
  terse: boolean;
}

const SERIALIZE_LEVELS: SerializeLevel[] = [
  { shortlist: 8, snippet: 32, detailDesc: 80, tailDesc: 60, terse: false },
  { shortlist: 8, snippet: 32, detailDesc: 60, tailDesc: 0, terse: false },
  { shortlist: 6, snippet: 24, detailDesc: 40, tailDesc: 0, terse: false },
  { shortlist: 4, snippet: 20, detailDesc: 0, tailDesc: 0, terse: false },
  { shortlist: 0, snippet: 0, detailDesc: 0, tailDesc: 0, terse: false },
  { shortlist: 0, snippet: 0, detailDesc: 0, tailDesc: 0, terse: true },
];

/** One-token category codes for the tersest serialization rung. */
const TERSE_CATEGORIES: Record<string, string> = {
  screenshots: 'scr',
  'apple-watch': 'watch',
  mac: 'mac',
  'play-feature-graphic': 'fg',
};

const REF_SHAPE = /^[tdx]\d+$/;

/** Matches resolveTemplate's normalization so ref lookups agree with it. */
function normalizeTemplateId(value: string): string {
  return value.trim().toLowerCase().replace(/^template_/, '');
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}...` : flat;
}

// --- prefilter --------------------------------------------------------------

/**
 * Words too generic to identify a template by name. Without this list, an
 * instruction like "put my app screenshots in a dark template" would
 * force-match half the catalog.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'into', 'from', 'that', 'this', 'them', 'then',
  'app', 'apps', 'application', 'template', 'templates', 'screenshot',
  'screenshots', 'screen', 'screens', 'design', 'designs', 'style', 'theme',
  'dark', 'light', 'clean', 'modern', 'simple', 'best', 'nice', 'good',
  'make', 'made', 'use', 'using', 'put', 'place', 'copy', 'text', 'write',
  'rewrite', 'store', 'play', 'apple', 'watch', 'phone', 'mobile', 'feature',
  'graphic', 'banner', 'image', 'images', 'photo', 'photos', 'new', 'create',
]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

/**
 * Which canvas category the uploads look like. Tall images are phone
 * screenshots, 16:10 desktop windows are Mac screenshots, wider ones are Play
 * feature graphics, near-square ones are watch faces. Majority vote across
 * uploads; null when there are none. The mac band is deliberately narrow
 * (1.4-1.7): every Mac App Store tier is exactly 1.6, while 16:9 (1.78) stays
 * in the feature-graphic bucket it always voted for.
 */
function inferCategory(screenshots: PrefilterInput['screenshots']): string | null {
  if (screenshots.length === 0) return null;
  const votes = { screenshots: 0, 'apple-watch': 0, mac: 0, 'play-feature-graphic': 0 };
  for (const shot of screenshots) {
    if (shot.height > shot.width * 1.4) votes.screenshots++;
    else if (shot.width > shot.height * 1.7) votes['play-feature-graphic']++;
    else if (shot.width > shot.height * 1.4) votes.mac++;
    else votes['apple-watch']++;
  }
  return (Object.entries(votes) as [string, number][]).reduce((a, b) =>
    b[1] > a[1] ? b : a
  )[0];
}

interface RankedEntry {
  entry: CatalogEntry;
  score: number;
  named: boolean;
}

/**
 * Ranks every template without a model call. Three cheap signals, mirroring
 * what the RULES already ask the model to do by eye: match the screenshot
 * shape to the category, match the upload count to the device slot count, and
 * match the instruction's distinctive words to names and descriptions. A
 * template the user names outright is forced into the shortlist.
 */
export function rankTemplates(entries: CatalogEntry[], input: PrefilterInput): RankedEntry[] {
  const category = inferCategory(input.screenshots);
  const shotCount = input.screenshots.length;
  const instructionTokens = tokenize(input.instruction);
  const keywordTokens = instructionTokens.filter((t) => !STOPWORDS.has(t));
  const instructionLower = input.instruction.toLowerCase();

  const ranked = entries.map((entry, order) => {
    let score = 0;

    if (category) {
      if (entry.category === category) score += 6;
      else score -= 3;
    }

    if (shotCount > 0) {
      const slots = countDeviceSlots(entry);
      score -= Math.min(6, Math.abs(slots - shotCount)) * 1.5;
      if (slots === shotCount) score += 2;
    }

    const doc = new Set(
      tokenize(
        `${entry.name} ${entry.category} ${entry.description} ${entry.id.replace(/^template_/, '')}`
      )
    );
    for (const token of keywordTokens) {
      if (doc.has(token)) score += 1.5;
    }

    // Named-template detection: a distinctive word of the template's own name
    // appearing in the instruction, or the full name quoted verbatim.
    const nameTokens = tokenize(entry.name).filter((t) => !STOPWORDS.has(t));
    const named =
      instructionLower.includes(entry.name.toLowerCase()) ||
      nameTokens.some((t) => t.length >= 4 && instructionTokens.includes(t));
    if (named) score += 100;

    // Stable tiebreak: keep authored order.
    return { entry, score: score - order * 0.001, named };
  });

  return ranked.sort((a, b) => b.score - a.score);
}

// --- serialization + alias map ----------------------------------------------

/**
 * Builds the two-tier catalog text and its alias map in one pass.
 *
 * Refs are positional over the ORIGINAL entry order (t3 is always the fourth
 * template regardless of ranking), so a ref is meaningful even if the model
 * only saw part of the prompt. Slot refs exist only for the shortlist: a
 * summary-line template can be picked, but its text cannot be rewritten,
 * which degrades to the template's own authored copy rather than to blind
 * guesses about slots the model never saw.
 */
export function buildCatalogArtifacts(
  entries: CatalogEntry[],
  input: PrefilterInput,
  budget: CatalogBudget = {}
): CatalogArtifacts {
  const ranked = rankTemplates(entries, input);
  let artifacts = serializeAtLevel(entries, ranked, SERIALIZE_LEVELS[0]);
  if (budget.budgetChars) {
    for (const level of SERIALIZE_LEVELS.slice(1)) {
      if (artifacts.catalogText.length <= budget.budgetChars) break;
      artifacts = serializeAtLevel(entries, ranked, level);
    }
  }
  return artifacts;
}

/**
 * Every template with full slot detail, no prefilter, in original entry
 * order. Deterministic for a given template list, so the build script and
 * the running client produce byte-identical text (and thus identical refs)
 * for the hosted-catalog flow.
 */
export function buildFullCatalogArtifacts(entries: CatalogEntry[]): CatalogArtifacts {
  // No ranking: original order, byte-stable.
  const ranked = entries.map((entry) => ({ entry, score: 0, named: false }));
  return serializeAtLevel(entries, ranked, {
    shortlist: entries.length,
    snippet: 44,
    detailDesc: 110,
    tailDesc: 0,
    terse: false,
  });
}

/** One serialization pass; text and alias map are always built together. */
function serializeAtLevel(
  entries: CatalogEntry[],
  ranked: RankedEntry[],
  level: SerializeLevel
): CatalogArtifacts {
  const aliasMap: AliasMap = { templates: {}, refsByTemplateId: {}, devices: {}, texts: {} };
  const refs = new Map<CatalogEntry, string>();
  entries.forEach((entry, i) => {
    const ref = `t${i}`;
    refs.set(entry, ref);
    aliasMap.templates[ref] = entry.id;
    aliasMap.refsByTemplateId[normalizeTemplateId(entry.id)] = ref;
  });

  const shortlist = ranked.slice(0, level.shortlist).map((r) => r.entry);
  const shortlistSet = new Set(shortlist);

  const lines: string[] = [];
  for (const entry of shortlist) {
    const ref = refs.get(entry)!;
    lines.push(
      `${ref} | ${entry.name} | category:${entry.category} | ${entry.artboards.length} artboards, ${countDeviceSlots(entry)} device slots${entry.description && level.detailDesc > 0 ? ` | ${truncate(entry.description, level.detailDesc)}` : ''}`
    );
    // Slot refs run across the whole template, not per artboard, so a ref
    // identifies its element even when the model gets artboardIndex wrong.
    let dIndex = 0;
    let xIndex = 0;
    for (const artboard of entry.artboards) {
      const devices = artboard.deviceSlots
        .map((slot) => {
          const slotName = `d${dIndex++}`;
          aliasMap.devices[`${ref}.${slotName}`] = slot.elementId;
          return `${slotName}:${slot.deviceType}`;
        })
        .join(', ');
      const texts = artboard.textSlots
        .map((slot) => {
          const slotName = `x${xIndex++}`;
          aliasMap.texts[`${ref}.${slotName}`] = slot.elementId;
          return `${slotName}:"${truncate(slot.text, level.snippet)}"`;
        })
        .join(', ');
      lines.push(`  artboard ${artboard.index} "${artboard.name}" devices[${devices}] texts[${texts}]`);
    }
  }

  const summaries: string[] = [];
  for (const entry of entries) {
    if (shortlistSet.has(entry)) continue;
    const ref = refs.get(entry)!;
    summaries.push(
      level.terse
        ? `${ref}|${truncate(entry.name, 24)}|${TERSE_CATEGORIES[entry.category] ?? entry.category}|${entry.artboards.length}/${countDeviceSlots(entry)}`
        : `${ref} | ${entry.name} | ${entry.category} | ${entry.artboards.length}ab/${countDeviceSlots(entry)}dev${entry.description && level.tailDesc > 0 ? ` | ${truncate(entry.description, level.tailDesc)}` : ''}`
    );
  }
  if (summaries.length > 0) {
    lines.push('');
    if (shortlist.length > 0) {
      lines.push(
        'Other templates (summary only). You may pick one by its ref if it fits better, but leave textOverrides empty for it:'
      );
    } else if (level.terse) {
      lines.push(
        'Templates (ref|name|category|artboards/deviceSlots; scr=screenshots, watch=apple-watch, fg=play-feature-graphic):'
      );
    } else {
      lines.push('Templates (ref | name | category | artboards/device slots):');
    }
    lines.push(...summaries);
  }

  return {
    catalogText: lines.join('\n'),
    aliasMap,
    shortlistIds: shortlist.map((entry) => entry.id),
    hasDetail: shortlist.length > 0,
  };
}

// --- reply resolution ---------------------------------------------------------

/** Pulls the last d3-style ref out of "d3", "a0.d3", or "t5.a0.d3". */
function slotRef(value: string, kind: 'd' | 'x'): string | null {
  const match = new RegExp(`(?:^|[.\\s])(${kind}\\d+)$`).exec(value.trim().toLowerCase());
  return match ? match[1] : null;
}

/**
 * Rewrites a raw reply's refs back to real ids. Runs BEFORE zod validation,
 * so it touches only the fields it understands and never throws: anything
 * that is not a ref (a real id, a template name, junk) passes through to the
 * schema and to buildProjectFromPlan's existing fuzzy matching and warnings.
 */
export function resolveAliases(raw: unknown, aliasMap: AliasMap): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const plan = { ...(raw as Record<string, unknown>) };

  let templateRef: string | null = null;
  if (typeof plan.templateId === 'string') {
    const wanted = plan.templateId.trim().toLowerCase();
    if (REF_SHAPE.test(wanted) && aliasMap.templates[wanted]) {
      templateRef = wanted;
      plan.templateId = aliasMap.templates[wanted];
    } else {
      // The model quoted a real id; find its ref so slot refs still resolve.
      templateRef = aliasMap.refsByTemplateId[normalizeTemplateId(wanted)] ?? null;
    }
  }

  if (Array.isArray(plan.screenshotPlacements)) {
    plan.screenshotPlacements = plan.screenshotPlacements.map((item) => {
      if (typeof item !== 'object' || item === null) return item;
      const placement = { ...(item as Record<string, unknown>) };
      if (typeof placement.deviceElementId === 'string' && templateRef !== null) {
        const ref = slotRef(placement.deviceElementId, 'd');
        if (ref) {
          // An unknown device ref becomes null, which the builder fills with
          // the first free frame; a real id passes through untouched.
          placement.deviceElementId = aliasMap.devices[`${templateRef}.${ref}`] ?? null;
        }
      }
      return placement;
    });
  }

  if (Array.isArray(plan.textOverrides)) {
    plan.textOverrides = plan.textOverrides.map((item) => {
      if (typeof item !== 'object' || item === null) return item;
      const override = { ...(item as Record<string, unknown>) };
      if (typeof override.elementId === 'string' && templateRef !== null) {
        const ref = slotRef(override.elementId, 'x');
        if (ref) {
          // An unknown text ref stays as-is so the builder logs the same
          // "was not found and was skipped" warning it does today.
          override.elementId = aliasMap.texts[`${templateRef}.${ref}`] ?? override.elementId;
        }
      }
      return override;
    });
  }

  return plan;
}
