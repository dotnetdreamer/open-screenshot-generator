import { registerAdapter } from './driver';

registerAdapter({
  id: 'claude',
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
});
