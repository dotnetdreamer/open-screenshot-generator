// Google Drive's resumable upload (src/lib/account/resumable.ts) against a
// Drive of our own in memory: one that keeps every byte, one that keeps part
// of a piece, one that answers 308 without a Range (it has nothing), drops
// the connection, fails with 503, lets a session expire, or hides its Range
// header from the page as a browser does across origins. Each upload must
// end with exactly the file's bytes in Drive, or fail out loud.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESUMABLE_PIECE,
  RESUMABLE_QUANTUM,
  RESUMABLE_RESTARTS,
  ResumableHttpError,
  backoffMs,
  nextStart,
  pieceAt,
  requestLimit,
  sendResumable,
  type ResumableAnswer,
} from '@/lib/account/resumable';

const PIECE = RESUMABLE_QUANTUM * 2;

function fileOf(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
  return bytes;
}

interface Behaviour {
  /** Called for each piece Drive gets; returns how many of its bytes Drive keeps. */
  keep?: (start: number, length: number, call: number) => number;
  /** Throws a TypeError, as fetch does when the connection drops, on these calls. */
  dropOn?: Set<number>;
  /** Answers with this status instead, on these calls. */
  statusOn?: Map<number, number>;
  /** Leaves the Range header off a 308 even when Drive has bytes (Drive's rule says it then has none). */
  noRangeOn?: Set<number>;
  /** The browser hides the Range header from the page. */
  hidden?: boolean;
  /** The session expires on this call: everything Drive had is gone. */
  expireOn?: number;
}

class FakeDrive {
  received = new Uint8Array(0);
  sessions = 0;
  calls = 0;
  waits: number[] = [];
  readonly log: string[] = [];

  constructor(
    private readonly file: Uint8Array,
    private readonly behaviour: Behaviour = {}
  ) {}

  private answer(status: number): ResumableAnswer {
    const has = this.received.length;
    const range = status === 308 && has > 0 && !this.behaviour.hidden && !this.behaviour.noRangeOn?.has(this.calls) ? `bytes=0-${has - 1}` : null;
    return {
      status,
      range,
      rangeHidden: !!this.behaviour.hidden && status === 308,
      body: async () => ({ id: 'file1', size: String(this.received.length) }),
    };
  }

  begin = async () => {
    this.sessions++;
    this.received = new Uint8Array(0);
    this.log.push('begin');
  };

  send = async (contentRange: string, start?: number, end?: number): Promise<ResumableAnswer> => {
    const call = ++this.calls;
    if (this.behaviour.expireOn === call) {
      this.received = new Uint8Array(0);
      this.log.push(`${call} expired`);
      return this.answer(404);
    }
    if (this.behaviour.dropOn?.has(call)) {
      this.log.push(`${call} dropped`);
      // The bytes may have arrived before the connection went.
      if (start !== undefined && end !== undefined && start === this.received.length) this.take(start, this.file.subarray(start, end + 1));
      throw new TypeError('Failed to fetch');
    }
    const status = this.behaviour.statusOn?.get(call);
    if (status) {
      this.log.push(`${call} ${status}`);
      return this.answer(status);
    }
    if (start === undefined || end === undefined) {
      assert.match(contentRange, /^bytes \*\/\d+$/);
      this.log.push(`${call} ask`);
      return this.answer(this.received.length === this.file.length ? 200 : 308);
    }
    assert.equal(contentRange, `bytes ${start}-${end}/${this.file.length}`);
    this.log.push(`${call} ${start}-${end}`);
    // Drive takes a piece only where its bytes so far end.
    if (start === this.received.length) {
      const keep = this.behaviour.keep ? this.behaviour.keep(start, end - start + 1, call) : end - start + 1;
      this.take(start, this.file.subarray(start, start + keep));
    }
    return this.answer(this.received.length === this.file.length ? 201 : 308);
  };

  private take(start: number, bytes: Uint8Array) {
    const next = new Uint8Array(start + bytes.length);
    next.set(this.received.subarray(0, start));
    next.set(bytes, start);
    this.received = next;
  }

  wait = async (ms: number) => {
    this.waits.push(ms);
  };
}

async function upload(drive: FakeDrive, total: number) {
  return sendResumable({ total, begin: drive.begin, send: drive.send, wait: drive.wait, piece: PIECE });
}

test('resumable: pieces are whole multiples of 256 KiB, and a Range says where to go on', () => {
  const total = RESUMABLE_PIECE * 2 + 1000;
  const first = pieceAt(0, total);
  assert.equal(first.header, `bytes 0-${RESUMABLE_PIECE - 1}/${total}`);
  assert.equal((first.end + 1) % RESUMABLE_QUANTUM, 0);
  const last = pieceAt(RESUMABLE_PIECE * 2, total);
  assert.equal(last.end, total - 1);
  assert.throws(() => pieceAt(0, total, 1000));
  assert.equal(nextStart('bytes=0-262143'), 262144);
  // Drive's rule: a 308 without a Range has none of the file.
  assert.equal(nextStart(null), 0);
  assert.equal(backoffMs(1), 1000);
  assert.equal(backoffMs(3), 4000);
  assert.equal(backoffMs(9), 16000);
});

test('resumable: a file goes up piece by piece and arrives whole', async () => {
  const file = fileOf(PIECE * 3 + 12345);
  const drive = new FakeDrive(file);
  const done = (await upload(drive, file.length)) as { size: string };
  assert.deepEqual(drive.received, file);
  assert.equal(done.size, String(file.length));
  assert.equal(drive.sessions, 1);
  assert.equal(drive.calls, 4);
});

test('resumable: Drive keeping part of a piece gets the rest sent again', async () => {
  const file = fileOf(PIECE * 3);
  const drive = new FakeDrive(file, { keep: (_start, length, call) => (call === 1 ? RESUMABLE_QUANTUM : length) });
  await upload(drive, file.length);
  assert.deepEqual(drive.received, file);
  assert.match(drive.log.join(' '), new RegExp(`2 ${RESUMABLE_QUANTUM}-`));
});

test('resumable: a 308 without a Range means Drive has nothing, so the upload starts from the first byte again', async () => {
  const file = fileOf(PIECE * 2 + 10);
  // The first piece is lost on Drive's side: it answers 308 with no Range.
  const drive = new FakeDrive(file, { keep: (_s, length, call) => (call === 1 ? 0 : length) });
  await upload(drive, file.length);
  assert.deepEqual(drive.received, file);
  assert.equal(drive.log[2], `2 0-${PIECE - 1}`, 'the second request sends the first piece again');
});

test('resumable: a dropped connection is waited out, then Drive is asked what it has', async () => {
  const file = fileOf(PIECE * 3);
  const drive = new FakeDrive(file, { dropOn: new Set([2]) });
  await upload(drive, file.length);
  assert.deepEqual(drive.received, file);
  assert.equal(drive.log[3], '3 ask');
  assert.equal(drive.waits.length, 1);
  assert.equal(drive.sessions, 1);
});

test('resumable: a server error is waited out with longer and longer waits', async () => {
  const file = fileOf(PIECE * 2);
  const drive = new FakeDrive(file, { statusOn: new Map([[2, 503], [3, 503], [4, 500]]) });
  await upload(drive, file.length);
  assert.deepEqual(drive.received, file);
  assert.equal(drive.waits.length, 3);
  assert.ok(drive.waits[0] < drive.waits[1] && drive.waits[1] < drive.waits[2], `waits grow: ${drive.waits}`);
});

test('resumable: an expired session starts a new one from the first byte', async () => {
  const file = fileOf(PIECE * 3);
  const drive = new FakeDrive(file, { expireOn: 2 });
  await upload(drive, file.length);
  assert.deepEqual(drive.received, file);
  assert.equal(drive.sessions, 2);
});

test('resumable: with the Range hidden by the browser, pieces are taken as received', async () => {
  const file = fileOf(PIECE * 3 + 99);
  const drive = new FakeDrive(file, { hidden: true });
  const done = (await upload(drive, file.length)) as { size: string };
  assert.deepEqual(drive.received, file);
  assert.equal(done.size, String(file.length));
  assert.equal(drive.calls, 4);
});

test('resumable: with the Range hidden, a dropped connection starts the upload over rather than guess', async () => {
  const file = fileOf(PIECE * 3);
  const drive = new FakeDrive(file, { hidden: true, dropOn: new Set([2]) });
  await upload(drive, file.length);
  assert.deepEqual(drive.received, file);
  assert.equal(drive.sessions, 2);
});

test('resumable: a connection that never comes back fails out loud', async () => {
  const file = fileOf(PIECE * 2);
  const drive = new FakeDrive(file, { dropOn: new Set(Array.from({ length: 50 }, (_, i) => i + 1)) });
  await assert.rejects(upload(drive, file.length), /kept failing/);
  assert.equal(drive.waits.length, 6);
});

test('resumable: a Drive that keeps nothing fails rather than loop', async () => {
  const file = fileOf(PIECE * 2);
  const drive = new FakeDrive(file, { keep: () => 0 });
  await assert.rejects(upload(drive, file.length), /isn't taking the file/);
  assert.ok(drive.calls < 10, `gave up after ${drive.calls} requests`);
});

test('resumable: a sign-in error is not waited out', async () => {
  class SignIn extends Error {}
  let calls = 0;
  await assert.rejects(
    sendResumable({
      total: PIECE * 2,
      begin: async () => {},
      send: async () => {
        calls++;
        throw new SignIn('expired');
      },
      transient: (error) => !(error instanceof SignIn),
      wait: async () => {},
      piece: PIECE,
    }),
    SignIn
  );
  assert.equal(calls, 1);
});

test('resumable: with the Range hidden, a Drive that keeps part of every first piece gives up after three new starts', async () => {
  // The audit's case: each 308 looked like progress, so the limit on new starts was reset each time.
  const file = fileOf(PIECE * 2);
  const drive = new FakeDrive(file, { hidden: true, keep: (start, length) => (start === 0 ? RESUMABLE_QUANTUM : length) });
  await assert.rejects(upload(drive, file.length), /isn't taking the file/);
  assert.equal(drive.sessions, 1 + RESUMABLE_RESTARTS);
  assert.ok(drive.calls <= 2 * (1 + RESUMABLE_RESTARTS), `gave up after ${drive.calls} requests`);
});

test('resumable: a Drive that takes one byte at a time is given up on at the request limit', { timeout: 10_000 }, async () => {
  // Each answer is real progress, so only the cap on requests ends it.
  const file = fileOf(PIECE * 2);
  const drive = new FakeDrive(file, { keep: () => 1 });
  await assert.rejects(upload(drive, file.length), /never finished/);
  assert.equal(drive.sessions + drive.calls, requestLimit(file.length));
});

test('resumable: starting the session is waited out like a piece, and a refusal is not', async () => {
  const file = fileOf(PIECE * 2);
  const drive = new FakeDrive(file);
  let tries = 0;
  // A dropped connection, then a server error, then the session starts.
  const begin = async () => {
    tries++;
    if (tries === 1) throw new TypeError('Failed to fetch');
    if (tries === 2) throw new ResumableHttpError(503, 'Google Drive did not start the upload (HTTP 503).');
    await drive.begin();
  };
  await sendResumable({ total: file.length, begin, send: drive.send, wait: drive.wait, piece: PIECE });
  assert.deepEqual(drive.received, file);
  assert.equal(tries, 3);
  assert.equal(drive.waits.length, 2);
  // A refusal (403) ends the upload at once.
  let refused = 0;
  const refuse = async () => {
    refused++;
    throw new ResumableHttpError(403, 'Google Drive did not start the upload (HTTP 403).');
  };
  await assert.rejects(sendResumable({ total: file.length, begin: refuse, send: drive.send, wait: drive.wait, piece: PIECE }), /HTTP 403/);
  assert.equal(refused, 1);
  // A session that never starts fails out loud.
  let down = 0;
  const never = async () => {
    down++;
    throw new ResumableHttpError(503, 'Google Drive did not start the upload (HTTP 503).');
  };
  await assert.rejects(sendResumable({ total: file.length, begin: never, send: drive.send, wait: drive.wait, piece: PIECE }), /kept failing/);
  assert.equal(down, 7);
});

test('resumable: any mix of losses still ends with exactly the file in Drive, or fails within its limits', async () => {
  // A seeded walk over drops, partial pieces, missing Ranges, server errors
  // and expired sessions, with Drive's Range readable (200 runs) and hidden
  // by the browser (100 runs).
  let seed = 12345;
  const random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const finished = { shown: 0, hidden: 0 };
  for (let run = 0; run < 300; run++) {
    const hidden = run >= 200;
    const file = fileOf(Math.floor(PIECE * (1 + random() * 4)));
    const drops = new Set<number>();
    const statuses = new Map<number, number>();
    const noRange = new Set<number>();
    for (let call = 1; call < 40; call++) {
      const roll = random();
      if (roll < 0.08) drops.add(call);
      else if (roll < 0.14) statuses.set(call, 503);
      else if (roll < 0.18) noRange.add(call);
    }
    const partial = random() < 0.5;
    const expireOn = random() < 0.1 ? 1 + Math.floor(random() * 8) : undefined;
    const drive = new FakeDrive(file, {
      hidden,
      dropOn: drops,
      statusOn: statuses,
      noRangeOn: noRange,
      expireOn,
      keep: partial ? (_s, length, call) => (call % 3 === 0 ? Math.min(length, RESUMABLE_QUANTUM) : length) : undefined,
    });
    try {
      const done = (await upload(drive, file.length)) as { size: string };
      // With the Range hidden, the caller checks the size; it has to say the file is whole.
      assert.equal(done.size, String(file.length), `run ${run}: ${drive.log.join(', ')}`);
      assert.deepEqual(drive.received, file, `run ${run}: ${drive.log.join(', ')}`);
      finished[hidden ? 'hidden' : 'shown']++;
    } catch (error) {
      // Giving up is allowed; a wrong file is not.
      assert.match(String(error), /kept failing|isn't taking/, `run ${run}: ${drive.log.join(', ')}`);
    }
    assert.ok(drive.sessions <= 1 + RESUMABLE_RESTARTS, `run ${run} started ${drive.sessions} sessions`);
    assert.ok(drive.sessions + drive.calls <= requestLimit(file.length), `run ${run} made ${drive.calls} requests`);
  }
  // Losses this common still let nearly every upload finish where Drive's Range can be read.
  assert.ok(finished.shown >= 180, `${finished.shown} of 200 finished`);
  // Behind a hidden Range every loss starts over, so fewer finish, but some do.
  assert.ok(finished.hidden >= 20, `${finished.hidden} of 100 finished with the Range hidden`);
});
