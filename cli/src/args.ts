/**
 * A small argv parser. No dependency, because every runtime dependency this
 * package takes is one an agent has to wait for on `npx`.
 *
 * Supports  --flag  --key value  --key=value  -k value  and  --  passthrough.
 * Repeated keys collect into an array, so `--only a --only b` works and so
 * does `--only a,b`.
 */
export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
  passthrough: string[];
}

const KNOWN_NEGATIONS = /^no-(.+)$/;

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean | string[]> = {};
  const positionals: string[] = [];
  const passthrough: string[] = [];
  let sawDoubleDash = false;

  const set = (key: string, value: string | boolean) => {
    const existing = flags[key];
    if (existing === undefined) {
      flags[key] = value;
      return;
    }
    const arr = Array.isArray(existing) ? existing : [String(existing)];
    arr.push(String(value));
    flags[key] = arr;
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (sawDoubleDash) {
      passthrough.push(token);
      continue;
    }
    if (token === '--') {
      sawDoubleDash = true;
      continue;
    }
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        set(body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      const negated = KNOWN_NEGATIONS.exec(body);
      const next = argv[i + 1];
      if (negated) {
        set(negated[1], false);
        continue;
      }
      if (next !== undefined && !next.startsWith('-')) {
        set(body, next);
        i++;
      } else {
        set(body, true);
      }
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      const body = token.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        set(body, next);
        i++;
      } else {
        set(body, true);
      }
      continue;
    }
    positionals.push(token);
  }

  const command = positionals.shift() ?? 'help';
  return { command, positionals, flags, passthrough };
}

export function flagString(flags: ParsedArgs['flags'], key: string): string | undefined {
  const v = flags[key];
  if (v === undefined || v === true || v === false) return undefined;
  return Array.isArray(v) ? v[v.length - 1] : v;
}

export function flagBool(flags: ParsedArgs['flags'], key: string, fallback = false): boolean {
  const v = flags[key];
  if (v === undefined) return fallback;
  if (typeof v === 'boolean') return v;
  const s = Array.isArray(v) ? v[v.length - 1] : v;
  return s !== 'false' && s !== '0' && s !== 'no';
}

export function flagNumber(flags: ParsedArgs['flags'], key: string): number | undefined {
  const s = flagString(flags, key);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** `--only a --only b` and `--only a,b` both give ['a','b']. */
export function flagList(flags: ParsedArgs['flags'], key: string): string[] | undefined {
  const v = flags[key];
  if (v === undefined || typeof v === 'boolean') return undefined;
  const raw = Array.isArray(v) ? v : [v];
  const out = raw
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
  return out.length ? out : undefined;
}
