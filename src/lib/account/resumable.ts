/**
 * A Google Drive resumable upload, kept apart from the requests so it can be
 * tested on its own.
 *
 * A file goes up in pieces that are whole multiples of 256 KiB, the last one
 * excepted (Drive's rule). Each piece is a PUT with `Content-Range: bytes
 * a-b/total`; Drive answers 308 with `Range: bytes=0-n` for the bytes it has
 * so far (no Range: none yet), and 200 or 201 once it has them all. The
 * desktop app's HTTP plugin sends a request body as an array of numbers over
 * IPC, so pieces also keep that array to a size it can take: 8 MiB.
 *
 * A dropped connection or a server error is waited out and then Drive is
 * asked what it has (`bytes * /total`, no body), and the upload goes on from
 * there. Starting the session is waited out the same way. An expired session
 * starts again from the first byte.
 *
 * In a browser, Drive's answer comes from another origin, and a header it
 * doesn't list as readable is hidden from the page. When the Range header is
 * hidden, a 308 can't say how much arrived: the piece is taken as received,
 * the file's size is checked at the end, and after a dropped connection the
 * upload starts again rather than guess.
 *
 * Every upload ends, whatever Drive answers. Starting again from the first
 * byte is allowed three times in all, a count nothing resets: progress taken
 * on trust behind a hidden Range once reset it, and a Drive that kept part of
 * a piece each time ran to 100,000 requests. Below that, a cap on requests
 * counts every one.
 */

export const RESUMABLE_QUANTUM = 256 * 1024;
export const RESUMABLE_PIECE = 32 * RESUMABLE_QUANTUM;
/** Files up to this go up in one multipart request; larger ones resumably. */
export const MULTIPART_LIMIT = 5 * 1024 * 1024;
/** How many failures in a row an upload waits out before it gives up. */
export const RESUMABLE_RETRIES = 6;
/** How many times one upload may start again from the first byte. */
export const RESUMABLE_RESTARTS = 3;

/** The Content-Range header for the piece starting at `start`, and where it ends. */
export function pieceAt(start: number, total: number, piece = RESUMABLE_PIECE): { end: number; header: string } {
  if (piece % RESUMABLE_QUANTUM !== 0) throw new Error('A piece is a whole multiple of 256 KiB');
  if (total <= 0) return { end: -1, header: 'bytes */0' };
  const end = Math.min(total, start + piece) - 1;
  return { end, header: `bytes ${start}-${end}/${total}` };
}

/**
 * Where to send from next, from a 308's Range header (`bytes=0-1048575`).
 * No header means Drive has none of the file yet.
 */
export function nextStart(rangeHeader: string | null): number {
  if (!rangeHeader) return 0;
  const match = /bytes=0-(\d+)/.exec(rangeHeader);
  return match ? Number(match[1]) + 1 : 0;
}

/** How long to wait before try `failures`: 1, 2, 4, 8 then 16 seconds. */
export function backoffMs(failures: number): number {
  return 1000 * 2 ** Math.min(4, Math.max(0, failures - 1));
}

/**
 * The most requests one upload makes: 60 for every 256 KiB, and 60 more.
 * Real Drive confirms at least 256 KiB a step, and a step costs at most
 * about 15 requests (two stalls, six failures each with a question), in each
 * of four sessions.
 */
export function requestLimit(total: number): number {
  return 60 * (Math.ceil(Math.max(0, total) / RESUMABLE_QUANTUM) + 1);
}

/** HTTP answers worth waiting out: a timeout, too many requests, a server error. */
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

/** Drive answered a request with an error status; `begin` throws it, so a server error is waited out and a refusal isn't. */
export class ResumableHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export interface ResumableAnswer {
  status: number;
  /** The Range header, or null when there is none or the browser hides it. */
  range: string | null;
  /** True when the browser keeps the Range header from the page, so null says nothing. */
  rangeHidden: boolean;
  /** The finished file's metadata, read from the 200 or 201 answer. */
  body: () => Promise<unknown>;
}

export interface ResumableUpload {
  total: number;
  /**
   * Starts an upload session: at first, and again after one expired or can't
   * be resumed. Throws ResumableHttpError when Drive answers with an error.
   */
  begin: () => Promise<void>;
  /**
   * Sends bytes `start` to `end` (both included) under `contentRange`, or,
   * with no bytes, asks Drive what it has. Rejects when the connection
   * drops; throws a sign-in error itself.
   */
  send: (contentRange: string, start?: number, end?: number) => Promise<ResumableAnswer>;
  /** True for a failure worth trying again; a sign-in error isn't. */
  transient?: (error: unknown) => boolean;
  wait?: (ms: number) => Promise<void>;
  onBytes?: (sent: number) => void;
  piece?: number;
  retries?: number;
}

const NOT_TAKING = "Google Drive isn't taking the file. Save again in a moment.";

/** Sends a whole file resumably and gives back the finished file's metadata. */
export async function sendResumable(upload: ResumableUpload): Promise<unknown> {
  const { total } = upload;
  const piece = upload.piece ?? RESUMABLE_PIECE;
  const retries = upload.retries ?? RESUMABLE_RETRIES;
  const wait = upload.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const transient = upload.transient ?? ((error: unknown) => error instanceof TypeError);
  const worthAgain = (error: unknown) => (error instanceof ResumableHttpError ? TRANSIENT.has(error.status) : transient(error));
  const limit = requestLimit(total);
  let requests = 0;
  /** Failures in a row, each waited out. */
  let failures = 0;
  /** Sessions after the first. Never reset. */
  let restarts = 0;
  /** 308s in a row after which Drive had no more than it ever said. */
  let stalls = 0;
  /** The most bytes Drive has said it has, this session. */
  let best = 0;
  let offset = 0;
  let asking = false;
  const count = () => {
    if (++requests > limit) throw new Error('Google Drive never finished the upload.');
  };
  const failed = async () => {
    if (++failures > retries) throw new Error('The upload to Google Drive kept failing. Check your connection and save again.');
    await wait(backoffMs(failures) + Math.floor(Math.random() * 250));
  };
  const begin = async () => {
    for (;;) {
      count();
      try {
        await upload.begin();
        break;
      } catch (error) {
        if (!worthAgain(error)) throw error;
        await failed();
      }
    }
    offset = 0;
    best = 0;
    stalls = 0;
    asking = false;
  };
  const startOver = async () => {
    if (++restarts > RESUMABLE_RESTARTS) throw new Error(NOT_TAKING);
    await begin();
  };
  await begin();
  for (;;) {
    count();
    let answer: ResumableAnswer;
    let sentEnd = offset - 1;
    try {
      if (asking) {
        answer = await upload.send(`bytes */${total}`);
      } else {
        const next = pieceAt(offset, total, piece);
        sentEnd = next.end;
        answer = await upload.send(next.header, offset, next.end);
      }
    } catch (error) {
      if (!worthAgain(error)) throw error;
      await failed();
      asking = true;
      continue;
    }
    if (answer.status === 200 || answer.status === 201) {
      upload.onBytes?.(total);
      return answer.body();
    }
    if (answer.status === 308) {
      const known = answer.range !== null || !answer.rangeHidden;
      if (!known && asking) {
        // Nothing says how much arrived: start over rather than guess.
        await startOver();
        continue;
      }
      const next = known ? nextStart(answer.range) : sentEnd + 1;
      if (next >= total) {
        // Drive says it isn't finished, yet it has every byte, or the page thinks it sent them all.
        await startOver();
        continue;
      }
      if (known && next > best) {
        best = next;
        failures = 0;
        stalls = 0;
      } else if (!known) {
        // Taken on trust, so it never resets the stalls or the restarts.
        failures = 0;
      } else if (!asking && ++stalls > 2) {
        throw new Error(NOT_TAKING);
      }
      offset = next;
      asking = false;
      upload.onBytes?.(offset);
      continue;
    }
    if (answer.status === 404 || answer.status === 410) {
      // The session expired: Drive's rule is a new one from the first byte.
      await failed();
      await startOver();
      continue;
    }
    if (TRANSIENT.has(answer.status)) {
      await failed();
      asking = true;
      continue;
    }
    throw new Error(`Google Drive stopped the upload (HTTP ${answer.status}).`);
  }
}
