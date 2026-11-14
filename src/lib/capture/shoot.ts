/**
 * Taking one screenshot from a device and storing it, for the Capture view
 * and for the Properties panel's button.
 *
 * The picture is stored once in the media table and travels as `asset:<id>`
 * (rule 32 in .agents/AGENTS.md), so a screenshot put into five frames is one
 * row. Before the first screenshot from a device in a sitting, its status bar
 * is tidied when the switch says so; the device keeps that until the status
 * bar is put back, which the desktop app does when it quits.
 */

import { saveImageBlobAsset } from '@/lib/mcp/assetStore';
import { listDevices, takeScreenshot, tidyStatusBar } from './desktop';
import { bestRunningDevice } from './match';
import type { CaptureTarget } from './frames';
import { addCapturedShot, getCaptureSession, updateCaptureSession } from './session';
import type { CaptureDevice, CapturedShot } from './types';

const tidied = new Set<string>();

function deviceKey(device: Pick<CaptureDevice, 'platform' | 'id'>): string {
  return `${device.platform}:${device.id}`;
}

/** Forget that a device was tidied, after it restarted or the switch went off. */
export function forgetTidy(device: Pick<CaptureDevice, 'platform' | 'id'>): void {
  tidied.delete(deviceKey(device));
}

export function isTidied(device: Pick<CaptureDevice, 'platform' | 'id'>): boolean {
  return tidied.has(deviceKey(device));
}

/**
 * Tidies the device's status bar once per sitting. `wanted` is Capture's
 * switch unless the caller says otherwise, as an agent's tool call can.
 */
export async function ensureTidy(device: CaptureDevice, wanted = getCaptureSession().tidy): Promise<void> {
  if (!wanted || tidied.has(deviceKey(device))) return;
  await tidyStatusBar(device.platform, device.id, true);
  tidied.add(deviceKey(device));
}

/** Puts the real status bar back on a device this sitting tidied. */
export async function untidy(device: CaptureDevice): Promise<void> {
  if (!tidied.has(deviceKey(device))) return;
  tidied.delete(deviceKey(device));
  await tidyStatusBar(device.platform, device.id, false);
}

export async function shootDevice(device: CaptureDevice, language: string | null, tidy?: boolean): Promise<CapturedShot> {
  await ensureTidy(device, tidy);
  const blob = await takeScreenshot(device.platform, device.id);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const asset = await saveImageBlobAsset(blob, { name: `${device.name} ${stamp}.png` });
  const shot: CapturedShot = {
    ref: asset.ref,
    width: asset.width ?? 0,
    height: asset.height ?? 0,
    deviceName: device.name,
    platform: device.platform,
    language,
    takenAt: Date.now(),
  };
  addCapturedShot(shot);
  return shot;
}

/**
 * The device a screenshot for this frame comes from without opening Capture:
 * the one picked in Capture when it is running, else the running device that
 * suits the frame best. Null when nothing runs, and then the caller opens
 * Capture instead.
 */
export async function deviceForQuickCapture(target: CaptureTarget | null): Promise<CaptureDevice | null> {
  const listed = await listDevices();
  const all = [...listed.ios.devices, ...listed.android.devices];
  const picked = getCaptureSession().device;
  const fresh = picked ? all.find((device) => device.platform === picked.platform && device.id === picked.id) : undefined;
  if (fresh?.state === 'running') {
    updateCaptureSession({ device: fresh });
    return fresh;
  }
  const best = bestRunningDevice(target, all);
  if (best) updateCaptureSession({ device: best });
  return best;
}
