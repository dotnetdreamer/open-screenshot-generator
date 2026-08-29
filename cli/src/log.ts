/**
 * Output. Two audiences: a person reading a terminal, and an agent parsing
 * --json. Everything human goes to stderr so that stdout stays a clean data
 * channel; `osg templates --json | jq` and `osg mcp --stdio` both depend on
 * nothing else ever touching stdout.
 */
let jsonMode = false;
let verbose = false;
let quiet = false;

export function configureOutput(options: { json?: boolean; verbose?: boolean; quiet?: boolean }): void {
  jsonMode = !!options.json;
  verbose = !!options.verbose;
  quiet = !!options.quiet;
}

export const isJsonMode = () => jsonMode;

const color = (code: string, s: string) =>
  process.stderr.isTTY && !process.env.NO_COLOR ? `\u001b[${code}m${s}\u001b[0m` : s;

export const dim = (s: string) => color('2', s);
export const bold = (s: string) => color('1', s);
export const green = (s: string) => color('32', s);
export const yellow = (s: string) => color('33', s);
export const red = (s: string) => color('31', s);
export const cyan = (s: string) => color('36', s);

/** A human-facing line. Suppressed by --quiet, never present in --json stdout. */
export function info(message: string): void {
  if (!quiet) process.stderr.write(`${message}\n`);
}

export function step(message: string): void {
  info(`${cyan('>')} ${message}`);
}

export function ok(message: string): void {
  info(`${green('ok')} ${message}`);
}

export function warn(message: string): void {
  process.stderr.write(`${yellow('warn')} ${message}\n`);
}

export function fail(message: string): void {
  process.stderr.write(`${red('FAIL')} ${message}\n`);
}

export function debug(message: string): void {
  if (verbose) process.stderr.write(`${dim(`  ${message}`)}\n`);
}

/** The one channel that writes stdout. Everything machine-readable goes here. */
export function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Bytes, for the asset and cache reporting. */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function humanMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
