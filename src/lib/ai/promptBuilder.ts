import {
  AGENT_CANVASES,
  AGENT_FONTS,
  AGENT_LIMITS,
  LAYOUT_VARIANTS,
  NEW_DESIGN_DEVICE_TYPES,
} from './agentPlanSchema';

/**
 * Prompts for the two agent modes.
 *
 * API mode gets a system prompt plus a real JSON schema (the provider enforces
 * the shape). Browser-session mode has no schema channel, so `buildRelayPrompt`
 * spells the same contract out as annotated JSON and both modes then run the
 * reply through the same zod validation.
 */

const ROLE = `You are the design agent inside Open Screenshot Generator, a tool for building App Store and Play Store screenshot artwork. The user has uploaded screenshots of their app and told you what they want. You choose an existing template and fit their screenshots into it, or you specify a brand new design.`;

const RULES = `Rules:
- Screenshots are numbered from 0 in the order they were given to you. Refer to them only by that index.
- Place every screenshot the user gave you, unless they asked for fewer.
- Refer to templates and elements only by the short refs shown in the catalog: t12 for a template, d0 for a device slot, x1 for a text slot. Copy them exactly. Never invent a ref.
- Prefer "use-template" whenever the user names a template, describes one that exists, or just asks to drop screenshots into a template. Choose the template whose device slot count is closest to the number of screenshots, and whose category matches the screenshot shape (tall phone screens are "screenshots", square watch faces are "apple-watch", 16:10 desktop app windows are "mac", extra-wide banners are "play-feature-graphic").
- Only templates listed with per-artboard detail can have their text rewritten. If you pick a template from the summary list, leave textOverrides empty; its own copy is kept.
- Use "generate-new" only when the user explicitly wants something new, or when no template is a reasonable fit.
- Rewrite template copy to describe the user's actual app. Read the screenshots: use the real feature names, real numbers, and the real product name you can see in them. Headlines should be short and specific, at most about 6 words per line.
- Do not rewrite decorative text such as star ratings, press logos, or review counts unless the user asks.
- Keep every text value under ${AGENT_LIMITS.maxTextLength} characters.
- Colors are 6 digit hex strings such as "#1A2B3C".`;

/**
 * Explains the two-tier catalog: full slot detail for the best-fitting
 * templates, one summary line for the rest. Shared by both prompt shapes.
 */
const CATALOG_HEADER = `Available templates. The best fits for this request are listed first with full detail: one line per artboard showing its device slots (d0, d1, ...) and text slots (x0, x1, ...) with their current copy. The remaining templates are single summary lines; you may pick one by its ref if it truly fits better, but you cannot rewrite its text.`;

export function buildSystemPrompt(catalogText: string): string {
  return `${ROLE}

${CATALOG_HEADER}
${catalogText}

For a brand new design you may only use:
- canvas: ${AGENT_CANVASES.join(', ')}
- deviceType: ${NEW_DESIGN_DEVICE_TYPES.join(', ')}
- layout: ${LAYOUT_VARIANTS.join(', ')}
- fontFamily: ${AGENT_FONTS.join(', ')}
- at most ${AGENT_LIMITS.maxNewDesignArtboards} artboards

${RULES}`;
}

/** The plan shape written out as commented JSON, for models with no schema channel. */
const PLAN_SHAPE = `{
  "action": "use-template" | "generate-new",
  "projectName": "short project name",
  "reasoning": "one sentence explaining the choice",
  "templateId": "t12"                 // the chosen template's ref; required for use-template, otherwise null
  "screenshotPlacements": [           // use-template only, otherwise []
    { "screenshotIndex": 0, "artboardIndex": 0, "deviceElementId": "d0" }
  ],
  "textOverrides": [                  // use-template only, otherwise []
    { "artboardIndex": 0, "elementId": "x1", "text": "new copy" }
  ],
  "newDesign": {                      // required for generate-new, otherwise null
    "themeName": "short theme name",
    "canvas": "${AGENT_CANVASES.join('" | "')}",
    "deviceType": "${NEW_DESIGN_DEVICE_TYPES.join('" | "')}",
    "fontFamily": "${AGENT_FONTS.join('" | "')}",
    "artboards": [
      {
        "name": "artboard name",
        "headline": "Big headline",
        "subheadline": "supporting line or null",
        "layout": "${LAYOUT_VARIANTS.join('" | "')}",
        "screenshotIndex": 0,         // or null for an empty frame
        "backgroundType": "solid" | "gradient",
        "backgroundColor1": "#101820",
        "backgroundColor2": "#2A4B7C", // null when solid
        "backgroundAngle": 135,        // null when solid
        "textColor": "#FFFFFF"
      }
    ]
  }
}`;

export function buildRelayPrompt(
  catalogText: string,
  instruction: string,
  screenshotCount: number
): string {
  const attachments =
    screenshotCount > 0
      ? `I have attached ${screenshotCount} screenshot${screenshotCount === 1 ? '' : 's'} of my app to this message. They are numbered from 0 in the order they appear, so the first attachment is screenshotIndex 0.`
      : `I have not attached any screenshots. Leave every screenshotIndex out or null.`;

  return `${ROLE}

${attachments}

What I want: ${instruction.trim() || 'Put my screenshots into the template that fits them best.'}

${CATALOG_HEADER}
${catalogText}

For a brand new design you may only use:
- canvas: ${AGENT_CANVASES.join(', ')}
- deviceType: ${NEW_DESIGN_DEVICE_TYPES.join(', ')}
- layout: ${LAYOUT_VARIANTS.join(', ')}
- fontFamily: ${AGENT_FONTS.join(', ')}
- at most ${AGENT_LIMITS.maxNewDesignArtboards} artboards

${RULES}

Reply with ONE json code block and nothing else, matching exactly this shape (the comments are for you, do not include them):

\`\`\`json
${PLAN_SHAPE}
\`\`\``;
}

/**
 * Terse relay prompt for providers with a hard per-message cap. ChatGPT's
 * free tier rejects messages past roughly 4k characters, so every sentence
 * here has to earn its bytes. Same contract, same reply shape, no examples
 * or explanations beyond the minimum. `hasDetail` is false when the budget
 * forced a slim-only catalog, in which case copy rewriting is off the table
 * and the shape omits textOverrides guidance accordingly.
 */
export function buildCompactRelayPrompt(
  catalogText: string,
  instruction: string,
  screenshotCount: number,
  hasDetail: boolean
): string {
  const attachments =
    screenshotCount > 0
      ? `${screenshotCount} app screenshot${screenshotCount === 1 ? '' : 's'} attached, numbered from 0 in order.`
      : `No screenshots attached; use null for every screenshotIndex.`;

  const textRule = hasDetail
    ? `- textOverrides may only target x refs shown in the catalog detail; rewrite copy using what you see in the screenshots.`
    : `- Leave textOverrides as [].`;

  return `You pick an App Store screenshot template and fit the user's screenshots into it (or spec a new design).

${attachments}
Task: ${instruction.trim() || 'Put my screenshots into the template that fits them best.'}

${catalogText}

Rules:
- Refer to templates/slots ONLY by the refs above (t12, d0, x1). Never invent one.
- Pick the template whose device slot count and category best match the screenshots.
- Place every screenshot (screenshotIndex from 0).
${textRule}
- "generate-new" only if nothing fits or the user asked for it. canvas: ${AGENT_CANVASES.join('|')}; deviceType: ${NEW_DESIGN_DEVICE_TYPES.join('|')}; layout: ${LAYOUT_VARIANTS.join('|')}; fontFamily: ${AGENT_FONTS.join('|')}; max ${AGENT_LIMITS.maxNewDesignArtboards} artboards.
- Text values under ${AGENT_LIMITS.maxTextLength} chars. Colors are 6-digit hex.

Reply with ONE json code block, nothing else:
{"action":"use-template"|"generate-new","projectName":"...","reasoning":"one sentence","templateId":"t12"|null,"screenshotPlacements":[{"screenshotIndex":0,"artboardIndex":0,"deviceElementId":"d0"|null}],"textOverrides":[{"artboardIndex":0,"elementId":"x1","text":"..."}],"newDesign":null|{"themeName":"...","canvas":"...","deviceType":"...","fontFamily":"...","artboards":[{"name":"...","headline":"...","subheadline":"..."|null,"layout":"...","screenshotIndex":0|null,"backgroundType":"solid"|"gradient","backgroundColor1":"#101820","backgroundColor2":"#2A4B7C"|null,"backgroundAngle":135|null,"textColor":"#FFFFFF"}]}}`;
}

/** Sentinel a provider must reply with when it cannot fetch the catalog URL. */
export const CANNOT_FETCH_SENTINEL = 'CANNOT_FETCH';

/**
 * URL mode: the catalog stays out of the message entirely. The model fetches
 * the hosted file and proves it did by echoing the file's first-line token
 * as "sourceToken"; the caller falls back to an inline prompt when the echo
 * is missing or wrong. Small enough for every provider's message cap.
 */
export function buildUrlRelayPrompt(
  catalogUrl: string,
  instruction: string,
  screenshotCount: number
): string {
  const attachments =
    screenshotCount > 0
      ? `${screenshotCount} app screenshot${screenshotCount === 1 ? '' : 's'} attached, numbered from 0 in order.`
      : `No screenshots attached; use null for every screenshotIndex.`;

  return `You pick an App Store screenshot template and fit the user's screenshots into it (or spec a new design).

${attachments}
Task: ${instruction.trim() || 'Put my screenshots into the template that fits them best.'}

The full template catalog is hosted at:
${catalogUrl}
Fetch that exact URL now and read it before answering. Do not answer from memory or invent templates. If you are unable to fetch it, reply with exactly ${CANNOT_FETCH_SENTINEL} and nothing else.

The file lists templates as t12 with device slots d0 and text slots x1, plus a preview image link per template. Its first line is "VERIFICATION-TOKEN: <value>".

Rules:
- Refer to templates/slots ONLY by the refs from the file. Never invent one.
- Pick the template whose device slot count and category best match the screenshots; place every screenshot (screenshotIndex from 0).
- textOverrides rewrite template copy using what you see in the screenshots; do not touch decorative text (star ratings, review counts).
- "generate-new" only if nothing fits or the user asked for it. canvas: ${AGENT_CANVASES.join('|')}; deviceType: ${NEW_DESIGN_DEVICE_TYPES.join('|')}; layout: ${LAYOUT_VARIANTS.join('|')}; fontFamily: ${AGENT_FONTS.join('|')}; max ${AGENT_LIMITS.maxNewDesignArtboards} artboards.
- Text values under ${AGENT_LIMITS.maxTextLength} chars. Colors are 6-digit hex.

Reply with ONE json code block, nothing else:
{"sourceToken":"<the VERIFICATION-TOKEN value from the file>","action":"use-template"|"generate-new","projectName":"...","reasoning":"one sentence","templateId":"t12"|null,"screenshotPlacements":[{"screenshotIndex":0,"artboardIndex":0,"deviceElementId":"d0"|null}],"textOverrides":[{"artboardIndex":0,"elementId":"x1","text":"..."}],"newDesign":null|{"themeName":"...","canvas":"...","deviceType":"...","fontFamily":"...","artboards":[{"name":"...","headline":"...","subheadline":"..."|null,"layout":"...","screenshotIndex":0|null,"backgroundType":"solid"|"gradient","backgroundColor1":"#101820","backgroundColor2":"#2A4B7C"|null,"backgroundAngle":135|null,"textColor":"#FFFFFF"}]}}`;
}

/** The user turn for API mode. The screenshots ride alongside as image parts. */
export function buildUserPrompt(instruction: string, screenshotCount: number): string {
  const attachments =
    screenshotCount > 0
      ? `${screenshotCount} screenshot${screenshotCount === 1 ? '' : 's'} of my app ${screenshotCount === 1 ? 'is' : 'are'} attached, in order. The first image is screenshotIndex 0.`
      : `No screenshots are attached. Leave every screenshotIndex null.`;

  return `${attachments}

What I want: ${instruction.trim() || 'Put my screenshots into the template that fits them best.'}`;
}
