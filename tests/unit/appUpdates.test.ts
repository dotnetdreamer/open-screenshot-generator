// Desktop updates in the page (src/lib/updates): when the schedule asks the
// update server, what the user is told about the answer, and how an install
// that did not happen is explained. Rust is played by a fake IPC, and the
// schedule's timers run on node's mock clock.

import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { writePreference } from '@/lib/editorPreferences';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  RELEASES_PAGE,
  RETRY_INTERVAL_MS,
  downloadPageFor,
  downloadPercent,
  isCheckDue,
  manualCheckToast,
  nextCheckDelay,
  promptFor,
  showsUpdateSettings,
  statusLine,
} from '@/lib/updates/describe';
import { getUpdateSnapshot, restartIntoUpdate, startUpdates } from '@/lib/updates/store';
import type { UpdateInfo, UpdatePhase, UpdateSnapshot } from '@/lib/updates/types';

const update: UpdateInfo = {
  version: '1.0.8',
  currentVersion: '1.0.7',
  notes: 'Faster export',
  date: '2026-11-07T10:00:00.000Z',
  critical: false,
  downloadPage: null,
  size: 2000,
};

function snap(phase: UpdatePhase, overrides: Partial<UpdateSnapshot> = {}): UpdateSnapshot {
  return { mode: 'install', reason: null, currentVersion: '1.0.7', phase, checkedAt: null, ...overrides };
}

// ---- what the page says ---------------------------------------------------

test('a check is due when the server never answered, or answered too long ago', () => {
  assert.equal(isCheckDue(null, 1_000), true);
  assert.equal(isCheckDue(1_000, 1_000 + CHECK_INTERVAL_MS - 1), false);
  assert.equal(isCheckDue(1_000, 1_000 + CHECK_INTERVAL_MS), true);
});

test('the next check waits out the interval, comes sooner after a failure, and never spins', () => {
  const now = 10 * CHECK_INTERVAL_MS;
  const hour = 60 * 60 * 1000;
  assert.equal(nextCheckDelay(snap({ phase: 'failed', step: 'check', message: 'offline' }), now), RETRY_INTERVAL_MS);
  assert.equal(nextCheckDelay(snap({ phase: 'idle' }), now), CHECK_INTERVAL_MS);
  assert.equal(nextCheckDelay(snap({ phase: 'upToDate' }, { checkedAt: now - hour }), now), CHECK_INTERVAL_MS - hour);
  assert.equal(nextCheckDelay(snap({ phase: 'upToDate' }, { checkedAt: now - 3 * CHECK_INTERVAL_MS }), now), 60 * 1000);
});

test('download progress is a whole percentage, and nothing without a size', () => {
  assert.equal(downloadPercent(500, 2000), 25);
  assert.equal(downloadPercent(1999, 2000), 99);
  assert.equal(downloadPercent(2500, 2000), 100);
  assert.equal(downloadPercent(500, null), null);
  assert.equal(downloadPercent(500, 0), null);
});

test('the sidebar offers an update only when there is something to do with it', () => {
  assert.equal(promptFor(null), null);
  assert.equal(promptFor(snap({ phase: 'downloading', update, received: 1, total: 2 })), null);
  assert.equal(promptFor(snap({ phase: 'upToDate' })), null);
  assert.deepEqual(promptFor(snap({ phase: 'ready', update })), { kind: 'ready', update });
  assert.deepEqual(promptFor(snap({ phase: 'installing', update })), { kind: 'installing', update });
  assert.deepEqual(
    promptFor(snap({ phase: 'available', update }, { mode: 'notify', reason: 'portable' })),
    { kind: 'available', update }
  );
  assert.equal(promptFor(snap({ phase: 'ready', update }, { mode: 'off' })), null);
});

test('Settings shows updates for a build that updates, and for a store build to say who does', () => {
  assert.equal(showsUpdateSettings(null), false);
  assert.equal(showsUpdateSettings(snap({ phase: 'idle' })), true);
  assert.equal(showsUpdateSettings(snap({ phase: 'idle' }, { mode: 'notify', reason: 'portable' })), true);
  assert.equal(showsUpdateSettings(snap({ phase: 'idle' }, { mode: 'off', reason: 'unconfigured' })), false);
  assert.equal(showsUpdateSettings(snap({ phase: 'idle' }, { mode: 'off', reason: 'appStore' })), true);
  assert.equal(showsUpdateSettings(snap({ phase: 'idle' }, { mode: 'off', reason: 'microsoftStore' })), true);
});

test('the status line says where updates stand', () => {
  assert.equal(statusLine(snap({ phase: 'idle' })), 'Not checked yet');
  assert.equal(statusLine(snap({ phase: 'upToDate' })), 'You have the latest version');
  assert.equal(statusLine(snap({ phase: 'downloading', update, received: 500, total: 2000 })), 'Downloading version 1.0.8, 25%');
  assert.equal(statusLine(snap({ phase: 'downloading', update, received: 500, total: null })), 'Downloading version 1.0.8');
  assert.equal(statusLine(snap({ phase: 'ready', update })), 'Version 1.0.8 is ready. Restart to update');
  assert.equal(statusLine(snap({ phase: 'failed', step: 'check', message: 'x' })), 'Could not reach the update server. Try again later');
  assert.equal(statusLine(snap({ phase: 'idle' }, { mode: 'off', reason: 'appStore' })), 'The Mac App Store keeps the app up to date');
  assert.equal(
    statusLine(snap({ phase: 'idle' }, { mode: 'off', reason: 'microsoftStore' })),
    'The Microsoft Store keeps the app up to date'
  );
});

test('a check the user asked for gets a toast, unless the update prompt opens instead', () => {
  assert.deepEqual(manualCheckToast(snap({ phase: 'upToDate' })), {
    title: 'You have the latest version',
    description: 'Version 1.0.7',
  });
  assert.equal(manualCheckToast(snap({ phase: 'ready', update })), null);
  assert.equal(manualCheckToast(snap({ phase: 'available', update }, { mode: 'notify' })), null);
  assert.equal(manualCheckToast(snap({ phase: 'downloading', update, received: 0, total: null }))?.title, 'Downloading version 1.0.8');
  assert.equal(manualCheckToast(snap({ phase: 'failed', step: 'check', message: 'x' }))?.title, 'Could not check for updates');
  assert.equal(manualCheckToast(snap({ phase: 'failed', step: 'download', message: 'x' }))?.title, 'The update did not download');
  assert.equal(manualCheckToast(null)?.title, 'Could not check for updates');
});

test('only an https download page is opened; anything else falls back to the releases page', () => {
  assert.equal(downloadPageFor({ ...update, downloadPage: 'https://example.com/v1.0.8' }), 'https://example.com/v1.0.8');
  assert.equal(downloadPageFor({ ...update, downloadPage: 'javascript:alert(1)' }), RELEASES_PAGE);
  assert.equal(downloadPageFor(update), RELEASES_PAGE);
});

// ---- the schedule, against a fake shell -----------------------------------

const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
const answers = new Map<string, (args: Record<string, unknown>) => unknown>();
const callbacks = new Map<number, (message: unknown) => void>();
const listening: Array<{ event: string; id: number }> = [];
const storage = new Map<string, string>();
let nextCallback = 1;

function emitFromRust(event: string, payload: unknown) {
  for (const listener of listening) {
    if (listener.event === event) callbacks.get(listener.id)?.({ event, id: listener.id, payload });
  }
}

/** Lets every pending promise and IPC answer run. */
async function settle() {
  for (let round = 0; round < 25; round++) await new Promise<void>((resolve) => setImmediate(resolve));
}

function checksFor(channel: string) {
  return calls.filter((call) => call.cmd === 'abs_update_check' && call.args.channel === channel).length;
}

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');

before(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
          calls.push({ cmd, args });
          if (cmd === 'plugin:event|listen') {
            listening.push({ event: String(args.event), id: Number(args.handler) });
            return Number(args.handler);
          }
          if (cmd === 'plugin:event|unlisten') return null;
          const answer = answers.get(cmd);
          if (!answer) throw new Error(`the fake shell has no answer for ${cmd}`);
          return answer(args);
        },
        transformCallback: (callback: (message: unknown) => void) => {
          const id = nextCallback++;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, String(value)),
        removeItem: (key: string) => void storage.delete(key),
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} },
  });
  mock.timers.enable({ apis: ['setTimeout'] });
});

after(() => {
  mock.timers.reset();
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
  else Reflect.deleteProperty(globalThis, 'window');
  if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
  else Reflect.deleteProperty(globalThis, 'document');
});

test('the schedule waits before its first check, follows the channel, and answers the menu', async () => {
  answers.set('abs_update_state', () => snap({ phase: 'idle' }));
  answers.set('abs_update_check', () => snap({ phase: 'upToDate' }, { checkedAt: Date.now() }));
  const menuResults: Array<UpdateSnapshot | null> = [];

  const stop = startUpdates((result) => menuResults.push(result));
  await settle();
  assert.equal(getUpdateSnapshot()?.phase.phase, 'idle');
  assert.deepEqual(
    listening.map((listener) => listener.event).sort(),
    ['abs-update-check-requested', 'abs-update-state']
  );
  assert.equal(checksFor('stable'), 0, 'nothing is asked while the editor is still opening');

  mock.timers.tick(FIRST_CHECK_DELAY_MS);
  await settle();
  assert.equal(checksFor('stable'), 1);
  assert.equal(getUpdateSnapshot()?.phase.phase, 'upToDate');

  // A state change Rust sends lands in the shared copy.
  emitFromRust('abs-update-state', snap({ phase: 'downloading', update, received: 10, total: 2000 }));
  assert.equal(getUpdateSnapshot()?.phase.phase, 'downloading');

  // Switching to beta asks the new question straight away.
  writePreference('updatesBeta', true);
  await settle();
  assert.equal(checksFor('beta'), 1);

  // Help > Check for updates: the result goes back to whoever says what it found.
  answers.set('abs_update_check', () => snap({ phase: 'ready', update }, { checkedAt: Date.now() }));
  emitFromRust('abs-update-check-requested', null);
  await settle();
  assert.equal(menuResults.length, 1);
  assert.equal(menuResults[0]?.phase.phase, 'ready');
  assert.equal(manualCheckToast(menuResults[0]), null, 'the prompt opens instead of a toast');

  // With automatic checks off, the schedule leaves the server alone.
  writePreference('updatesAutoCheck', false);
  const before = calls.filter((call) => call.cmd === 'abs_update_check').length;
  mock.timers.tick(CHECK_INTERVAL_MS * 2);
  await settle();
  assert.equal(calls.filter((call) => call.cmd === 'abs_update_check').length, before);

  stop();
  await settle();
  assert.equal(calls.filter((call) => call.cmd === 'plugin:event|unlisten').length, 2);
});

test('an install that did not happen says why, and a successful one says nothing', async () => {
  answers.set('abs_update_install', () => {
    // A Rust command rejects with its error string, not an Error.
    throw 'edits-not-saved: the editor-2 window could not save its edits';
  });
  assert.equal((await restartIntoUpdate())?.title, 'The app did not restart');

  answers.set('abs_update_install', () => {
    throw 'Permission denied (os error 13)';
  });
  assert.equal((await restartIntoUpdate())?.title, 'The update was not installed');

  answers.set('abs_update_install', () => null);
  assert.equal(await restartIntoUpdate(), null);
});
