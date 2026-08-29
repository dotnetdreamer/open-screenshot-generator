/**
 * MCP over stdio: newline delimited JSON-RPC on stdin and stdout.
 *
 * This is the transport every agent config actually uses, because it needs no
 * port, no CORS, no firewall prompt and no long lived process to babysit: the
 * client spawns `npx open-screenshot-generator mcp --stdio` and owns its
 * lifetime. It is also the transport with the single sharpest failure mode.
 * Stdout is the wire. One stray `console.log`, one progress bar, one banner,
 * and the client's parser gets a line that is not JSON and drops the session
 * with an error that names nothing useful. That is why log.ts sends every
 * human line to stderr, and why the writes below are the only thing in the
 * whole CLI that may touch stdout during `osg mcp --stdio`.
 *
 * `emit()` is deliberately not used here even though it is the sanctioned
 * stdout channel: it pretty prints across several lines, and a framing that
 * says "one message per line" cannot carry a message written over twelve.
 */
import { StringDecoder } from 'node:string_decoder';
import type { CommandContext } from '../context.js';
import { EXIT } from '../errors.js';
import { debug, info, warn } from '../log.js';
import { dispatch, isJsonRpcRequest, lazySession, rpcError, toolCount } from './tools.js';

export async function serveStdio(ctx: CommandContext): Promise<number> {
  if (ctx.json) {
    // Not an error worth failing on, but the user should know the flag did
    // nothing: there is no room on stdout for a report.
    warn('--json is ignored with --stdio, stdout carries the JSON-RPC stream');
  }

  const getSession = lazySession(ctx);
  const count = toolCount();
  info(count === null ? 'mcp stdio ready' : `mcp stdio ready, ${count} design tools`);

  const write = (payload: unknown) => {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };

  /** Work still owed a reply, so a client that closes the pipe still gets its last answer. */
  const inFlight = new Set<Promise<void>>();
  const track = (work: Promise<void>) => {
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work));
  };

  const answer = (message: unknown) =>
    dispatch(message, getSession).then(
      (response) => write(response),
      (error) => {
        // dispatch already turns failures into responses, so reaching here
        // means the transport itself broke. Say so on the wire rather than
        // leaving the client waiting on an id that will never come back.
        const id = (message as { id?: unknown })?.id ?? null;
        write(rpcError(id, -32603, error instanceof Error ? error.message : String(error)));
      }
    );

  const handleLine = (line: string) => {
    const text = line.trim();
    if (!text) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      write(rpcError(null, -32700, 'invalid JSON'));
      return;
    }

    if (Array.isArray(parsed)) {
      // Batches are rare in modern clients but cheap to support: answer the
      // requests, drop the notifications, and write nothing at all if the
      // batch held nothing that wanted an answer.
      const requests = parsed.filter(isJsonRpcRequest);
      if (!requests.length) return;
      track(
        Promise.all(requests.map((message) => dispatch(message, getSession))).then((responses) => write(responses))
      );
      return;
    }

    if (!isJsonRpcRequest(parsed)) {
      // A notification (notifications/initialized, notifications/cancelled) or
      // a stray response. Both get silence, which is what the spec asks for.
      debug(`stdio: ignoring ${(parsed as { method?: string })?.method ?? 'non-request message'}`);
      return;
    }

    track(answer(parsed));
  };

  return await new Promise<number>((resolve) => {
    // A decoder rather than setEncoding, because a chunk boundary can land in
    // the middle of a multi byte character and half a character in the buffer
    // would corrupt the JSON around it.
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let settled = false;

    const finish = async () => {
      if (settled) return;
      settled = true;
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      process.stdin.pause();
      if (inFlight.size) {
        debug(`stdio: draining ${inFlight.size} in flight request(s)`);
        await Promise.allSettled([...inFlight]);
      }
      resolve(EXIT.ok);
    };

    const onData = (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        handleLine(line);
        newline = buffer.indexOf('\n');
      }
    };

    const onEnd = () => {
      // A last message with no trailing newline is still a message.
      buffer += decoder.end();
      if (buffer.trim()) handleLine(buffer);
      buffer = '';
      void finish();
    };

    const onError = (error: Error) => {
      warn(`stdin: ${error.message}`);
      void finish();
    };

    const onSignal = () => {
      info('mcp stdio stopping');
      void finish();
    };

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    // Attaching a data listener resumes the stream, but be explicit: a paused
    // stdin is the difference between a working server and one that hangs
    // before it has read a byte.
    process.stdin.resume();
  });
}
