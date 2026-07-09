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

const ROLE = `You are the design agent inside Artboard Studio, a tool for building App Store and Play Store screenshot artwork. The user has uploaded screenshots of their app and told you what they want. You choose an existing template and fit their screenshots into it, or you specify a brand new design.`;

const RULES = `Rules:
- Screenshots are numbered from 0 in the order they were given to you. Refer to them only by that index.
- Place every screenshot the user gave you, unless they asked for fewer.
- Use exact element ids copied from the catalog. Never invent an id.
- Prefer "use-template" whenever the user names a template, describes one that exists, or just asks to drop screenshots into a template. Choose the template whose device slot count is closest to the number of screenshots, and whose category matches the screenshot shape (tall phone screens are "screenshots", square watch faces are "apple-watch", wide banners are "play-feature-graphic").
- Use "generate-new" only when the user explicitly wants something new, or when no template is a reasonable fit.
- Rewrite template copy to describe the user's actual app. Read the screenshots: use the real feature names, real numbers, and the real product name you can see in them. Headlines should be short and specific, at most about 6 words per line.
- Do not rewrite decorative text such as star ratings, press logos, or review counts unless the user asks.
- Keep every text value under ${AGENT_LIMITS.maxTextLength} characters.
- Colors are 6 digit hex strings such as "#1A2B3C".`;

export function buildSystemPrompt(catalogText: string): string {
  return `${ROLE}

Available templates (id | name | category | shape | description, then one line per artboard listing its device and text slots):
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
  "templateId": "template_xxx"        // required for use-template, otherwise null
  "screenshotPlacements": [           // use-template only, otherwise []
    { "screenshotIndex": 0, "artboardIndex": 0, "deviceElementId": "exact-id-from-catalog" }
  ],
  "textOverrides": [                  // use-template only, otherwise []
    { "artboardIndex": 0, "elementId": "exact-id-from-catalog", "text": "new copy" }
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

Available templates (id | name | category | shape | description, then one line per artboard listing its device and text slots):
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

/** The user turn for API mode. The screenshots ride alongside as image parts. */
export function buildUserPrompt(instruction: string, screenshotCount: number): string {
  const attachments =
    screenshotCount > 0
      ? `${screenshotCount} screenshot${screenshotCount === 1 ? '' : 's'} of my app ${screenshotCount === 1 ? 'is' : 'are'} attached, in order. The first image is screenshotIndex 0.`
      : `No screenshots are attached. Leave every screenshotIndex null.`;

  return `${attachments}

What I want: ${instruction.trim() || 'Put my screenshots into the template that fits them best.'}`;
}
