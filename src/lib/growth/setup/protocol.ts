// What the editor sends the Growth browser's driver (driver.ts) and what
// comes back. A control is named by the number the driver gave it in the
// last outline of the page (`ref`).

/**
 * The control as the app judged it, from `describe`. The driver acts only
 * while the control still matches, checked in the same moment it acts, so a
 * page that relabels a control after the user said yes gets nothing pressed.
 */
export interface Expected {
  name: string;
  role: string;
  /** A link's address. */
  href?: string | null;
}

export type DriverCommand =
  | { cmd: 'ping' }
  | { cmd: 'snapshot'; max?: number }
  | { cmd: 'describe'; ref: number }
  | { cmd: 'click'; ref: number; expect?: Expected }
  | { cmd: 'type'; ref: number; text: string; expect?: Expected }
  /**
   * `preview` finds the option without choosing it. `exact` takes only the
   * option with exactly that text, as a preview named it.
   */
  | { cmd: 'pick'; ref: number; option: string; preview?: boolean; exact?: boolean; expect?: Expected }
  | { cmd: 'scroll'; to?: 'up' | 'down' | 'top' | 'bottom' }
  | { cmd: 'point'; ref: number; note?: string }
  | { cmd: 'clear' }
  | { cmd: 'copied' };

export interface PingAnswer {
  url: string;
  title: string;
  ready: DocumentReadyState;
  /** How long since the page last changed. */
  quietMs: number;
  /** Requests the page has under way. */
  pending: number;
}

export interface PageSnapshot {
  url: string;
  title: string;
  /** The outline the assistant reads: headings, text, and numbered controls. */
  text: string;
  /** A sign-in form is on the page. */
  signIn: boolean;
  /** A dialog is open, and the outline shows only the dialog. */
  dialog: boolean;
  /** The outline stops before the end of the page. */
  cut: boolean;
}

export interface ActionAnswer {
  ok: boolean;
  error?: string;
  name?: string;
  picked?: string;
}

export interface ControlDescription {
  ok: boolean;
  error?: string;
  role?: string;
  name?: string;
  disabled?: boolean;
  shown?: boolean;
  href?: string | null;
  inDialog?: boolean;
  /** The title of the dialog the control sits in, empty when it has none. */
  dialog?: string | null;
}

export interface CopiedAnswer {
  texts: string[];
}
