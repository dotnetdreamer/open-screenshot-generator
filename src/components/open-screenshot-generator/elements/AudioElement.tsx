"use client";
import React, { useRef } from 'react';
import type { AudioElementProps } from '@/types/artboard';
import { useMediaUrl } from '@/lib/mediaStore';
import { useTimelineAudio } from '@/lib/video/useTimelineAudio';

interface AudioElementComponentProps {
  element: AudioElementProps;
  /** Board this sound sits on, so it can follow its timeline. */
  artboardId: string;
}

/**
 * A sound layer on the canvas: an <audio> with nothing to see. It is edited
 * from the Layers panel, the timeline and the Properties panel, and excluded
 * from every image capture.
 */
export function AudioElement({ element, artboardId }: AudioElementComponentProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const src = useMediaUrl(element.mediaId) ?? undefined;
  useTimelineAudio(audioRef, element, artboardId, src);
  if (!src) return null;
  return <audio ref={audioRef} src={src} preload="auto" data-export-exclude data-audio-layer={element.id} />;
}
