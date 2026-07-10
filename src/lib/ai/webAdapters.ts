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
  | 'perplexity';

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
  /** Shown when signed out. Presence means "not logged in". */
  loggedOut?: string[];
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
    loggedOut: ['a[href*="/login"][data-testid]', 'button[data-testid="login-button"]'],
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
    loggedOut: ['button[data-testid="login-button"]', 'a[href="/auth/login"]'],
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
    loggedOut: ['a[href*="accounts.google.com/ServiceLogin"]'],
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
    loggedOut: ['button[data-testid="sign-in"]', 'a[href*="login.live.com"]'],
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
    loggedOut: ['a[href*="/sign_in"]', 'button[class*="login" i]'],
  },
  qwen: {
    id: 'qwen',
    label: 'Qwen',
    url: 'https://chat.qwen.ai/',
    host: 'chat.qwen.ai',
    hosts: ['chat.qwen.ai', 'tongyi.aliyun.com'],
    tested: false,
    composer: ['textarea#chat-input', 'textarea[placeholder]', 'div[contenteditable="true"]'],
    fileInput: ['input[type="file"]'],
    send: ['button[type="submit"]', 'button[class*="send" i]', 'div[class*="send" i][role="button"]'],
    streaming: ['button[class*="stop" i]', 'div[class*="stop" i][role="button"]'],
    assistantMessage: [
      'div[class*="markdown-body"]',
      'div[class*="assistant" i]',
      'div[class*="response" i]',
    ],
    loggedOut: ['button[class*="login" i]', 'a[href*="login"]'],
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
    loggedOut: ['button:has(> div:only-child)[data-testid="sign-in"]', 'a[href*="/sign-in"]'],
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
