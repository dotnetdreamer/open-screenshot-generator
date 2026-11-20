import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { ConnectionError, requestJson, runLoopbackFlow } from '@/lib/account/transport';
import { AccountCancelledError } from '@/lib/account/types';

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

afterEach(() => {
  if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
  else Reflect.deleteProperty(globalThis, 'window');
});

function useWindow(value: Record<string, unknown>) {
  Object.defineProperty(globalThis, 'window', { value, configurable: true });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail('The sign-in operation did not reach the expected step');
}

test('an already cancelled request makes no HTTP call', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(requestJson('https://example.com', {
    signal: controller.signal,
    fetchImpl: async () => { calls++; return new Response('{}'); },
  }), AccountCancelledError);
  assert.equal(calls, 0);
});

test('a cancelled HTTP request rejects immediately and ignores a late response', async () => {
  const controller = new AbortController();
  const response = deferred<Response>();
  let receivedSignal: AbortSignal | null | undefined;
  const result = requestJson('https://example.com', {
    signal: controller.signal,
    fetchImpl: async (_url, init) => { receivedSignal = init?.signal; return response.promise; },
  });
  const rejected = assert.rejects(result, AccountCancelledError);
  controller.abort();
  await rejected;
  assert.equal(receivedSignal?.aborted, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  response.resolve(new Response('{"late":true}'));
});

test('cancelling sign-in leaves a completed HTTP request alone', async () => {
  const controller = new AbortController();
  let requestAborts = 0;
  await requestJson('https://example.com', {
    signal: controller.signal,
    fetchImpl: async (_url, init) => {
      init?.signal?.addEventListener('abort', () => { requestAborts++; });
      return new Response('{}');
    },
  });
  controller.abort();
  assert.equal(requestAborts, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('a cancelled response body rejects before the body finishes', async () => {
  const controller = new AbortController();
  const body = deferred<string>();
  let reading = false;
  const result = requestJson('https://example.com', {
    signal: controller.signal,
    fetchImpl: async () => ({ ok: true, text: () => { reading = true; return body.promise; } }) as Response,
  });
  const rejected = assert.rejects(result, AccountCancelledError);
  await until(() => reading);
  controller.abort();
  await rejected;
  body.resolve('{"late":true}');
});

test('cancelling while native OAuth starts releases the late listener without opening a browser', async () => {
  const controller = new AbortController();
  const start = deferred<{ port: number; redirect_uri: string }>();
  const commands: { name: string; args?: Record<string, unknown> }[] = [];
  useWindow({ __TAURI_INTERNALS__: { invoke: async (name: string, args?: Record<string, unknown>) => {
    commands.push({ name, args });
    if (name === 'abs_oauth_start') return start.promise;
    return undefined;
  } } });
  const result = runLoopbackFlow((redirect) => `https://example.com/?redirect=${redirect}`, { signal: controller.signal });
  const rejected = assert.rejects(result, AccountCancelledError);
  await until(() => commands.some((command) => command.name === 'abs_oauth_start'));
  controller.abort();
  await rejected;
  start.resolve({ port: 47123, redirect_uri: 'http://127.0.0.1:47123' });
  await until(() => commands.some((command) => command.name === 'abs_oauth_cancel'));
  assert.deepEqual(commands.map((command) => command.name), ['abs_oauth_start', 'abs_oauth_cancel']);
  assert.equal(commands[1].args?.port, 47123);
});

test('cancelling an active loopback wait calls native cancellation and discards a late code', async () => {
  const controller = new AbortController();
  const callback = deferred<{ code: string; state: string }>();
  const commands: string[] = [];
  useWindow({ __TAURI_INTERNALS__: { invoke: async (name: string) => {
    commands.push(name);
    if (name === 'abs_oauth_start') return { port: 47124, redirect_uri: 'http://127.0.0.1:47124' };
    if (name === 'abs_oauth_await') return callback.promise;
    return undefined;
  } } });
  const result = runLoopbackFlow(() => 'https://example.com', { signal: controller.signal, expectedState: 'expected' });
  const rejected = assert.rejects(result, AccountCancelledError);
  await until(() => commands.includes('abs_oauth_await'));
  controller.abort();
  await rejected;
  assert.equal(commands.filter((name) => name === 'abs_oauth_cancel').length, 1);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  callback.resolve({ code: 'late-code', state: 'expected' });
});

test('a completed loopback flow still checks state and releases the listener', async () => {
  const commands: string[] = [];
  useWindow({ __TAURI_INTERNALS__: { invoke: async (name: string) => {
    commands.push(name);
    if (name === 'abs_oauth_start') return { port: 47125, redirect_uri: 'http://127.0.0.1:47125' };
    if (name === 'abs_oauth_await') return { code: 'code', state: 'unexpected' };
    return undefined;
  } } });
  await assert.rejects(runLoopbackFlow(() => 'https://example.com', { expectedState: 'expected' }), /did not match/);
  assert.equal(commands.at(-1), 'abs_oauth_cancel');
});

/** A desktop whose loopback commands fail the way Rust's do: with a plain string. */
function failingLoopback(command: string, text: string) {
  useWindow({ __TAURI_INTERNALS__: { invoke: async (name: string) => {
    if (name === command) throw text;
    if (name === 'abs_oauth_start') return { port: 47126, redirect_uri: 'http://127.0.0.1:47126' };
    return undefined;
  } } });
}

test('a sign-in left too long in the browser says so, not that something went wrong', async () => {
  failingLoopback('abs_oauth_await', 'sign-in timed out');
  await assert.rejects(runLoopbackFlow(() => 'https://example.com'), (error: unknown) => {
    assert.ok(error instanceof Error && !(error instanceof AccountCancelledError));
    assert.match(error.message, /took longer than 5 minutes/);
    return true;
  });
  failingLoopback('abs_oauth_await', 'sign-in timed out');
  await assert.rejects(runLoopbackFlow(() => 'https://example.com', { timeoutSecs: 60 }), /longer than 1 minute,/);
});

test('a listener that fails in Rust reaches the dialog as a sentence', async () => {
  failingLoopback('abs_oauth_await', 'the sign-in listener failed: broken pipe');
  await assert.rejects(runLoopbackFlow(() => 'https://example.com'), /didn't finish/);
  failingLoopback('abs_oauth_start', 'could not open a local port for sign-in: denied');
  await assert.rejects(runLoopbackFlow(() => 'https://example.com'), /didn't finish/);
});

test('Rust saying the sign-in was cancelled is a cancellation', async () => {
  failingLoopback('abs_oauth_await', 'sign-in cancelled');
  await assert.rejects(runLoopbackFlow(() => 'https://example.com'), AccountCancelledError);
});

test('a request that fails with a plain string asks to check the connection', async () => {
  await assert.rejects(
    requestJson('https://example.com', { fetchImpl: async () => { throw 'error sending request for url'; } }),
    /couldn't connect/
  );
});

test('an answer that stops halfway with a plain string asks to check the connection too', async () => {
  // The desktop's HTTP plugin reads the body as a stream, which fails with a string.
  const halfway = { ok: true, status: 200, text: () => Promise.reject('error decoding response body') } as unknown as Response;
  await assert.rejects(requestJson('https://example.com', { fetchImpl: async () => halfway }), /couldn't connect/);
});

test("a browser's own words for no connection become the same sentence, and other errors keep theirs", async () => {
  // Chrome says "Failed to fetch", Safari "Load failed", Firefox "NetworkError...": all TypeErrors.
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(requestJson('https://example.com', { fetchImpl: offline }), (error: unknown) => {
    assert.ok(error instanceof ConnectionError);
    assert.equal(error.message, "The app couldn't connect. Check your internet connection, then try again.");
    return true;
  });
  const dropped = { ok: true, status: 200, text: () => Promise.reject(new TypeError('network error')) } as unknown as Response;
  await assert.rejects(requestJson('https://example.com', { fetchImpl: async () => dropped }), ConnectionError);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    requestJson('https://example.com', { fetchImpl: async () => { throw new Error('should not be called'); }, signal: controller.signal }),
    AccountCancelledError
  );
});

process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'test-google-client.apps.googleusercontent.com';
process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID = 'test-github-client';

type GoogleResponse = { access_token?: string; expires_in?: number; scope?: string };
let googleCallback: ((response: GoogleResponse) => void) | undefined;
function respondToGoogle(response: GoogleResponse) {
  assert.ok(googleCallback);
  googleCallback(response);
}
const googleApi = { accounts: { oauth2: { initTokenClient: (config: { callback: typeof googleCallback }) => {
  googleCallback = config.callback;
  return { requestAccessToken: () => {} };
} } } };

test('Google cancellation ignores a late GIS callback without looking up the account', async () => {
  googleCallback = undefined;
  let accountCalls = 0;
  useWindow({ google: googleApi, fetch: async () => { accountCalls++; return new Response('{}'); } });
  const { googleDriveProvider } = await import('@/lib/account/providers/googleDrive');
  const controller = new AbortController();
  const result = googleDriveProvider.signIn({ signal: controller.signal });
  const rejected = assert.rejects(result, AccountCancelledError);
  await until(() => !!googleCallback);
  controller.abort();
  await rejected;
  respondToGoogle({ access_token: 'late-token' });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(accountCalls, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('Google cancellation aborts an account lookup after browser consent', async () => {
  googleCallback = undefined;
  const account = deferred<Response>();
  let lookupSignal: AbortSignal | null | undefined;
  useWindow({ google: googleApi, fetch: async (_url: string, init?: RequestInit) => {
    lookupSignal = init?.signal;
    return account.promise;
  } });
  const { googleDriveProvider } = await import('@/lib/account/providers/googleDrive');
  const controller = new AbortController();
  const result = googleDriveProvider.signIn({ signal: controller.signal });
  const rejected = assert.rejects(result, AccountCancelledError);
  await until(() => !!googleCallback);
  respondToGoogle({ access_token: 'test-token' });
  await until(() => !!lookupSignal);
  controller.abort();
  await rejected;
  assert.equal(lookupSignal?.aborted, true);
  account.resolve(new Response('{"sub":"late-user"}'));
});

test('GitHub cancellation aborts the desktop device-code request before showing a user code', async () => {
  const send = deferred<unknown>();
  let sendStarted = false;
  let cancelled = false;
  let userCodes = 0;
  useWindow({ __TAURI_INTERNALS__: { invoke: async (name: string) => {
    if (name === 'plugin:http|fetch') return 17;
    if (name === 'plugin:http|fetch_send') { sendStarted = true; return send.promise; }
    if (name === 'plugin:http|fetch_cancel') { cancelled = true; send.reject(new Error('Request cancelled')); }
    return undefined;
  } } });
  const { githubProvider } = await import('@/lib/account/providers/github');
  const controller = new AbortController();
  const result = githubProvider.signIn({ signal: controller.signal, onUserCode: () => { userCodes++; } });
  const rejected = assert.rejects(result, AccountCancelledError);
  await until(() => sendStarted);
  controller.abort();
  await rejected;
  assert.equal(cancelled, true);
  assert.equal(userCodes, 0);
});

test('GitHub cancellation aborts a pasted-token account lookup', async () => {
  const account = deferred<Response>();
  let lookupSignal: AbortSignal | null | undefined;
  useWindow({ fetch: async (_url: string, init?: RequestInit) => {
    lookupSignal = init?.signal;
    return account.promise;
  } });
  const { githubProvider } = await import('@/lib/account/providers/github');
  const controller = new AbortController();
  const result = githubProvider.signIn({ token: 'test-token', signal: controller.signal });
  const rejected = assert.rejects(result, AccountCancelledError);
  await until(() => !!lookupSignal);
  controller.abort();
  await rejected;
  assert.equal(lookupSignal?.aborted, true);
  account.resolve(new Response('{"id":123,"login":"late-user"}'));
});
