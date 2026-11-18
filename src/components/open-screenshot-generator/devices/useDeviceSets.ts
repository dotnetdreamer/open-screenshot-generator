"use client";
// The project laid out for each device, for the Every device view.
//
// Text is measured in the faces it draws in, so this waits for them
// (facesReady) and lays everything out again whenever one arrives later
// (onFontsSettled). Until then the layouts are worked out in whatever face is
// on the page, which only moves a line break or two.

import { useEffect, useMemo, useState } from 'react';
import type { ArtboardState, DeviceType } from '@/types/artboard';
import type { DeviceFormat } from '@/lib/deviceRegistry';
import { onFontsSettled } from '@/lib/fontsSettled';
import { projectArtboards } from '@/lib/i18n/project';
import type { BoardPlan } from '@/lib/deviceSets/layout';
import { facesReady, measureText } from '@/lib/deviceSets/measure';
import { boardsOnDevice, framesOnDevice, takesPart, type FrameOnDevice } from '@/lib/deviceSets/sets';
import { normalizeBackgroundImage } from '@/lib/artboardBackground';
import { type DeviceSetTarget } from '@/lib/deviceSets/targets';

export interface BoardOnDevice {
  /** The artboard as stored, in the main language. */
  base: ArtboardState;
  /** The artboard in the language being shown, before it is laid out for the device. */
  inLanguage: ArtboardState;
  /** The artboard on the device, in the language being shown. */
  shown: ArtboardState;
  /** Null on the project's own device, where nothing is laid out again. */
  plan: BoardPlan | null;
  frames: FrameOnDevice[];
}

export interface DeviceSetView {
  target: DeviceSetTarget;
  /** The project is already this size: the boards show as they are. */
  own: boolean;
  boards: BoardOnDevice[];
  /** Artboards whose layout did not fit, so they are shrunk to fit instead. */
  shrunk: number;
  /** Frames that still show a phone screenshot on a tablet or a Mac. */
  phoneShots: number;
  /** Frames that want a screenshot of this device: the phone ones above, and screenshots the frame does not fit. */
  needsShots: number;
  /** The frame a screenshot for this device turns a phone frame into. */
  frame: DeviceType | null;
}

/** A number that changes whenever a font that matters to measured text arrives. */
export function useFontsVersion(boards: ArtboardState[]): number {
  const [version, setVersion] = useState(0);
  useEffect(() => onFontsSettled(() => setVersion((value) => value + 1)), []);
  useEffect(() => {
    let live = true;
    const waiting = facesReady(boards);
    if (waiting) {
      void waiting.then(() => {
        if (live) setVersion((value) => value + 1);
      });
    }
    return () => {
      live = false;
    };
  }, [boards]);
  return version;
}

/** The screenshot artboards of the project on one device, in one language. */
export function deviceSetView(
  artboards: ArtboardState[],
  projected: ArtboardState[],
  target: DeviceSetTarget,
  own: boolean,
  locale: string | null
): DeviceSetView {
  const shownById = new Map(projected.map((board) => [board.id, board]));
  const plans = new Map<string, BoardPlan | null>();
  // The whole project on the device, the way the export makes it, so a
  // background picture spanned across the artboards is sliced the same way.
  const whole = own
    ? projected
    : normalizeBackgroundImage(
        boardsOnDevice(artboards, artboards.map((board) => shownById.get(board.id) ?? board), target.id, locale, {
          measure: measureText,
          cache: plans,
        })
      );
  const wholeById = new Map(whole.map((board) => [board.id, board]));
  const boards: BoardOnDevice[] = artboards.filter(takesPart).map((base) => {
    const inLanguage = shownById.get(base.id) ?? base;
    if (own) return { base, inLanguage, shown: inLanguage, plan: null, frames: [] };
    const plan = plans.get(`${target.id}:${base.id}`) ?? null;
    return { base, inLanguage, shown: wholeById.get(base.id) ?? inLanguage, plan, frames: framesOnDevice(base, target) };
  });
  return {
    target,
    own,
    boards,
    shrunk: boards.filter((board) => board.plan?.fellBack).length,
    phoneShots: boards.reduce((sum, board) => sum + board.frames.filter((frame) => frame.showsPhoneShot).length, 0),
    needsShots: boards.reduce((sum, board) => sum + board.frames.filter((frame) => frame.showsPhoneShot || frame.wrongShape).length, 0),
    frame: target.frame ?? null,
  };
}

/** Every device's set, worked out again when the project, the language or a font changes. */
export function useDeviceSets(
  artboards: ArtboardState[],
  targets: readonly DeviceSetTarget[],
  ownFormat: DeviceFormat | null,
  locale: string | null,
  enabled: boolean
): Map<DeviceFormat, DeviceSetView> {
  const fonts = useFontsVersion(artboards);
  const projected = useMemo(() => projectArtboards(artboards, locale), [artboards, locale]);
  return useMemo(() => {
    const views = new Map<DeviceFormat, DeviceSetView>();
    if (!enabled) return views;
    for (const target of targets) {
      views.set(target.id, deviceSetView(artboards, projected, target, target.id === ownFormat, locale));
    }
    return views;
    // `fonts` is in the list so a face that arrives measures everything again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artboards, projected, targets, ownFormat, locale, enabled, fonts]);
}
