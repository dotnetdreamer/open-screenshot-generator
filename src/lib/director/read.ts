// Reading a recording for a film, in the browser: frames out of the video,
// then the moments in them.

import { activityTrack, compareAll, findMoments } from './analyze';
import { sampleRecording, stepFor, type Thumb } from './sample';
import type { ActivityTrack, Film, Moment } from './types';

export interface ReadResult {
  moments: Moment[];
  activity: ActivityTrack;
  thumbs: Thumb[];
}

export async function readRecording(
  film: Pick<Film, 'trim'>,
  url: string,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}
): Promise<ReadResult> {
  const length = Math.max(0.5, film.trim.end - film.trim.start);
  const step = stepFor(length);
  const sampled = await sampleRecording(url, {
    start: film.trim.start,
    end: film.trim.end,
    step,
    thumbEvery: Math.max(0.5, length / 40),
    signal: options.signal,
    onProgress: options.onProgress,
  });
  // Comparing frames is quick next to reading them, but a long recording
  // still gets a breath between halves so the page stays responsive.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const changes = compareAll(sampled.frames);
  const moments = findMoments(changes, { step, duration: length });
  return { moments, activity: activityTrack(changes, Math.max(0.1, step), length), thumbs: sampled.thumbs };
}
