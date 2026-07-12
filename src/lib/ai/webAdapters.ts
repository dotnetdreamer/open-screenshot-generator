/**
 * The one place the assistant sites are described.
 *
 * Three consumers read this: the desktop embedded-webview agent
 * (src/lib/ai/webAssistantAgent.ts, bundled into the Tauri app), the companion
 * browser extension (extension/src/adapters/*), and the app UI (labels, the
 * provider picker). Keeping identity and selectors in a single module means a
 * site redesign is fixed in one file instead of three.
 *
 * "Selectors are the one part guaranteed to rot": every field is a list, tried
 * in order, so a redesign is usually one new entry rather than new logic. The
 * first three (Claude, ChatGPT, Gemini) are exercised regularly and are the
 * reliable ones; the rest are best-effort scaffolding and will need selector
 * tuning as those sites change.
 */

export type WebProviderId =
  | 'claude'
  | 'chatgpt'
  | 'gemini'
  | 'copilot'
  | 'deepseek'
  | 'qwen'
  | 'perplexity'
  | 'glm';

export interface WebAdapter {
  id: WebProviderId;
  label: string;
  /** Where a fresh chat lives. */
  url: string;
  /** Primary host, used to recognise the site from inside the page. */
  host: string;
  /** All hosts this adapter drives (extension match patterns, host checks). */
  hosts: string[];
  /** true once these selectors have been verified against the live site. */
  tested: boolean;
  /** Composer element: a textarea or a contenteditable. */
  composer: string[];
  /** Hidden <input type="file">. Empty means the site takes no attachments. */
  fileInput: string[];
  /** Optional: clicked before looking for the file input (attachment menus). */
  attachMenu?: string[];
  /** Send button. */
  send: string[];
  /** Visible only while the assistant is generating. */
  streaming: string[];
  /** Every assistant turn; the last one is the answer. */
  assistantMessage: string[];
  /** Shown when signed out. A visible one means "not logged in". */
  loggedOut?: string[];
  /**
   * Optional authoritative login probe, for sites that expose their auth state
   * as data (beats any DOM-render race). Runs in the page. Return 'out' or
   * 'in' only on a definite signal, null when the source is absent/unreadable.
   */
  probeAuth?: () => 'in' | 'out' | null;
  /**
   * Optional predicate, run in the page, reporting whether the assistant is
   * still producing its answer. Reasoning models (GLM) show a "thinking"/stop
   * control that is the only reliable in-progress signal and cannot be written
   * as a static CSS selector, so this supplements `streaming`. Without it the
   * reply-settle heuristic can return a stable "Thinking…" placeholder as if it
   * were the finished answer.
   */
  isGenerating?: () => boolean;
}

export const WEB_ADAPTERS: Record<WebProviderId, WebAdapter> = {
  claude: {
    id: 'claude',
    label: 'Claude',
    url: 'https://claude.ai/new',
    host: 'claude.ai',
    hosts: ['claude.ai'],
    tested: true,
    composer: [
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"][enterkeyhint]',
      'div[contenteditable="true"]',
    ],
    fileInput: ['input[data-testid="file-upload"]', 'input[type="file"]'],
    send: [
      'button[aria-label="Send message"]',
      'button[aria-label="Send Message"]',
      'button[data-testid="send-button"]',
      'button[type="submit"]',
    ],
    streaming: [
      'button[aria-label="Stop response"]',
      'button[aria-label="Stop Response"]',
      '[data-is-streaming="true"]',
    ],
    assistantMessage: [
      'div[data-is-streaming] .font-claude-message',
      '.font-claude-message',
      'div[data-testid="assistant-message"]',
    ],
    // claude.ai is a client-rendered shell; signed-out users are SPA-redirected
    // to /login, which renders the testid'd controls. The plain /login anchor
    // has a different job: claude.ai's logged-out decoy pages (the /new
    // composer that bounces to /logout) show a sign-in LINK next to a working
    // composer, and that link is the only thing that marks them as signed out.
    loggedOut: [
      'button[data-testid="login-with-google"]',
      'input[data-testid="code"]',
      'button[data-testid="login-button"]',
      'a[href*="/login"]',
    ],
  },
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT',
    url: 'https://chatgpt.com/',
    host: 'chatgpt.com',
    hosts: ['chatgpt.com', 'chat.openai.com'],
    tested: true,
    composer: [
      '#prompt-textarea',
      'div[contenteditable="true"]#prompt-textarea',
      'textarea[data-id]',
    ],
    fileInput: ['input[type="file"][multiple]', 'input[type="file"]'],
    send: [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label*="Send"]',
    ],
    streaming: ['button[data-testid="stop-button"]', 'button[aria-label="Stop streaming"]'],
    assistantMessage: [
      'div[data-message-author-role="assistant"] .markdown',
      'div[data-message-author-role="assistant"]',
    ],
    // ChatGPT serves a working composer to anonymous visitors, so "no composer"
    // cannot mark logged-out; these sign-in affordances (absent once signed in)
    // are what distinguishes the anonymous page from a real session.
    loggedOut: [
      'button[data-testid="login-button"]',
      'button[data-testid="signup-button"]',
      'button[data-testid="login-or-signup-button"]',
      'a[href*="/auth/login"]',
      'a[href*="auth.openai.com"]',
    ],
    // chatgpt.com server-renders its auth state as JSON in #client-bootstrap.
    // Reading it beats every DOM race: the anonymous page shows a working
    // composer, and betting on which of composer vs Log-in buttons renders
    // first is what used to type prompts into a throwaway anonymous chat.
    probeAuth: () => {
      try {
        const el = document.querySelector('script#client-bootstrap');
        const m = el?.textContent ? /"authStatus"\s*:\s*"([^"]+)"/.exec(el.textContent) : null;
        if (!m) return null;
        if (m[1] === 'logged_out') return 'out';
        if (m[1] === 'logged_in') return 'in';
        return null;
      } catch {
        return null;
      }
    },
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    url: 'https://gemini.google.com/app',
    host: 'gemini.google.com',
    hosts: ['gemini.google.com'],
    tested: true,
    composer: [
      'rich-textarea div.ql-editor[contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
    ],
    // Gemini keeps the input in the DOM but hangs the visible control off the
    // "+" menu; opening it first makes the input reachable on every build.
    attachMenu: ['button[aria-label*="Open upload"]', 'button[aria-label*="upload"]'],
    fileInput: ['input[type="file"][name="Filedata"]', 'input[type="file"]'],
    send: ['button.send-button', 'button[aria-label*="Send"]', 'button[aria-label*="send"]'],
    streaming: ['button[aria-label*="Stop"]', '.stop-icon', 'mat-icon[data-mat-icon-name="stop"]'],
    assistantMessage: [
      'model-response message-content .markdown',
      'message-content.model-response-text',
      'model-response',
    ],
    // The gbar "Sign in" anchor is server-rendered on the signed-out page and
    // absent (as a ServiceLogin URL) when signed in; the signed-in account
    // switcher lives in a cross-origin iframe, out of querySelector's reach.
    loggedOut: [
      'a[href*="accounts.google.com/ServiceLogin"]',
      'a[href*="gemini.google.com/signin"]',
    ],
  },
  // --- best-effort, gpt4free-style additions --------------------------------
  // These sites change often and are not vision-friendly; expect to tune the
  // selectors. Attachments are left empty where the free tier has no reliable
  // upload, so the agent sends text only there.
  copilot: {
    id: 'copilot',
    label: 'Copilot',
    url: 'https://copilot.microsoft.com/',
    host: 'copilot.microsoft.com',
    hosts: ['copilot.microsoft.com'],
    tested: false,
    composer: [
      'textarea#userInput',
      'textarea[data-testid="composer-input"]',
      'textarea[placeholder]',
      'div[contenteditable="true"]',
    ],
    fileInput: ['input[type="file"]'],
    attachMenu: ['button[aria-label*="Add" i]', 'button[data-testid="attach-button"]'],
    send: [
      'button[data-testid="submit-button"]',
      'button[aria-label="Submit message"]',
      'button[aria-label*="Submit" i]',
      'button[type="submit"]',
    ],
    streaming: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
    assistantMessage: [
      '[data-content="ai-message"]',
      'div[data-testid="ai-message"]',
      'div[class*="assistantMessage"]',
    ],
    // Copilot's auth UI is client-rendered and flag-gated; these are the
    // guest-state testids observed in 2026 builds. Note the plain
    // "sidebar-settings-button" testid appears in BOTH states, so it must
    // never be used here.
    loggedOut: [
      '[data-testid="sidebar-guest-sign-in-button"]',
      '[data-testid^="sidebar-settings-guest"]',
      '[data-testid="sign-in-exp-landing-header-button"]',
    ],
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    host: 'chat.deepseek.com',
    hosts: ['chat.deepseek.com'],
    tested: false,
    composer: ['textarea#chat-input', 'textarea[placeholder]', 'div[contenteditable="true"]'],
    fileInput: ['input[type="file"]'],
    send: [
      'div[role="button"][aria-disabled]',
      'button[type="submit"]',
      'div[class*="send" i][role="button"]',
    ],
    streaming: ['div[class*="stop" i][role="button"]', 'button[aria-label*="Stop" i]'],
    assistantMessage: ['div[class*="ds-markdown"]', 'div[class*="markdown"]', 'div[class*="message"]'],
    // No anonymous chat here: signed-out users are router-redirected to
    // /sign_in, which renders the ds-sign-up-form design-system components.
    loggedOut: ['[class*="ds-sign-up-form"]', 'a[href*="/sign_in"]'],
  },
  qwen: {
    id: 'qwen',
    label: 'Qwen',
    url: 'https://chat.qwen.ai/',
    host: 'chat.qwen.ai',
    hosts: ['chat.qwen.ai', 'tongyi.aliyun.com'],
    tested: false,
    composer: [
      'textarea.message-input-textarea',
      'textarea#chat-input',
      'textarea[placeholder]',
      'div[contenteditable="true"]',
    ],
    fileInput: ['input[type="file"]'],
    send: ['button[type="submit"]', 'button[class*="send" i]', 'div[class*="send" i][role="button"]'],
    streaming: ['button[class*="stop" i]', 'div[class*="stop" i][role="button"]'],
    assistantMessage: [
      'div[class*="markdown-body"]',
      'div[class*="assistant" i]',
      'div[class*="response" i]',
    ],
    // The header auth buttons are server-rendered when signed out and absent
    // when signed in. (The old generic 'a[href*="login"]' matched nothing and
    // could false-positive on unrelated links; dropped.)
    loggedOut: ['#qwen-chat-header-right .auth-buttons', 'button.header-right-auth-button'],
  },
  perplexity: {
    id: 'perplexity',
    label: 'Perplexity',
    url: 'https://www.perplexity.ai/',
    host: 'www.perplexity.ai',
    hosts: ['www.perplexity.ai', 'perplexity.ai'],
    tested: false,
    composer: [
      'textarea[placeholder]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    fileInput: ['input[type="file"]'],
    send: [
      'button[aria-label="Submit"]',
      'button[data-testid="submit-button"]',
      'button[aria-label*="Submit" i]',
    ],
    streaming: ['button[aria-label*="Stop" i]', 'button[data-testid="stop-button"]'],
    assistantMessage: ['div[dir="auto"] .prose', 'div[class*="prose"]', 'div[id^="markdown-content"]'],
    // Perplexity's sign-in affordances carry no stable testid except the login
    // modal itself, which only exists while shown: presence means signed out,
    // absence proves nothing. Anonymous runs work here, so that is acceptable.
    loggedOut: ['div[data-testid="login-modal"]'],
  },
  // GLM (Zhipu, served at chat.z.ai). Mirrors gpt4free's GLM provider, which
  // moved to a subpackage in the v7.8.x releases (service unchanged). Their
  // provider hits the private JSON API with a guest JWT; we drive the chat UI.
  // VERIFIED LIVE (2026-07-12) on a fresh profile, anonymously: z.ai mints a
  // guest session, so a full run (type -> send -> reply) completes without ever
  // signing in. GLM prefixes its answer with a "Thought Process" reasoning
  // block; that is plain text, so the pre/code JSON extractor still gets a clean
  // plan. Signing in at z.ai only upgrades the available models.
  glm: {
    id: 'glm',
    label: 'GLM (Z.ai)',
    url: 'https://chat.z.ai/',
    host: 'chat.z.ai',
    hosts: ['chat.z.ai'],
    tested: true,
    composer: [
      'textarea#chat-input',
      'textarea[placeholder]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
    ],
    fileInput: ['input[type="file"]'],
    attachMenu: ['button[aria-label*="upload" i]', 'button[aria-label*="attach" i]', 'button[aria-label*="Add" i]'],
    send: [
      'button[type="submit"]',
      'button[class*="send" i]',
      'button[data-testid="send-message-button"]',
      'button[aria-label*="Send" i]',
    ],
    // The stop control was not captured mid-stream; the driver falls back to the
    // reply-settle heuristic, which is what completed the verified run.
    streaming: [
      'button[data-testid="stop-response-button"]',
      'button[aria-label*="Stop" i]',
      'button[class*="stop" i]',
    ],
    assistantMessage: [
      'div[class*="markdown"]',
      'div[class*="assistant" i]',
      'div[class*="response" i]',
      'div[class*="message" i]',
    ],
    // GLM is a reasoning model: while it produces, z.ai shows a "Thinking…"
    // toggle and a "Skip" button, both gone once done (the toggle then reads
    // "Thought Process"). Captured live 2026-07-12 as the only reliable
    // in-progress signal (there is no stable CSS stop-button). Without this the
    // reply-settle heuristic returned the stable "Thinking… / Skip" placeholder
    // as the answer, and the plan parser rejected it.
    isGenerating: () => {
      try {
        for (const el of Array.from(document.querySelectorAll('button, [role="button"]'))) {
          const t = (el.textContent || '').trim();
          if (t === 'Skip' || /^thinking/i.test(t)) return true;
        }
      } catch {
        /* querying failed; assume not generating */
      }
      return false;
    },
    // loggedOut is intentionally UNSET. z.ai keeps an ever-present header "Sign
    // in" button (a <button aria-label="Sign in"> with no testid/href) even
    // during a working guest session, and shows no login wall/modal in guest
    // mode. Since detectLoginState checks loggedOut BEFORE the composer, matching
    // that button would wrongly report every anonymous run as signed-out. Same
    // accepted tradeoff as Perplexity: a real wall would surface as a composer
    // timeout rather than a clean not-logged-in.
  },
};

export const WEB_PROVIDER_IDS = Object.keys(WEB_ADAPTERS) as WebProviderId[];

/**
 * The single Tauri event name the embedded agent emits on and the desktop
 * transport listens to. Every message carries a `type` and a `requestId`.
 */
export const WEB_EVENT_CHANNEL = 'abs-web-event';

export interface WebProviderInfo {
  id: WebProviderId;
  label: string;
  url: string;
  host: string;
  tested: boolean;
}

/** Identity slice for the UI, without the (large) selector lists. */
export const WEB_PROVIDERS: Record<WebProviderId, WebProviderInfo> = Object.fromEntries(
  WEB_PROVIDER_IDS.map((id) => {
    const a = WEB_ADAPTERS[id];
    return [id, { id: a.id, label: a.label, url: a.url, host: a.host, tested: a.tested }];
  })
) as Record<WebProviderId, WebProviderInfo>;

/** Chrome extension match patterns for every driven host. */
export function extensionMatchPatterns(): string[] {
  return WEB_PROVIDER_IDS.flatMap((id) => WEB_ADAPTERS[id].hosts.map((h) => `https://${h}/*`));
}

/** Find the adapter whose hosts include this hostname, or null off-site. */
export function adapterForHost(hostname: string): WebAdapter | null {
  for (const id of WEB_PROVIDER_IDS) {
    if (WEB_ADAPTERS[id].hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
      return WEB_ADAPTERS[id];
    }
  }
  return null;
}
