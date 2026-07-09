import { registerAdapter } from './driver';

registerAdapter({
  id: 'chatgpt',
  composer: ['#prompt-textarea', 'div[contenteditable="true"]#prompt-textarea', 'textarea[data-id]'],
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
});
