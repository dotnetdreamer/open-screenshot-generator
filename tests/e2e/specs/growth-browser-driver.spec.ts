import { test, expect, type Page } from '../fixtures/test';
import { driverSource } from '../helpers/growthBrowser';

// The Growth browser's driver (src/lib/growth/setup/driver.ts) on its own, in
// both engines: Chromium is the Windows browser (WebView2), WebKit the macOS
// one. Each page here is served at an App Store Connect address, with the
// driver injected the way Tauri injects it, and the test sends the driver the
// commands Rust sends. These are the rules the driver keeps in the page
// itself, whatever the model or the rest of the app does: what it never
// reads, where it never types, and what it never presses.

const CONSOLE = 'https://appstoreconnect.apple.com/access/integrations/api';

async function consolePage(page: Page, body: string): Promise<void> {
  await page.route(`${CONSOLE}**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><title>Console</title></head><body>${body}</body></html>` })
  );
  await page.addInitScript({ content: driverSource() });
  await page.goto(CONSOLE);
}

/** One driver command, sent as Rust sends it, and its answer. */
async function run<T = Record<string, unknown>>(page: Page, command: Record<string, unknown>): Promise<T> {
  const text = await page.evaluate(
    (sent) => (window as unknown as { __osgGrowthDriver: { run: (command: unknown) => string } }).__osgGrowthDriver.run(sent),
    command
  );
  return JSON.parse(text) as T;
}

interface Snapshot {
  text: string;
  signIn: boolean;
}

const snapshot = (page: Page) => run<Snapshot>(page, { cmd: 'snapshot' });

/** The number the outline gives the control named `name`. */
async function refOf(page: Page, name: string): Promise<number> {
  const { text } = await snapshot(page);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\[(\\d+)\\] [a-z]+ "${escaped}"`).exec(text);
  if (!match) throw new Error(`No control "${name}" in:\n${text}`);
  return Number(match[1]);
}

test.describe('the Growth browser driver', () => {
  test('a password in a frame from the same site is never read, and the page counts as a sign-in page', async ({ page }) => {
    await consolePage(
      page,
      `<h1>Sign in</h1>
       <iframe id="frame" style="width:520px;height:220px" srcdoc="<label>Email <input id='email'></label><label>Password <input type='password' value='FRAME_PASSWORD_SENTINEL'></label>"></iframe>`
    );
    await expect(page.frameLocator('#frame').locator('input[type=password]')).toBeAttached();
    const page1 = await snapshot(page);
    expect(page1.text).not.toContain('FRAME_PASSWORD_SENTINEL');
    expect(page1.text).toContain('value=(hidden)');
    expect(page1.signIn).toBe(true);
    // The email box beside it is not typed in either: the user signs in.
    const typed = await run<{ ok: boolean; error?: string }>(page, { cmd: 'type', ref: await refOf(page, 'Email'), text: 'someone@example.com' });
    expect(typed.ok).toBe(false);
    expect(typed.error).toMatch(/sign-in page/);
    await expect(page.frameLocator('#frame').locator('#email')).toHaveValue('');
  });

  test('a verification code box is never read or typed in, with or without autocomplete', async ({ page }) => {
    await consolePage(
      page,
      `<label>Verification code <input id="code" inputmode="numeric" name="totpPin" value="123456"></label>
       <label>Enter code <input id="otp" autocomplete="one-time-code" value="654321"></label>`
    );
    const read = await snapshot(page);
    expect(read.text).not.toContain('123456');
    expect(read.text).not.toContain('654321');
    expect(read.signIn).toBe(true);
    const typed = await run<{ ok: boolean }>(page, { cmd: 'type', ref: await refOf(page, 'Verification code'), text: '111111' });
    expect(typed.ok).toBe(false);
    await expect(page.locator('#code')).toHaveValue('123456');
  });

  test('a box for other private details is hidden without making the page a sign-in page', async ({ page }) => {
    await consolePage(page, `<label>Promo code <input id="promo" value="SPRING-SECRET"></label><label>Key name <input id="name"></label>`);
    const read = await snapshot(page);
    expect(read.text).not.toContain('SPRING-SECRET');
    expect(read.signIn).toBe(false);
    expect((await run<{ ok: boolean }>(page, { cmd: 'type', ref: await refOf(page, 'Promo code'), text: 'x' })).ok).toBe(false);
    expect((await run<{ ok: boolean }>(page, { cmd: 'type', ref: await refOf(page, 'Key name'), text: 'Open Screenshot Generator' })).ok).toBe(true);
    await expect(page.locator('#name')).toHaveValue('Open Screenshot Generator');
  });

  test('a private key shown on the page never leaves it', async ({ page }) => {
    const key = '-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgPAGE_KEY_SENTINEL\n-----END PRIVATE KEY-----';
    await consolePage(page, `<h1>Your key</h1><pre>${key}</pre><textarea aria-label="Key">${key}</textarea><p>Key ID 2X9R4HXF34</p>`);
    const read = await snapshot(page);
    expect(read.text).not.toContain('PAGE_KEY_SENTINEL');
    expect(read.text).not.toContain('MIGTAgEAMBMG');
    expect(read.text).toContain('[a private key, hidden]');
    expect(read.text).toContain('Key ID 2X9R4HXF34');
  });

  test('a control that changed after it was judged is not pressed', async ({ page }) => {
    await consolePage(page, `<button id="target" type="button" onclick="window.pressed = this.textContent">Save</button>`);
    const ref = await refOf(page, 'Save');
    const judged = await run<{ name: string; role: string }>(page, { cmd: 'describe', ref });
    expect(judged).toMatchObject({ name: 'Save', role: 'button' });
    // While the user decides, the page renames the button.
    await page.locator('#target').evaluate((button) => (button.textContent = 'Delete account'));
    const pressed = await run<{ ok: boolean; error?: string }>(page, { cmd: 'click', ref, expect: { name: judged.name, role: judged.role } });
    expect(pressed.ok).toBe(false);
    expect(pressed.error).toMatch(/changed from "Save" to "Delete account"/);
    expect(await page.evaluate(() => (window as unknown as { pressed?: string }).pressed)).toBeUndefined();
    // The same control as it is now can be pressed.
    expect((await run<{ ok: boolean }>(page, { cmd: 'click', ref, expect: { name: 'Delete account', role: 'button' } })).ok).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { pressed?: string }).pressed)).toBe('Delete account');
  });

  test('a sign-in form a click brings up stops the typing that follows it', async ({ page }) => {
    await consolePage(
      page,
      `<label>Email <input id="email"></label>
       <button type="button" onclick="document.body.insertAdjacentHTML('beforeend', '<label>Password <input type=password></label>')">Continue</button>`
    );
    const email = await refOf(page, 'Email');
    const next = await refOf(page, 'Continue');
    expect((await snapshot(page)).signIn).toBe(false);
    expect((await run<{ ok: boolean }>(page, { cmd: 'click', ref: next })).ok).toBe(true);
    // The same answer goes on to type, with no new look at the page between.
    const typed = await run<{ ok: boolean; error?: string }>(page, { cmd: 'type', ref: email, text: 'someone@example.com' });
    expect(typed.ok).toBe(false);
    expect(typed.error).toMatch(/sign-in page/);
    await expect(page.locator('#email')).toHaveValue('');
  });

  test('a choice is looked at before it is made, and made by its exact text, in a frame too', async ({ page }) => {
    await consolePage(
      page,
      `<label>Status <select id="status" onchange="window.changed = this.value"><option value="on">Enabled</option><option value="off">Disable account</option></select></label>
       <iframe id="frame" style="width:400px;height:120px" srcdoc="<label>Access <select id='access' onchange='window.changed = this.value'><option>Developer</option><option>Admin</option></select></label><label>Name <input id='name' oninput='window.typed = this.value'></label>"></iframe>`
    );
    await expect(page.frameLocator('#frame').locator('#access')).toBeAttached();
    const status = await refOf(page, 'Status');
    const preview = await run<{ ok: boolean; picked?: string }>(page, { cmd: 'pick', ref: status, option: 'Disable', preview: true });
    expect(preview).toEqual({ ok: true, picked: 'Disable account' });
    expect(await page.evaluate(() => (window as unknown as { changed?: string }).changed)).toBeUndefined();
    await expect(page.locator('#status')).toHaveValue('on');
    expect((await run<{ ok: boolean }>(page, { cmd: 'pick', ref: status, option: 'Disable', exact: true })).ok).toBe(false);

    // In a frame from the same site, with the frame's own elements.
    const access = await refOf(page, 'Access');
    expect((await run<{ ok: boolean }>(page, { cmd: 'pick', ref: access, option: 'Admin', exact: true })).ok).toBe(true);
    await expect(page.frameLocator('#frame').locator('#access')).toHaveValue('Admin');
    expect((await run<{ ok: boolean }>(page, { cmd: 'type', ref: await refOf(page, 'Name'), text: 'Open Screenshot Generator' })).ok).toBe(true);
    await expect(page.frameLocator('#frame').locator('#name')).toHaveValue('Open Screenshot Generator');
    const frameState = await page.frameLocator('#frame').locator('body').evaluate(() => ({
      changed: (window as unknown as { changed?: string }).changed,
      typed: (window as unknown as { typed?: string }).typed,
    }));
    expect(frameState).toEqual({ changed: 'Admin', typed: 'Open Screenshot Generator' });
  });

  test('a control in a dialog is described with the dialog title, never its body', async ({ page }) => {
    await consolePage(
      page,
      `<div id="revoke" role="dialog" aria-modal="true" aria-labelledby="title" style="width:400px;height:200px">
         <h2 id="title">Revoke API key?</h2><p>Apps that use it stop working. Delete it only if you are sure.</p>
         <button type="button">Cancel</button><button type="button">OK</button>
       </div>`
    );
    const ok = await run<{ dialog: string | null; inDialog: boolean }>(page, { cmd: 'describe', ref: await refOf(page, 'OK') });
    expect(ok).toMatchObject({ inDialog: true, dialog: 'Revoke API key?' });
    // No label: the first heading is the title, and the body's words stay out.
    await page.evaluate(() => {
      document.getElementById('revoke')!.outerHTML =
        '<div role="dialog" style="width:400px;height:200px"><h3>Download API Key</h3><p>You can revoke the key later.</p><button type="button">Download</button></div>';
    });
    const download = await run<{ dialog: string | null }>(page, { cmd: 'describe', ref: await refOf(page, 'Download') });
    expect(download.dialog).toBe('Download API Key');
  });
});
