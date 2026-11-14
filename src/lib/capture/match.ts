/**
 * Which device suits a frame. A frame of an iPhone 17 Pro Max wants the
 * iPhone 17 Pro Max simulator: its screen has the frame's shape, so the
 * screenshot fills the frame with nothing cut off. Any phone of the same
 * platform comes next, then anything that runs.
 */

import type { CaptureTarget } from './frames';
import type { CaptureDevice, SimulatorModel } from './types';

/** Letters and digits only, lower case: "iPhone 17 Pro Max" reads "iphone17promax". */
function squash(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** An AVD name without the "API 35" its maker added: "Pixel 9 Pro API 35" reads "pixel9pro". */
function deviceName(device: Pick<CaptureDevice, 'name' | 'platform'>): string {
  const name = device.platform === 'android' ? device.name.replace(/\s+API\s+\d+.*$/i, '') : device.name;
  return squash(name);
}

export type DeviceFit = 'same-model' | 'same-platform' | 'other';

export function deviceFit(target: Pick<CaptureTarget, 'deviceLabel' | 'platform'>, device: CaptureDevice): DeviceFit {
  if (deviceName(device) === squash(target.deviceLabel)) return 'same-model';
  if (target.platform === device.platform) return 'same-platform';
  return 'other';
}

const FIT_RANK: Record<DeviceFit, number> = { 'same-model': 0, 'same-platform': 1, other: 2 };

/**
 * The running device that suits the frame best, or null when none runs. A
 * tie keeps the order the devices came in.
 */
export function bestRunningDevice(
  target: Pick<CaptureTarget, 'deviceLabel' | 'platform'> | null,
  devices: CaptureDevice[]
): CaptureDevice | null {
  const running = devices.filter((device) => device.state === 'running');
  if (!target) return running[0] ?? null;
  let best: CaptureDevice | null = null;
  for (const device of running) {
    if (!best || FIT_RANK[deviceFit(target, device)] < FIT_RANK[deviceFit(target, best)]) best = device;
  }
  return best;
}

/** The simulator model with the frame's own name, for making one the Mac lacks. */
export function modelForFrame(
  target: Pick<CaptureTarget, 'deviceLabel' | 'platform'>,
  models: SimulatorModel[]
): SimulatorModel | null {
  if (target.platform !== 'ios') return null;
  const wanted = squash(target.deviceLabel);
  return models.find((model) => squash(model.name) === wanted) ?? null;
}

/**
 * How far a picture's shape is from the frame's screen, as a fraction: 0 is
 * the same shape, 0.05 means one side would lose about 5%. Null when the
 * frame's screen is unknown (a frame of the user's own).
 */
export function shapeDifference(screenAspect: number | null, width: number, height: number): number | null {
  if (!screenAspect || width <= 0 || height <= 0) return null;
  const aspect = width / height;
  return Math.abs(aspect - screenAspect) / Math.max(aspect, screenAspect);
}

/** Past this the picture is cropped enough to see, so the view says so. */
export const SHAPE_WARNING = 0.02;
