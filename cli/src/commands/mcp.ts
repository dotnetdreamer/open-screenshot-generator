/**
 * `osg mcp` - all the design tools, over MCP, for any coding agent.
 *
 * This is the part of the package with no equivalent anywhere else: Claude
 * Code, Claude Desktop, Cursor, VS Code, Codex and anything else that speaks
 * MCP get the editor's full tool surface on any operating system, with no
 * desktop app installed and no hosted relay in the middle. The tools are not
 * reimplemented here; every call lands in `runMcpRequest` inside the real
 * editor page, which is the same function the desktop app's Rust transport and
 * the web build's relay both call.
 *
 * Two things make it feel instant rather than heavy:
 *
 *   - `initialize`, `ping` and `tools/list` are answered from a manifest
 *     generated at build time, with no browser at all. Every client calls
 *     tools/list at session start, and paying a browser boot for a handshake
 *     would make the server feel broken.
 *   - The browser starts on the first `tools/call` and then stays warm for the
 *     life of the connection.
 *
 * One capability appears here that no other transport has: `export_png` and
 * `export_all` with `save: true` actually write files. In the browser that
 * throws, because a tab cannot write to disk; the CLI catches the result and
 * writes the bytes itself.
 */
import type { CommandContext } from '../context.js';
import { EXIT, usageError } from '../errors.js';
import { flagBool, flagNumber } from '../args.js';
import { info, step } from '../log.js';

export async function run(ctx: CommandContext): Promise<number> {
  const wantsHttp = flagBool(ctx.args.flags, 'http', false);
  const wantsStdio = flagBool(ctx.args.flags, 'stdio', false);

  if (wantsHttp && wantsStdio) {
    throw usageError('Choose one transport: --stdio or --http', 'Most agents want --stdio.');
  }

  if (wantsHttp) {
    const { serveHttp } = await import('../mcp/http.js');
    const port = flagNumber(ctx.args.flags, 'port') ?? 8722;
    step(`MCP over HTTP on http://127.0.0.1:${port}/mcp`);
    info('Add that URL to your AI client, then leave this running.');
    await serveHttp(ctx, port);
    return EXIT.ok;
  }

  // stdio is the default because it is what every agent config expects, and
  // because it needs no port, no firewall prompt and no shared secret.
  const { serveStdio } = await import('../mcp/stdio.js');
  await serveStdio(ctx);
  return EXIT.ok;
}
