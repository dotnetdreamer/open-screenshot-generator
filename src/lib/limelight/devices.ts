/**
 * The devices a Limelight stage can hold: every phone and tablet with a 3D
 * model, the ones measured from their makers' drawings first, grouped the
 * way the device picker shows them.
 */

import type { DeviceType } from '@/types/artboard';
import { PHONE_MODELS } from '@/lib/device3dModels';
import { DEVICE_REGISTRY } from '@/lib/deviceRegistry';
import { isStageDevice } from './scene';

export interface StageDeviceOption {
  device: DeviceType;
  label: string;
  group: 'iPhone' | 'Android' | 'Tablets';
  /** Built from the maker's drawings, rather than a plain stand-in. */
  measured: boolean;
}

let cached: StageDeviceOption[] | null = null;

export function stageDevices(): StageDeviceOption[] {
  if (cached) return cached;
  const options: StageDeviceOption[] = [];
  const seen = new Set<DeviceType>();
  for (const model of PHONE_MODELS) {
    seen.add(model.id);
    options.push({ device: model.id, label: model.label, group: model.maker === 'google' ? 'Android' : 'iPhone', measured: true });
  }
  for (const descriptor of Object.values(DEVICE_REGISTRY)) {
    if (seen.has(descriptor.id) || !isStageDevice(descriptor.id)) continue;
    seen.add(descriptor.id);
    const group = descriptor.category === 'tablet' ? 'Tablets' : descriptor.platform === 'android' ? 'Android' : 'iPhone';
    options.push({ device: descriptor.id, label: descriptor.label, group, measured: false });
  }
  const order = { iPhone: 0, Android: 1, Tablets: 2 } as const;
  cached = options.sort((a, b) => order[a.group] - order[b.group] || Number(b.measured) - Number(a.measured));
  return cached;
}
