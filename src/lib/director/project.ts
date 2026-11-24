// What Director reads of the open project: the recordings already in it,
// the colors its screenshots are made of, for a backdrop in the app's own
// colors, and the app's name for the film's title. Pure, over the artboards.

import { isMadeUpProjectName } from '@/lib/projectNames';
import type { ArtboardState } from '@/types/artboard';
import { luminance, parseColor, type Rgb } from './looks';

/**
 * The app's name as the user gave it, for the film's title: the name typed
 * for the app icon, else the project's name unless the editor made that one
 * up (a duplicate's " copy" taken off first). Empty when there's neither: a
 * title reading "Blank Canvas Copy" is worse than none.
 */
export function projectAppName(projectName: string | null | undefined, artboards: ArtboardState[]): string {
  for (const board of artboards) {
    const typed = board.appIcon?.appName?.trim();
    if (typed) return typed;
  }
  const name = (projectName ?? '').trim().replace(/( copy)+$/, '').trim();
  return isMadeUpProjectName(name) ? '' : name;
}

export interface ProjectRecording {
  mediaId: string;
  name: string;
  where: string;
}

/** Every recording in the project, once each, with the artboard it's on. */
export function projectRecordings(artboards: ArtboardState[]): ProjectRecording[] {
  const seen = new Set<string>();
  const out: ProjectRecording[] = [];
  artboards.forEach((board, index) => {
    for (const el of board.elements) {
      if ((el.type !== 'video-device' && el.type !== 'video') || !el.mediaId || seen.has(el.mediaId)) continue;
      seen.add(el.mediaId);
      out.push({ mediaId: el.mediaId, name: el.name?.trim() || 'Screen recording', where: board.name?.trim() || `Artboard ${index + 1}` });
    }
  });
  return out;
}

function saturation(rgb: Rgb): number {
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  return max === 0 ? 0 : (max - min) / max;
}

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * The project's colors, most used first among the colorful ones: board
 * grounds and gradients, shapes and text. Null when the project is all
 * greys, which the plain backdrops suit better.
 */
export function projectColors(artboards: ArtboardState[]): [string, string, string] | null {
  const tally = new Map<string, { rgb: Rgb; weight: number }>();
  const add = (value: string | undefined, weight: number) => {
    const rgb = parseColor(value);
    if (!rgb) return;
    const lum = luminance(rgb);
    // Greys, near-white and near-black say nothing about a brand.
    if (saturation(rgb) < 0.28 || lum > 0.92 || lum < 0.012) return;
    const key = rgb.map((c) => Math.round(c * 15)).join(',');
    const entry = tally.get(key);
    if (entry) entry.weight += weight;
    else tally.set(key, { rgb, weight });
  };
  for (const board of artboards) {
    if (board.backgroundType === 'gradient' && board.backgroundGradient) {
      add(board.backgroundGradient.color1, 4);
      add(board.backgroundGradient.color2, 4);
    } else {
      add(board.backgroundColor, 5);
    }
    for (const el of board.elements) {
      if (el.type === 'shape') add(el.fillColor, 2);
      if (el.type === 'text') add(el.color, 1);
    }
  }
  const ranked = Array.from(tally.values()).sort((a, b) => b.weight - a.weight);
  if (ranked.length === 0) return null;
  const picked: Rgb[] = [ranked[0].rgb];
  for (const entry of ranked.slice(1)) {
    if (picked.every((p) => distance(p, entry.rgb) > 0.25)) picked.push(entry.rgb);
    if (picked.length === 3) break;
  }
  const hex = (rgb: Rgb) => `#${rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
  const main = hex(picked[0]);
  return [main, picked[1] ? hex(picked[1]) : main, picked[2] ? hex(picked[2]) : picked[1] ? hex(picked[1]) : main];
}
