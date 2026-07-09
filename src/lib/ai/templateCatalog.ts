import type { Project } from '@/types/artboard';

/**
 * A compact, model-readable index of every template the picker knows about.
 *
 * The agent needs three things to fill a template: its id, where the device
 * frames are (so it can place screenshots), and which text elements exist with
 * their current copy (so it can rewrite them). Element ids are stable and
 * authored by hand in the template JSON, so the plan can target them exactly
 * instead of guessing at roles.
 *
 * Serialized as dense lines rather than pretty JSON: the whole catalog for ~67
 * templates lands around 15k tokens, which fits every default model's context
 * and is still small enough to paste into a chat window.
 */

export interface CatalogDeviceSlot {
  elementId: string;
  deviceType: string;
}

export interface CatalogTextSlot {
  elementId: string;
  text: string;
}

export interface CatalogArtboard {
  index: number;
  name: string;
  deviceSlots: CatalogDeviceSlot[];
  textSlots: CatalogTextSlot[];
}

export interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  artboards: CatalogArtboard[];
}

const MAX_DESCRIPTION = 110;
const MAX_TEXT_SNIPPET = 44;

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}...` : flat;
}

export function buildTemplateCatalog(templates: Project[]): CatalogEntry[] {
  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    category: template.category ?? 'uncategorized',
    description: truncate(template.description ?? '', MAX_DESCRIPTION),
    artboards: template.projectData.map((artboard, index) => ({
      index,
      name: artboard.name,
      deviceSlots: artboard.elements
        .filter((el) => el.type === 'device')
        .map((el) => ({
          elementId: el.id,
          deviceType: el.type === 'device' ? el.deviceType : 'unknown',
        })),
      textSlots: artboard.elements
        .filter((el) => el.type === 'text')
        .map((el) => ({
          elementId: el.id,
          text: truncate(el.type === 'text' ? el.content : '', MAX_TEXT_SNIPPET),
        })),
    })),
  }));
}

/** Total device frames across a template. Used to rank template fit by screenshot count. */
export function countDeviceSlots(entry: CatalogEntry): number {
  return entry.artboards.reduce((sum, ab) => sum + ab.deviceSlots.length, 0);
}

export function serializeCatalog(entries: CatalogEntry[]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    lines.push(
      `${entry.id} | ${entry.name} | category:${entry.category} | ${entry.artboards.length} artboards, ${countDeviceSlots(entry)} device slots${entry.description ? ` | ${entry.description}` : ''}`
    );
    for (const artboard of entry.artboards) {
      const devices = artboard.deviceSlots
        .map((slot) => `${slot.elementId}:${slot.deviceType}`)
        .join(', ');
      const texts = artboard.textSlots
        .map((slot) => `${slot.elementId}:"${slot.text}"`)
        .join(', ');
      lines.push(
        `  artboard ${artboard.index} "${artboard.name}" devices[${devices}] texts[${texts}]`
      );
    }
  }
  return lines.join('\n');
}
