// Reading a clip's recording, in the browser: frames out of the video, then
// the moments in them. Only the part the clip shows is read, and everything
// comes back in the recording's own seconds, so it stays right however the
// clip is moved or trimmed later.

import { activityTrack, compareAll, findMoments } from './analyze';
import { sampleRecording, stepFor } from './sample';
import type { ClipReading } from './timeline';
import type { FilmClip } from './types';

export async function readClip(
  clip: Pick<FilmClip, 'in' | 'out'>,
  url: string,
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}
): Promise<ClipReading> {
  const start = clip.in;
  const end = Math.max(clip.in + 0.5, clip.out);
  const length = end - start;
  const step = stepFor(length);
  const sampled = await sampleRecording(url, {
    start,
    end,
    step,
    thumbEvery: Math.max(0.5, length / 40),
    signal: options.signal,
    onProgress: options.onProgress,
  });
  // Comparing frames is quick next to reading them, but a long recording
  // still gets a breath between halves so the page stays responsive.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const changes = compareAll(sampled.frames);
  const moments = findMoments(changes, { step, duration: length }).map((m) => ({ ...m, start: m.start + start, end: m.end + start }));
  return {
    moments,
    activity: { ...activityTrack(changes, Math.max(0.1, step), length), start },
    thumbs: sampled.thumbs.map((thumb) => ({ t: thumb.t + start, url: thumb.url })),
    range: { start, end },
  };
}
