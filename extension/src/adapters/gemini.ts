import { registerAdapter } from './driver';

registerAdapter({
  id: 'gemini',
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
});
