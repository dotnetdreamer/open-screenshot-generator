// Getting a recording ready to draw, the same way in every browser.
//
// Safari on iPhone loads only a video's size and length until something
// plays it: without a play, 'loadeddata' never comes and nothing can be
// drawn (measured on iOS 26.5 in the Simulator: readyState stays 1). A
// muted, inline play followed by a pause starts the decoding, and a page
// may do that without a tap.

const META_WAIT_MS = 15_000;
const DATA_WAIT_MS = 6_000;

function once(video: HTMLVideoElement, events: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const finish = (what: string) => {
      clearTimeout(timer);
      for (const event of events) video.removeEventListener(event, handlers[event]);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
      resolve(what);
    };
    const failed = () => {
      clearTimeout(timer);
      for (const event of events) video.removeEventListener(event, handlers[event]);
      signal?.removeEventListener('abort', aborted);
      reject(new Error("This recording can't be played here. Use an MP4 or MOV file."));
    };
    const aborted = () => {
      clearTimeout(timer);
      for (const event of events) video.removeEventListener(event, handlers[event]);
      video.removeEventListener('error', failed);
      reject(new DOMException('Stopped', 'AbortError'));
    };
    const handlers: Record<string, () => void> = {};
    for (const event of events) {
      handlers[event] = () => finish(event);
      video.addEventListener(event, handlers[event]);
    }
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    video.addEventListener('error', failed);
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

/** A hidden video element for reading or showing a recording: muted, inline, in the page but out of sight. */
export function hiddenVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  // Some browsers stop decoding a video that isn't in the document.
  Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' });
  document.body.appendChild(video);
  return video;
}

/** Loads `url` into `video` and waits until a frame can be drawn. */
export async function loadVideo(video: HTMLVideoElement, url: string, signal?: AbortSignal): Promise<void> {
  const meta = once(video, ['loadedmetadata'], META_WAIT_MS, signal);
  video.src = url;
  video.load();
  if ((await meta) === 'timeout' && video.readyState < 1) throw new Error("This recording can't be played here. Use an MP4 or MOV file.");
  if (video.readyState >= 2) return;
  const data = once(video, ['loadeddata', 'canplay'], DATA_WAIT_MS, signal);
  const muted = video.muted;
  video.muted = true;
  // Only a play starts the decoding on an iPhone; the play's own answer can
  // come late or never, so the wait is for the first frame instead.
  video.play().catch(() => undefined);
  await data;
  video.pause();
  video.muted = muted;
  if (video.readyState < 2) throw new Error("This recording can't be played here. Use an MP4 or MOV file.");
}
