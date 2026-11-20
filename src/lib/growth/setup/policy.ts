// What the Ask AI assistant may do in the Growth browser, decided here and
// not by the model: which sites it opens, which clicks need the user's yes,
// which it never makes, where it may type, and whether a value it wants to
// save is one it really read.
//
// The pages are the user's own App Store Connect, Google Cloud, Play
// Console, Search Console and Google Analytics, signed in. Page text is written by other people too (app names,
// review text), so nothing a page says can widen any of this.

import { bucketFromUri } from '../play';
import { hasSecret } from './secrets';

/** Sites the assistant may open. Rust checks the same list (OPEN_HOSTS in growth_browser.rs). */
export const OPEN_HOSTS = [
  'appstoreconnect.apple.com',
  'developer.apple.com',
  'console.cloud.google.com',
  'play.google.com',
  'support.google.com',
  'developers.google.com',
  // For the SEO view's Google setup: adding the key's email as a user.
  'search.google.com',
  'analytics.google.com',
] as const;

export function mayOpen(address: string): boolean {
  try {
    const url = new URL(address);
    return url.protocol === 'https:' && !url.port && (OPEN_HOSTS as readonly string[]).includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Words on a control the assistant never presses: nothing is deleted, revoked or handed over. */
const NEVER =
  /\b(delete|remove|revoke|deactivate|disable|deny|reject|sign ?out|log ?out|transfer|reset|shut ?down|archive|terminate|unpublish|withdraw|leave|regenerate|rotate|cancel (?:my |your |the )?(?:subscription|membership|plan|account)|close (?:my |your |the )?account|change password|pay|purchase|buy)\b/i;

/**
 * Words on a control that changes the account: the user says yes first. That
 * includes a control that only opens the form where the change is made, such
 * as "Generate API Key" before the dialog's "Generate": a label cannot say
 * which of the two it does, so both are asked about. "Add" grants access in
 * Search Console ("Add user") and Analytics.
 */
const ASK = /\b(add|generate|create|enable|invite|send|grant|save|apply|submit|confirm|agree|accept|request|allow|publish|upload|verify|share|connect|turn on)\b/i;

/**
 * Controls that move around a page or fill in a form, which a strict job
 * presses without asking: the form's own Add, Save or Create asks.
 */
const FREE_ROLES = new Set(['link', 'tab', 'treeitem', 'option', 'checkbox', 'radio', 'textbox', 'searchbox', 'combobox', 'slider', 'spinbutton']);

/**
 * Labels of buttons that only open a menu, a search box or help, which a
 * strict job presses without asking. Next, Copy and Refresh are not here: a
 * wizard's Next can save its step, and Copy changes what the user has copied.
 */
const MOVES_ONLY =
  /^(more|more options|more actions|show more|show less|see more|expand|collapse|menu|main menu|navigation menu|open navigation menu|search|learn more|help|select a project|select project)$/i;

/** Labels that finish a step, on a link as much as on a button: a strict job asks before them. */
const FINISHES = /^(done|continue|finish|next|complete)\b/i;

/** Labels that only close a box or go back. */
const DISMISS = /^(cancel|close|no|no thanks|not now|back|previous|dismiss|later|maybe later|got it)$/i;

/**
 * Bare answers that say yes to whatever is asked around them. "Continue"
 * counts in a dialog only: on a page it mostly moves a form along.
 */
const CONFIRM = /^(ok|okay|yes|proceed|i understand|i agree|sure)\b/i;

/**
 * A label that says yes without saying to what ("OK", "Continue"), so the
 * question to the user names the dialog around it.
 */
export function isBareAnswer(label: string): boolean {
  return CONFIRM.test(label.trim()) || /^(continue|confirm|accept|agree|done)$/i.test(label.trim());
}

export type ClickVerdict =
  | { kind: 'free' }
  | { kind: 'ask'; reason: string }
  | { kind: 'never'; reason: string };

/** Where a control is: the title of the dialog it sits in, and what kind of control the page says it is. */
export interface ControlPlace {
  dialog?: string | null;
  role?: string | null;
  /**
   * The SEO view's Google setup: a button or a menu item asks whatever it
   * says, unless it only closes, cancels, goes back, or opens a menu, a
   * search box or help. A link, a tab or a form field asks when its label
   * finishes a step (Done, Continue, Next). The label lists alone can't
   * promise a yes before every change on pages this varied.
   */
  strict?: boolean;
}

/**
 * What a click on the control named `name` needs, wherever it sits: a link
 * or a tab can change the account as well as a button can. The model marks
 * a click it expects to change something (`changes`), which is asked about
 * whatever the control says. Inside a dialog the dialog's title counts too,
 * so "OK" in "Revoke API key?" is never pressed, while "OK" elsewhere is
 * asked about.
 */
export function judgeClick(name: string, changes = false, place: ControlPlace = {}): ClickVerdict {
  const label = name.trim();
  const dialog = place.dialog?.trim() || null;
  if (NEVER.test(label)) {
    return { kind: 'never', reason: `The assistant never presses "${label}". If you want that, press it yourself.` };
  }
  if (dialog && NEVER.test(dialog) && !DISMISS.test(label)) {
    return { kind: 'never', reason: `The assistant never presses "${label}" in "${dialog}". If you want that, press it yourself.` };
  }
  if (changes || ASK.test(label)) return { kind: 'ask', reason: label };
  if (CONFIRM.test(label) || (dialog && /^continue\b/i.test(label))) return { kind: 'ask', reason: label };
  if (place.strict && FINISHES.test(label)) return { kind: 'ask', reason: label };
  if (place.strict && !FREE_ROLES.has(place.role ?? '') && !DISMISS.test(label) && !MOVES_ONLY.test(label)) return { kind: 'ask', reason: label };
  return { kind: 'free' };
}

/**
 * What choosing `option` in the list named `list` needs. A page can act on
 * the choice at once, so it follows the same words a click does.
 */
export function judgePick(list: string, option: string, changes = false, place: ControlPlace = {}): ClickVerdict {
  const name = list.trim();
  const choice = option.trim();
  const dialog = place.dialog?.trim() || null;
  if (NEVER.test(choice) || NEVER.test(name) || (dialog && NEVER.test(dialog))) {
    return {
      kind: 'never',
      reason: `The assistant never chooses "${choice}"${name ? ` in "${name}"` : ''}. If you want that, choose it yourself.`,
    };
  }
  if (changes || ASK.test(choice)) return { kind: 'ask', reason: choice };
  return { kind: 'free' };
}

/** Whether text the assistant wants to type is safe to type. */
export function judgeTyping(text: string): string | null {
  if (text.length > 200) return 'That is too long to type here';
  if (/PRIVATE KEY|"private_key"/i.test(text) || hasSecret(text)) return 'A key is never typed into a page';
  return null;
}

// --- values the assistant saves --------------------------------------------------------

const ISSUER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_ID = /^[A-Z0-9]{10}$/;
const VENDOR = /^\d{6,12}$/;
const PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

export const valid = {
  issuerId: (value: string) => ISSUER.test(value.trim()),
  keyId: (value: string) => KEY_ID.test(value.trim()),
  vendorNumber: (value: string) => VENDOR.test(value.trim()),
  packageName: (value: string) => PACKAGE.test(value.trim()) && value.trim().length <= 150,
  reportsUri: (value: string) => /^gs:\/\/pubsite_prod_/i.test(value.trim()) && !!bucketFromUri(value),
  googleApiKey: (value: string) => /^AIza[0-9A-Za-z_-]{35}$/.test(value.trim()),
};

const WORD = /[a-z0-9_]/i;

/**
 * Whether the match at `index` stands on its own, rather than being part of
 * a longer number or name: 85012345 is not read from 1850123459, nor
 * com.example.app from com.example.app.debug.
 */
function standsAlone(source: string, index: number, length: number): boolean {
  const before = source[index - 1] ?? '';
  const after = source[index + length] ?? '';
  if (WORD.test(before) || WORD.test(after)) return false;
  if ((before === '.' || before === '-') && WORD.test(source[index - 2] ?? '')) return false;
  if ((after === '.' || after === '-') && WORD.test(source[index + length + 1] ?? '')) return false;
  return true;
}

/**
 * Whether `value` was really read: it appears, whole, in a page the browser
 * showed, something the page copied, a key file's name, or what the user
 * typed. A model that remembers an id wrongly, makes one up, or takes it out
 * of a longer number saves nothing.
 */
export function seenIn(value: string, sources: readonly string[]): boolean {
  const needle = value.trim().toLowerCase();
  if (needle.length < 4) return false;
  return sources.some((source) => {
    const haystack = source.toLowerCase();
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
      if (standsAlone(haystack, at, needle.length)) return true;
    }
    return false;
  });
}

/** Apple names a key file AuthKey_<KEY ID>.p8. */
export function keyIdFromFileName(fileName: string): string | null {
  const match = /AuthKey_([A-Z0-9]{10})\.p8$/i.exec(fileName.trim());
  return match ? match[1].toUpperCase() : null;
}

/** The Issuer ID on an App Store Connect page, when the page shows exactly one. */
export function issuerIdOnPage(text: string): string | null {
  const near = /Issuer ID[^0-9a-f]{0,40}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(text);
  if (near) return near[1].toLowerCase();
  const all = new Set((text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []).map((id) => id.toLowerCase()));
  return /Issuer ID/i.test(text) && all.size === 1 ? [...all][0] : null;
}

/** A pasted .p8 or service account JSON, so a key typed into the chat never reaches a model. */
export function keyInText(text: string): 'apple-key' | 'play-key' | null {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
    return /"private_key"\s*:/.test(text) ? 'play-key' : 'apple-key';
  }
  if (/"type"\s*:\s*"service_account"/.test(text)) return 'play-key';
  return null;
}
