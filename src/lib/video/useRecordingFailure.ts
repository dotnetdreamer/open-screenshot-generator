"use client";
// Whether a recording on the canvas has anything to show.
//
// The upload probe (mediaStore.probeVideoBlob) only has to reach the file's
// metadata, so a recording can pass it and still never produce a frame on the
// canvas: a codec the engine demuxes but cannot decode, a media pipeline that
// stops part way, a blob that no longer resolves. A <video> in that state
// keeps its box and paints it black, which reads as the app having lost the
// recording. This watches the element for the two ways it happens so the
// canvas can say what it is instead.

import { useEffect, useState, type RefObject } from 'react';

// How long a recording may take to reach its first frame before the element
// gives up on it. Long enough for a big file off a slow disk, short enough
// that nobody sits in front of a black rectangle guessing.
const FIRST_FRAME_TIMEOUT_MS = 15000;

/** HAVE_CURRENT_DATA: there is a frame to paint. */
const HAVE_CURRENT_DATA = 2;

/** What the canvas says over a recording that is not showing. */
export const RECORDING_FAILURE_MESSAGE = 'This recording could not be played';

/** True once a recording has failed to put a frame on screen. */
export function useRecordingFailure(
  ref: RefObject<HTMLVideoElement | null>,
  // The resolved source: a recording that changes gets a fresh chance, and
  // media-store recordings mount their <video> only once the blob URL arrives.
  src: string | undefined
): boolean {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    const video = ref.current;
    if (!video || !src) return;

    const fail = () => setFailed(true);
    // A recording slower than the deadline still takes the message back down
    // when its first frame lands.
    const clear = () => setFailed(false);
    video.addEventListener('error', fail);
    video.addEventListener('loadeddata', clear);

    // Read the element when the deadline arrives rather than when it was set:
    // a file that already has its frame by then never needed the deadline.
    const timer = window.setTimeout(() => {
      if (video.readyState < HAVE_CURRENT_DATA) fail();
    }, FIRST_FRAME_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timer);
      video.removeEventListener('error', fail);
      video.removeEventListener('loadeddata', clear);
    };
  }, [ref, src]);

  return failed;
}
