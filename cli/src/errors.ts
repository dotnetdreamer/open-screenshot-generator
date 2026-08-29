/**
 * Exit codes are contractual, because the CLI is driven by agents and CI as
 * much as by people. An agent that sees 3 knows the render happened and the
 * files are wrong; one that sees 2 knows nothing was produced.
 *
 *   0  ok
 *   1  usage, config or environment error (the user can fix it before running again)
 *   2  driver or render failure (the browser, the page, or a tool call)
 *   3  verify failure (files exist, a store rule rejects them)
 */
export const EXIT = { ok: 0, usage: 1, driver: 2, verify: 3 } as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class OsgError extends Error {
  readonly code: ExitCode;
  /** One actionable line printed under the message. Never a stack trace. */
  readonly fix?: string;
  /** Extra context an agent can parse in --json mode. */
  readonly detail?: Record<string, unknown>;

  constructor(message: string, options: { code?: ExitCode; fix?: string; detail?: Record<string, unknown> } = {}) {
    super(message);
    this.name = 'OsgError';
    this.code = options.code ?? EXIT.usage;
    this.fix = options.fix;
    this.detail = options.detail;
  }
}

export function usageError(message: string, fix?: string): OsgError {
  return new OsgError(message, { code: EXIT.usage, fix });
}

export function driverError(message: string, fix?: string, detail?: Record<string, unknown>): OsgError {
  return new OsgError(message, { code: EXIT.driver, fix, detail });
}

export function verifyError(message: string, detail?: Record<string, unknown>): OsgError {
  return new OsgError(message, { code: EXIT.verify, detail });
}
