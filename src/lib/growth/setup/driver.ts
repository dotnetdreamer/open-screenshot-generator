/**
 * Runs inside the Growth browser (growth_browser.rs), on App Store Connect,
 * Google Cloud and Play Console pages, so the Ask AI assistant can read a
 * page and act on it.
 *
 * Injected as an initialization script, so it runs before the page's own
 * scripts on every page the browser loads. The page can call none of the
 * app's commands. The app reaches the page: Rust calls `window.__osgGrowthDriver.run`
 * with one command as JSON and passes the answer back. Every answer is a
 * string of JSON, written with the JSON object as it was before the page's
 * scripts ran, because Rust can only take a plain string back safely.
 *
 * The outline it writes (`snapshot`) gives each control a number. The
 * assistant names a control by that number, and the same element keeps its
 * number for as long as it stays on the page.
 *
 * Bundled to src-tauri/growth-browser/driver.js by `npm run build:growth-browser`.
 */

import type { DriverCommand, Expected } from './protocol';
import { HIDDEN_KEY, hasSecret, redactSecrets } from './secrets';

declare global {
  interface Window {
    __osgGrowthDriver?: { run: (command: DriverCommand) => string };
    /** Set by the e2e harness, whose stand-in browser is a frame. */
    __osgDriverInFrame?: boolean;
  }
}

(() => {
  // Tauri injects this into the page only, never its frames; the check keeps
  // it that way where an engine runs init scripts in every frame.
  if ((window.top !== window && !window.__osgDriverInFrame) || window.__osgGrowthDriver) return;

  // Taken before any page script can change them.
  const stringify = JSON.stringify.bind(JSON);
  const define = Object.defineProperty;
  const valueSetter = (proto: object) => Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const inputValue = valueSetter(HTMLInputElement.prototype);
  const textareaValue = valueSetter(HTMLTextAreaElement.prototype);
  const selectValue = valueSetter(HTMLSelectElement.prototype);
  const PlainEvent = Event;
  const TypedEvent = InputEvent;
  const Pointer = PointerEvent;
  const Mouse = MouseEvent;
  const now = () => performance.now();
  // Each page the browser loads gets its own driver, and numbers start again
  // at 1. A control judged on one page must never be pressed on the next.
  const DOCUMENT = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

  // An element in a frame from the same site belongs to that frame's window,
  // whose HTMLInputElement is another object than this one, so `instanceof`
  // misses it and a password box in a frame would pass for a text box. Tag
  // names hold in every frame.
  const HTML = 'http://www.w3.org/1999/xhtml';
  const is = <K extends keyof HTMLElementTagNameMap>(el: Element, tag: K): el is HTMLElementTagNameMap[K] =>
    el.namespaceURI === HTML && el.localName === tag;
  const htmlElement = (el: Element): HTMLElement | null =>
    el.namespaceURI === HTML && typeof (el as HTMLElement).click === 'function' ? (el as HTMLElement) : null;

  // --- what the page is doing -----------------------------------------------------

  let lastChange = now();
  let pending = 0;
  const copied: string[] = [];

  const watchChanges = () => {
    try {
      new MutationObserver(() => {
        lastChange = now();
      }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch {
      // No document yet: the next command finds the page as it is.
    }
  };
  if (document.documentElement) watchChanges();
  else document.addEventListener('readystatechange', watchChanges, { once: true });

  try {
    const fetch = window.fetch;
    window.fetch = function (this: unknown, ...args: Parameters<typeof window.fetch>) {
      pending += 1;
      return fetch.apply(this, args).finally(() => {
        pending -= 1;
      });
    } as typeof window.fetch;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['send']>) {
      pending += 1;
      this.addEventListener('loadend', () => (pending -= 1), { once: true });
      return send.apply(this, args);
    };
  } catch {
    // A page that froze these still works; the app waits for quiet instead.
  }

  // What the page copies, such as Play Console's "Copy Cloud Storage URI".
  // A copied private key is never kept.
  const remember = (text: unknown) => {
    if (typeof text !== 'string' || /PRIVATE KEY/.test(text) || hasSecret(text)) return;
    const value = text.trim().slice(0, 500);
    if (!value) return;
    copied.push(value);
    if (copied.length > 5) copied.shift();
  };
  try {
    const clipboard = navigator.clipboard;
    if (clipboard?.writeText) {
      const writeText = clipboard.writeText.bind(clipboard);
      clipboard.writeText = (text: string) => {
        remember(text);
        return writeText(text);
      };
    }
    const setData = DataTransfer.prototype.setData;
    DataTransfer.prototype.setData = function (this: DataTransfer, format: string, data: string) {
      if (/text/i.test(format)) remember(data);
      return setData.call(this, format, data);
    };
    document.addEventListener(
      'copy',
      () => {
        remember(document.getSelection()?.toString());
      },
      true
    );
  } catch {
    // Copies are only a convenience.
  }

  // --- numbering the controls -------------------------------------------------------

  const numberOf = new WeakMap<Element, number>();
  const byNumber = new Map<number, WeakRef<Element>>();
  let nextNumber = 1;

  const refFor = (el: Element) => {
    let ref = numberOf.get(el);
    if (!ref) {
      ref = nextNumber++;
      numberOf.set(el, ref);
      byNumber.set(ref, new WeakRef(el));
    }
    return ref;
  };

  const elementFor = (ref: unknown): Element | null => {
    const number = typeof ref === 'string' ? Number(ref.replace(/\D/g, '')) : ref;
    if (typeof number !== 'number' || !Number.isInteger(number)) return null;
    const el = byNumber.get(number)?.deref();
    // An element of a frame that has since loaded another page still counts
    // as connected, in a document no window shows any more.
    return el && el.isConnected && el.ownerDocument.defaultView ? el : null;
  };

  // --- reading the page ---------------------------------------------------------------

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'svg', 'CANVAS', 'VIDEO', 'AUDIO', 'HEAD', 'META', 'LINK']);
  const BLOCK = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'DD', 'DETAILS', 'DIALOG', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION',
    'FIGURE', 'FOOTER', 'FORM', 'HEADER', 'HR', 'LEGEND', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY',
    'TFOOT', 'THEAD', 'TR', 'UL', 'BR',
  ]);
  const LEAF_ROLES = new Set([
    'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
    'textbox', 'searchbox', 'combobox', 'slider', 'spinbutton', 'treeitem',
  ]);
  const TEXT_INPUTS = new Set(['', 'text', 'email', 'search', 'tel', 'url', 'number', 'password', 'date', 'time']);
  const CELL_ROLES = new Set(['cell', 'gridcell', 'columnheader', 'rowheader']);

  // Keys are hidden before anything is cut short: a key cut first could
  // leave a piece too short to be recognised.
  const squash = (text: string | null | undefined, max = 200) => {
    const flat = redactSecrets(text ?? '').replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  };

  const shown = (el: Element): boolean => {
    if (el.getAttribute('aria-hidden') === 'true' || (el as HTMLElement).hidden || el.hasAttribute('inert')) return false;
    const check = (el as Element & { checkVisibility?: (options?: object) => boolean }).checkVisibility;
    if (typeof check === 'function') {
      try {
        return check.call(el, { checkVisibilityCSS: true });
      } catch {
        // Fall through to the box test.
      }
    }
    return el.getClientRects().length > 0;
  };

  const roleOf = (el: Element): string | null => {
    const explicit = el.getAttribute('role')?.split(/\s+/)[0];
    if (explicit && (LEAF_ROLES.has(explicit) || explicit === 'heading')) return explicit;
    switch (el.tagName) {
      case 'A':
        return el.hasAttribute('href') ? 'link' : null;
      case 'BUTTON':
      case 'SUMMARY':
        return 'button';
      case 'SELECT':
        return 'combobox';
      case 'TEXTAREA':
        return 'textbox';
      case 'INPUT': {
        const type = (el as HTMLInputElement).type.toLowerCase();
        if (type === 'hidden' || type === 'file') return null;
        if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
        if (type === 'checkbox') return el.getAttribute('role') === 'switch' ? 'switch' : 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'range') return 'slider';
        return 'textbox';
      }
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6':
        return 'heading';
    }
    if ((el as HTMLElement).isContentEditable && el.getAttribute('contenteditable') !== null) return 'textbox';
    if (el.getAttribute('tabindex') === '0' && !explicit && el.childElementCount < 4 && squash(el.textContent, 60)) return 'button';
    if (el.hasAttribute('onclick')) return 'button';
    return null;
  };

  const textOfIds = (el: Element, attr: string) => {
    const ids = el.getAttribute(attr);
    if (!ids) return '';
    const root = el.getRootNode() as Document | ShadowRoot;
    return ids
      .split(/\s+/)
      .map((id) => squash((root.getElementById ? root.getElementById(id) : document.getElementById(id))?.textContent, 100))
      .filter(Boolean)
      .join(' ');
  };

  /** A label's own words, without the text of the box or list inside it. */
  const labelText = (label: Element, control: Element) => {
    let text = '';
    const walk = (node: Node) => {
      if (node === control) return;
      if (node.nodeType === Node.TEXT_NODE) {
        text += ` ${node.textContent ?? ''}`;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (['SELECT', 'INPUT', 'TEXTAREA', 'BUTTON', 'OPTION', 'SCRIPT', 'STYLE'].includes((node as Element).tagName)) return;
      node.childNodes.forEach(walk);
    };
    walk(label);
    return squash(text, 100);
  };

  const nameOf = (el: Element): string => {
    const labelled = textOfIds(el, 'aria-labelledby');
    if (labelled) return squash(labelled, 100);
    const aria = el.getAttribute('aria-label');
    if (aria?.trim()) return squash(aria, 100);
    if (is(el, 'input') || is(el, 'textarea') || is(el, 'select')) {
      const label = Array.from(el.labels ?? [])
        .map((entry) => labelText(entry, el))
        .filter(Boolean)
        .join(' ');
      if (label) return label;
      if (is(el, 'input') && ['button', 'submit', 'reset'].includes(el.type) && el.value) return squash(el.value, 100);
      const hint = el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name');
      if (hint) return squash(hint, 100);
    }
    if (is(el, 'img')) return squash(el.alt, 100);
    const text = squash((el as HTMLElement).innerText ?? el.textContent, 100);
    if (text) return text;
    const title = el.getAttribute('title') || el.querySelector('title')?.textContent || el.querySelector('[aria-label]')?.getAttribute('aria-label');
    if (title) return squash(title, 100);
    const img = el.querySelector('img[alt]') as HTMLImageElement | null;
    return img ? squash(img.alt, 100) : '';
  };

  const disabled = (el: Element) =>
    (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true' || !!el.closest('fieldset[disabled]');

  // A box whose value the AI never reads and the driver never types into.
  // "sign-in" boxes (a password, a verification code) also make the page a
  // sign-in page, where the assistant does nothing at all; "private" boxes
  // (a card number, a bare "code") are only hidden.
  const SIGN_IN_WORDS =
    /verif|one.?time|\botp\b|totp|2fa|\bmfa\b|two.?(?:factor|step)|security.?code|auth(?:entication)?.?code|sms.?code|backup.?code|recovery.?code|passcode|pass.?phrase|\bpin\b/i;
  const PRIVATE_WORDS = /\bcode\b|\bcvc\b|\bcvv\b|\bcsc\b|card.?number|\biban\b|routing|account.?number|\bssn\b|tax.?id/i;

  const secretOf = (el: Element): 'sign-in' | 'private' | null => {
    const input = is(el, 'input');
    const editable = htmlElement(el)?.isContentEditable === true && el.getAttribute('contenteditable') !== null;
    if (!input && !editable && !is(el, 'textarea') && el.getAttribute('role') !== 'textbox') return null;
    const type = input ? el.type.toLowerCase() : '';
    if (type === 'password') return 'sign-in';
    const tokens = (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/);
    if (tokens.some((token) => token === 'current-password' || token === 'new-password' || token === 'one-time-code')) return 'sign-in';
    const field = `${el.getAttribute('name') ?? ''} ${el.id}`;
    const words = `${nameOf(el)} ${field} ${el.getAttribute('placeholder') ?? ''}`;
    // Field names run words together: totpPin, idvPin, smsCode.
    if (SIGN_IN_WORDS.test(words) || /pin\b|pin$/i.test(field.trim())) return 'sign-in';
    if (tokens.some((token) => token.startsWith('cc-')) || PRIVATE_WORDS.test(words) || /code\b|code$/i.test(field.trim())) return 'private';
    // A short box for digits only is a code, whatever it is called.
    const digits = el.getAttribute('inputmode') === 'numeric' || type === 'tel' || type === 'number';
    const longest = Number(el.getAttribute('maxlength'));
    if (digits && longest >= 4 && longest <= 8) return 'private';
    return null;
  };

  const valueOf = (el: Element): string | null => {
    if (is(el, 'input') || is(el, 'textarea')) return el.value;
    const value = (el as { value?: unknown }).value;
    return typeof value === 'string' ? value : null;
  };

  const describe = (el: Element, role: string) => {
    const parts = [`[${refFor(el)}] ${role} "${nameOf(el).replace(/"/g, "'")}"`];
    if (is(el, 'select')) {
      const options = Array.from(el.options);
      parts.push(`value="${squash(el.selectedOptions[0]?.text, 60)}"`);
      if (options.length <= 25) parts.push(`options: ${options.map((option) => squash(option.text, 40)).join(', ')}`);
    } else if (is(el, 'input') && (el.type === 'checkbox' || el.type === 'radio')) {
      parts.push(el.checked ? '(checked)' : '(not checked)');
    } else if (is(el, 'input') || is(el, 'textarea') || role === 'combobox' || role === 'textbox' || role === 'searchbox') {
      const value = valueOf(el);
      if (value !== null) parts.push(secretOf(el) ? 'value=(hidden)' : `value="${squash(value, 80)}"`);
    }
    const aria = (name: string) => el.getAttribute(name);
    if (aria('aria-checked') === 'true') parts.push('(checked)');
    else if (aria('aria-checked') === 'false') parts.push('(not checked)');
    if (aria('aria-selected') === 'true' || (el as HTMLOptionElement).selected === true) parts.push('(selected)');
    if (aria('aria-expanded') === 'true') parts.push('(open)');
    if (aria('aria-pressed') === 'true') parts.push('(on)');
    if (aria('aria-current') && aria('aria-current') !== 'false') parts.push('(current)');
    if (aria('aria-invalid') === 'true') parts.push('(invalid)');
    if (disabled(el)) parts.push('(disabled)');
    if (role === 'link') {
      const href = (el as HTMLAnchorElement).href;
      if (href && !href.startsWith('javascript:')) {
        try {
          const target = new URL(href);
          const where = target.origin === location.origin ? target.pathname + target.search : target.host + target.pathname;
          parts.push(`→ ${squash(where, 90)}`);
        } catch {
          // A link with no address says nothing more.
        }
      }
    }
    return parts.join(' ');
  };

  const SIGN_IN_HOSTS = ['idmsa.apple.com', 'appleid.apple.com', 'accounts.google.com'];

  interface Reading {
    lines: string[];
    signIn: boolean;
    visited: number;
    cut: boolean;
  }

  // A key's first and last lines, as they read with every space taken out.
  const KEY_BEGINS = /-----BEGIN[A-Z0-9]*PRIVATEKEY-----/;
  const KEY_ENDS = /-----END[A-Z0-9]*PRIVATEKEY-----/;

  const read = (root: Element | Document, started: number): Reading => {
    const lines: string[] = [];
    // Each outline line twice: `line` puts a space between pieces so labels
    // and values stay apart, `glued` joins the page's text as it renders.
    // A page can split a key into short elements, which `line` spaces apart
    // and `glued` puts back together, so keys are looked for in `glued`.
    let line = '';
    let glued = '';
    let inKey = false;
    let signIn = false;
    let visited = 0;
    let cut = false;
    const keep = (text: string) => {
      if (lines[lines.length - 1] !== text || text !== HIDDEN_KEY) lines.push(text);
    };
    const flush = () => {
      const text = line.trim();
      const whole = glued.replace(/\s+/g, ' ').trim();
      line = '';
      glued = '';
      if (!text || text === '|' || text === '-') return;
      // With the spaces out, a key's BEGIN and END lines show however the
      // page broke them up, and so do the lines of key text between them.
      const compact = whole.replace(/[\s…]+/g, '');
      const begins = compact.search(KEY_BEGINS);
      if (begins >= 0 || (inKey && (KEY_ENDS.test(compact) || /^[A-Za-z0-9+/=]+$/.test(compact)))) {
        inKey = !KEY_ENDS.test(begins >= 0 ? compact.slice(begins) : compact);
        keep(HIDDEN_KEY);
        return;
      }
      inKey = false;
      // A key the line only shows glued together: the glued line, hidden.
      keep(hasSecret(whole) ? squash(whole, 400) : text);
    };
    const add = (text: string) => {
      if (!text) return;
      line = line && !line.endsWith(' ') ? `${line} ${text}` : `${line}${text}`;
      glued = `${glued} ${text} `;
      if (line.length > 400) flush();
    };
    /** A text node: spaced in `line`, run on in `glued` exactly as the page has it. */
    const addText = (raw: string) => {
      const text = squash(raw, 300);
      if (!text) {
        glued += raw;
        return;
      }
      line = line && !line.endsWith(' ') ? `${line} ${text}` : `${line}${text}`;
      glued += raw;
      if (line.length > 400) flush();
    };

    const walk = (node: Node) => {
      if (cut) return;
      visited += 1;
      if (visited > 25_000 || now() - started > 1500) {
        cut = true;
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        addText(node.textContent ?? '');
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      if (SKIP.has(el.tagName) || !shown(el)) return;

      if (el.tagName === 'IFRAME') {
        flush();
        const frame = el as HTMLIFrameElement;
        let inner: Document | null = null;
        try {
          inner = frame.contentDocument;
        } catch {
          inner = null;
        }
        if (inner?.body) {
          const nested = read(inner.body, started);
          lines.push(...nested.lines);
          signIn ||= nested.signIn;
          return;
        }
        let host = '';
        try {
          host = new URL(frame.src, location.href).host;
        } catch {
          host = '';
        }
        if (SIGN_IN_HOSTS.includes(host)) {
          signIn = true;
          lines.push(`[sign-in form from ${host}: the user signs in here]`);
        } else if (host) {
          lines.push(`[frame from ${host}]`);
        }
        return;
      }

      const role = roleOf(el);
      if (role === 'heading') {
        flush();
        const level = Math.min(Number(el.getAttribute('aria-level') ?? el.tagName.slice(1)) || 2, 3);
        const text = squash((el as HTMLElement).innerText ?? el.textContent, 150);
        if (text) lines.push(`${'#'.repeat(level)} ${text}`);
        return;
      }
      if (role && LEAF_ROLES.has(role)) {
        if (secretOf(el) === 'sign-in') signIn = true;
        add(describe(el, role));
        return;
      }

      const block = BLOCK.has(el.tagName) || el.tagName.includes('-') || el.getAttribute('role') === 'row';
      if (block) flush();
      if (el.tagName === 'LI' || el.getAttribute('role') === 'listitem') add('-');
      if (el.tagName === 'TD' || el.tagName === 'TH' || CELL_ROLES.has(el.getAttribute('role') ?? '')) {
        if (line.trim()) add('|');
      }
      for (const child of Array.from(el.childNodes)) walk(child);
      const shadow = (el as HTMLElement).shadowRoot;
      if (shadow) for (const child of Array.from(shadow.childNodes)) walk(child);
      if (block) flush();
    };

    walk(root);
    flush();
    return { lines, signIn, visited, cut };
  };

  /** The dialog on top, when one is open: the page behind it cannot be used meanwhile. */
  const openDialog = (): Element | null => {
    const candidates = Array.from(
      document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')
    ).filter((el) => shown(el) && el.getBoundingClientRect().width > 40 && el.getBoundingClientRect().height > 40);
    const modal = candidates.filter(
      (el) => el.getAttribute('aria-modal') === 'true' || el.getAttribute('role') === 'alertdialog' || (el as HTMLDialogElement).matches?.(':modal')
    );
    const pool = modal.length ? modal : candidates;
    return pool.length ? pool[pool.length - 1] : null;
  };

  const snapshot = (max: number) => {
    const started = now();
    // Drop numbers of elements that left the page.
    for (const [ref, weak] of byNumber) {
      const el = weak.deref();
      if (!el || !el.isConnected) byNumber.delete(ref);
    }
    const dialog = openDialog();
    const reading = read(dialog ?? document.body ?? document.documentElement, started);
    const host = location.host;
    const signIn = reading.signIn || SIGN_IN_HOSTS.includes(host);
    const head = [`Title: ${squash(document.title, 150)}`, `Address: ${squash(location.href, 300)}`];
    if (dialog) head.push(`A dialog is open: "${nameOf(dialog) || 'untitled'}". Only the dialog is shown; the page behind it cannot be used until it closes.`);
    if (signIn) head.push('This is a sign-in page. The user signs in themselves.');

    // Over the budget: keep the controls and headings, shorten the rest.
    let lines = reading.lines;
    const size = (list: string[]) => list.reduce((sum, entry) => sum + entry.length + 1, 0);
    if (size(lines) > max) lines = lines.map((entry) => (/^\[|^#/.test(entry) || entry.length <= 120 ? entry : `${entry.slice(0, 119)}…`));
    if (size(lines) > max) lines = lines.filter((entry) => /\[\d+\]|^#/.test(entry) || entry.length <= 60);
    let cut = reading.cut;
    if (size(lines) > max) {
      const kept: string[] = [];
      let total = 0;
      for (const entry of lines) {
        if (total + entry.length + 1 > max) break;
        kept.push(entry);
        total += entry.length + 1;
      }
      lines = kept;
      cut = true;
    }
    if (cut) lines.push('(The page goes on. Scroll to see more.)');
    // A private key shown on the page goes no further than the page.
    const text = redactSecrets([...head, '', ...lines].join('\n'));
    return { url: location.href, title: document.title, text, signIn, dialog: !!dialog, cut };
  };

  /**
   * Whether a sign-in form shows right now: a sign-in site, a password or
   * code box in the page, its shadow roots or its frames, or a frame from a
   * sign-in site. Checked again at every click, type and pick, because a
   * click earlier in the same answer can bring the form up.
   */
  const signInShown = (): boolean => {
    if (SIGN_IN_HOSTS.includes(location.host)) return true;
    let found = false;
    let visited = 0;
    const look = (root: Node, depth: number) => {
      const owner = root.ownerDocument ?? (root as Document);
      const walker = owner.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      for (let node: Node | null = walker.currentNode; node && !found && visited < 50_000; node = walker.nextNode()) {
        visited += 1;
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node as Element;
        // The same test the outline uses: a code box can be a textarea too.
        if (secretOf(el) === 'sign-in' && shown(el)) {
          found = true;
          return;
        }
        if (depth < 4 && el.shadowRoot) look(el.shadowRoot, depth + 1);
        if (depth < 4 && is(el, 'iframe')) {
          let inner: Document | null = null;
          try {
            inner = el.contentDocument;
          } catch {
            inner = null;
          }
          if (inner?.documentElement) {
            look(inner.documentElement, depth + 1);
          } else {
            try {
              if (SIGN_IN_HOSTS.includes(new URL(el.src, location.href).host) && shown(el)) found = true;
            } catch {
              // A frame with no address is no sign-in.
            }
          }
        }
      }
    };
    look(document.documentElement, 0);
    return found;
  };

  const DIALOGS = 'dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]';

  /** The dialog `el` sits in, through shadow roots and frames. */
  const dialogOf = (el: Element): Element | null => {
    let node: Element | null = el;
    for (let hops = 0; node && hops < 8; hops += 1) {
      const found: Element | null = node.closest(DIALOGS);
      if (found) return found;
      const root = node.getRootNode() as ShadowRoot | Document;
      if ('host' in root && root.host) {
        node = root.host;
        continue;
      }
      try {
        node = node.ownerDocument.defaultView?.frameElement ?? null;
      } catch {
        node = null;
      }
    }
    return null;
  };

  /** A dialog's title: what labels it, or its first heading. Never its body. */
  const titleOf = (dialog: Element): string => {
    const labelled = textOfIds(dialog, 'aria-labelledby');
    if (labelled) return squash(labelled, 100);
    const aria = dialog.getAttribute('aria-label');
    if (aria?.trim()) return squash(aria, 100);
    const heading = dialog.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
    return heading ? squash((heading as HTMLElement).innerText ?? heading.textContent, 100) : '';
  };

  /**
   * Where `el` is: the page's address and, for a frame, the frame's too. A
   * single-page console changes its address without loading a new page, so
   * the address counts as well as the page itself.
   */
  const addressOf = (el: Element) => {
    const frame = el.ownerDocument === document ? '' : ` ${el.ownerDocument.URL}`;
    return `${location.href}${frame}`;
  };

  /**
   * The control as describe sees it, compared with what the app judged: the
   * page, the control's name, role and address, and the title of the dialog
   * it sits in, which the policy reads too.
   */
  const changedFrom = (el: Element, expected: Expected | undefined): string | null => {
    if (!expected) return null;
    if (expected.doc !== undefined && expected.doc !== DOCUMENT) return 'The page changed';
    if (expected.url !== undefined && expected.url !== addressOf(el)) return 'The page changed';
    const name = nameOf(el);
    if (name !== expected.name) return `That control changed from "${expected.name}" to "${name}"`;
    const role = roleOf(el) ?? el.localName;
    const href = is(el, 'a') ? el.href : null;
    if (role !== expected.role || (expected.href !== undefined && href !== (expected.href ?? null))) return 'That control changed';
    if (expected.dialog !== undefined) {
      const box = dialogOf(el);
      const title = box ? titleOf(box) : null;
      if (title !== (expected.dialog ?? null)) {
        return `The title above it changed from "${expected.dialog ?? ''}" to "${title ?? ''}"`;
      }
    }
    return null;
  };

  const SIGN_IN_REFUSAL = 'Nothing is typed or pressed on a sign-in page';

  /** Whether `el` is still the control the app judged, with no sign-in form up. */
  const still = (el: Element, expected: Expected | undefined) => (): string | null => {
    if (!el.isConnected) return 'That control left the page';
    if (signInShown()) return SIGN_IN_REFUSAL;
    if (disabled(el)) return 'That control turned off';
    return changedFrom(el, expected);
  };

  // --- acting on the page ---------------------------------------------------------------

  let overlay: { host: HTMLElement; root: ShadowRoot } | null = null;
  let pointed: { el: Element; note: string; until: number } | null = null;

  const layer = () => {
    if (overlay && overlay.host.isConnected) return overlay;
    const host = document.createElement('osg-growth-overlay');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .ring{position:fixed;border:2px solid #7c5cff;border-radius:10px;box-shadow:0 0 0 4px rgba(124,92,255,.25);transition:all .2s ease;animation:pulse 1.6s ease-in-out infinite}
      .note{position:fixed;max-width:280px;background:#7c5cff;color:#fff;font:600 13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:7px 10px;border-radius:9px;box-shadow:0 6px 20px rgba(0,0,0,.25)}
      .tap{position:fixed;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(124,92,255,.55);animation:tap .6s ease-out forwards}
      @keyframes pulse{50%{box-shadow:0 0 0 9px rgba(124,92,255,.12)}}
      @keyframes tap{from{transform:scale(.4);opacity:1}to{transform:scale(3.2);opacity:0}}`;
    root.append(style);
    (document.body ?? document.documentElement).append(host);
    overlay = { host, root };
    return overlay;
  };

  const drawPointer = () => {
    if (!overlay) return;
    overlay.root.querySelectorAll('.ring, .note').forEach((node) => node.remove());
    if (!pointed || !pointed.el.isConnected || now() > pointed.until) {
      pointed = null;
      return;
    }
    const box = pointed.el.getBoundingClientRect();
    const ring = document.createElement('div');
    ring.className = 'ring';
    ring.style.cssText = `left:${box.left - 6}px;top:${box.top - 6}px;width:${box.width + 12}px;height:${box.height + 12}px`;
    overlay.root.append(ring);
    if (pointed.note) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = pointed.note;
      const below = box.bottom + 14 + 60 < innerHeight;
      note.style.cssText = `left:${Math.max(8, Math.min(box.left, innerWidth - 300))}px;top:${below ? box.bottom + 12 : Math.max(8, box.top - 52)}px`;
      overlay.root.append(note);
    }
    requestAnimationFrame(drawPointer);
  };

  const tapAt = (x: number, y: number) => {
    const { root } = layer();
    const dot = document.createElement('div');
    dot.className = 'tap';
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    root.append(dot);
    setTimeout(() => dot.remove(), 700);
  };

  const centre = (el: Element) => {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const box = el.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };

  /**
   * Press `el` the way a mouse does. The page's handlers run at every step
   * (a mousedown can rename the button, a focus can bring up a sign-in form),
   * so `still` looks again after each one, and the click itself only happens
   * if nothing changed. Returns why it stopped, or null once pressed.
   */
  const click = (el: Element, still: () => string | null): string | null => {
    const { x, y } = centre(el);
    const view = el.ownerDocument.defaultView ?? window;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view };
    const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    const html = htmlElement(el);
    const steps = [
      () => el.dispatchEvent(new Pointer('pointerover', pointer)),
      () => el.dispatchEvent(new Mouse('mouseover', base)),
      () => el.dispatchEvent(new Pointer('pointerdown', { ...pointer, buttons: 1 })),
      () => el.dispatchEvent(new Mouse('mousedown', { ...base, buttons: 1 })),
      () => html?.focus({ preventScroll: true }),
      () => el.dispatchEvent(new Pointer('pointerup', pointer)),
      () => el.dispatchEvent(new Mouse('mouseup', base)),
    ];
    for (const step of steps) {
      step();
      const problem = still();
      if (problem) return problem;
    }
    if (html) html.click();
    else el.dispatchEvent(new Mouse('click', base));
    tapAt(x, y);
    return null;
  };

  /** Set a box's value with the setter taken before the page's scripts ran, in any frame. */
  const setValue = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
    const set = is(el, 'textarea') ? textareaValue : is(el, 'select') ? selectValue : inputValue;
    try {
      if (set) {
        set.call(el, value);
        return;
      }
    } catch {
      // A frame's element that refuses this window's setter takes its own.
    }
    el.value = value;
  };

  const PRIVATE_BOX = 'This box is for a password, a code or other private details, so nothing is typed in it';

  /**
   * Type `text` into `el`. Focusing the box runs the page's handlers, which
   * can turn it into a password box, so `still` looks again, and the box is
   * checked again, before a letter goes in.
   */
  const typeInto = (el: Element, text: string, still: () => string | null) => {
    const refusal = (): string | null => {
      if (is(el, 'input') && !TEXT_INPUTS.has(el.type)) return 'This is not a text box';
      if ((is(el, 'input') || is(el, 'textarea')) && (el.readOnly || disabled(el))) return 'This box cannot be typed in now';
      return secretOf(el) ? PRIVATE_BOX : null;
    };
    const focused = () => {
      const problem = still() ?? refusal();
      if (!problem) return null;
      const plain = problem === PRIVATE_BOX || problem === SIGN_IN_REFUSAL;
      return { ok: false, error: plain ? problem : `${problem}, so nothing was typed. Read the page again` };
    };
    if (is(el, 'input') || is(el, 'textarea')) {
      const before = refusal();
      if (before) return { ok: false, error: before };
      centre(el);
      el.focus({ preventScroll: true });
      const after = focused();
      if (after) return after;
      setValue(el, text);
      el.dispatchEvent(new TypedEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new PlainEvent('change', { bubbles: true }));
      return { ok: true };
    }
    const html = htmlElement(el);
    if (html?.isContentEditable) {
      if (secretOf(el)) return { ok: false, error: PRIVATE_BOX };
      html.focus();
      const after = focused();
      if (after) return after;
      el.ownerDocument.execCommand('selectAll');
      el.ownerDocument.execCommand('insertText', false, text);
      return { ok: true };
    }
    return { ok: false, error: 'This is not a text box' };
  };

  /**
   * Choose an option in a plain list. A preview only says which option
   * `option` names, and the value it sets, so the app can judge that option
   * before it is chosen; `exact` then takes that option and no other, and
   * only while it still sets `value`.
   */
  const pick = (el: Element, option: string, mode: { preview?: boolean; exact?: boolean; value?: string }) => {
    if (!is(el, 'select')) {
      return { ok: false, error: 'This is not a plain list. Click it to open the list, then click the option' };
    }
    const wanted = option.trim().toLowerCase();
    const options = Array.from(el.options);
    const found = mode.exact
      ? options.find((entry) => entry.text.trim() === option.trim())
      : options.find((entry) => entry.text.trim().toLowerCase() === wanted) ??
        options.find((entry) => entry.value.toLowerCase() === wanted) ??
        options.find((entry) => entry.text.trim().toLowerCase().startsWith(wanted));
    if (!found) return { ok: false, error: `No option "${option}". The options are: ${options.map((entry) => entry.text.trim()).join(', ')}` };
    if (found.disabled) return { ok: false, error: `"${found.text.trim()}" is turned off in this list` };
    if (mode.preview) return { ok: true, picked: found.text.trim(), value: found.value };
    if (mode.value !== undefined && found.value !== mode.value) {
      return { ok: false, error: `The option "${found.text.trim()}" changed, so nothing was chosen. Read the page again` };
    }
    if (disabled(el)) return { ok: false, error: 'This list is turned off right now' };
    setValue(el, found.value);
    el.dispatchEvent(new PlainEvent('input', { bubbles: true }));
    el.dispatchEvent(new PlainEvent('change', { bubbles: true }));
    return { ok: true, picked: found.text.trim() };
  };

  const scrollPage = (to: string) => {
    // Consoles often scroll a panel of their own rather than the page.
    const candidates = [document.scrollingElement, ...Array.from(document.querySelectorAll('main, [role="main"], div'))].filter(
      (el): el is Element => !!el && el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 200
    );
    const target =
      candidates
        .filter((el) => el === document.scrollingElement || /auto|scroll/.test(getComputedStyle(el).overflowY))
        .sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0] ?? document.scrollingElement;
    if (!target) return { ok: false, error: 'Nothing to scroll' };
    const step = target.clientHeight * 0.8;
    const top = to === 'top' ? 0 : to === 'bottom' ? target.scrollHeight : target.scrollTop + (to === 'up' ? -step : step);
    target.scrollTo({ top });
    return { ok: true };
  };

  const answer = (value: unknown) => stringify(value);

  const run = (command: DriverCommand): string => {
    try {
      switch (command.cmd) {
        case 'ping':
          return answer({
            url: location.href,
            title: document.title,
            ready: document.readyState,
            quietMs: Math.round(now() - lastChange),
            pending,
          });
        case 'snapshot':
          return answer(snapshot(Math.max(2000, Math.min(command.max ?? 14_000, 40_000))));
        case 'describe': {
          const el = elementFor(command.ref);
          if (!el) return answer({ ok: false, error: 'That control is no longer on the page' });
          const dialog = dialogOf(el);
          return answer({
            ok: true,
            role: roleOf(el) ?? el.localName,
            name: nameOf(el),
            disabled: disabled(el),
            shown: shown(el),
            href: is(el, 'a') ? el.href : null,
            inDialog: !!dialog,
            dialog: dialog ? titleOf(dialog) : null,
            doc: DOCUMENT,
            url: addressOf(el),
          });
        }
        // Each action looks again in the moment it acts: at a sign-in form
        // and at the control, which must still be the one the app judged.
        case 'click': {
          const el = elementFor(command.ref);
          if (!el) return answer({ ok: false, error: 'That control is no longer on the page. Read the page again' });
          if (signInShown()) return answer({ ok: false, error: SIGN_IN_REFUSAL });
          const changed = changedFrom(el, command.expect);
          if (changed) return answer({ ok: false, error: `${changed}, so nothing was pressed. Read the page again` });
          if (disabled(el)) return answer({ ok: false, error: 'That control is turned off right now' });
          const stopped = click(el, still(el, command.expect));
          if (stopped) return answer({ ok: false, error: stopped === SIGN_IN_REFUSAL ? stopped : `${stopped}, so the click was stopped. Read the page again` });
          return answer({ ok: true, name: nameOf(el) });
        }
        case 'type': {
          const el = elementFor(command.ref);
          if (!el) return answer({ ok: false, error: 'That box is no longer on the page. Read the page again' });
          if (signInShown()) return answer({ ok: false, error: SIGN_IN_REFUSAL });
          const changed = changedFrom(el, command.expect);
          if (changed) return answer({ ok: false, error: `${changed}, so nothing was typed. Read the page again` });
          return answer(typeInto(el, String(command.text ?? '').slice(0, 300), still(el, command.expect)));
        }
        case 'pick': {
          const el = elementFor(command.ref);
          if (!el) return answer({ ok: false, error: 'That list is no longer on the page. Read the page again' });
          if (!command.preview && signInShown()) return answer({ ok: false, error: SIGN_IN_REFUSAL });
          const changed = changedFrom(el, command.expect);
          if (changed) return answer({ ok: false, error: `${changed}, so nothing was chosen. Read the page again` });
          return answer(
            pick(el, String(command.option ?? ''), {
              preview: command.preview === true,
              exact: command.exact === true,
              value: typeof command.value === 'string' ? command.value : undefined,
            })
          );
        }
        case 'scroll':
          return answer(scrollPage(command.to ?? 'down'));
        case 'point': {
          const el = elementFor(command.ref);
          if (!el) return answer({ ok: false, error: 'That control is no longer on the page' });
          centre(el);
          layer();
          pointed = { el, note: squash(String(command.note ?? ''), 140), until: now() + 120_000 };
          drawPointer();
          return answer({ ok: true });
        }
        case 'clear':
          pointed = null;
          drawPointer();
          return answer({ ok: true });
        case 'copied':
          return answer({ texts: copied.slice() });
        default:
          return answer({ ok: false, error: 'Unknown command' });
      }
    } catch (error) {
      return answer({ ok: false, error: error instanceof Error ? error.message : 'The page did not answer' });
    }
  };

  define(window, '__osgGrowthDriver', {
    value: Object.freeze({ run }),
    configurable: false,
    enumerable: false,
    writable: false,
  });
})();
