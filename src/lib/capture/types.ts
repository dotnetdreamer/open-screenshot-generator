/**
 * What the desktop app reports about the simulators, emulators and phones it
 * can take screenshots from (src-tauri/src/device_capture.rs), in the shapes
 * the Capture view works with.
 */

export type CapturePlatform = 'ios' | 'android';

export type CaptureDeviceKind = 'simulator' | 'emulator' | 'phone';

export type CaptureDeviceState = 'running' | 'starting' | 'off' | 'unauthorized' | 'offline';

export interface CaptureDevice {
  /** A simulator's UDID, an adb serial, or `avd:<name>` for an emulator that is off. */
  id: string;
  platform: CapturePlatform;
  kind: CaptureDeviceKind;
  name: string;
  state: CaptureDeviceState;
  /** "iOS 26.5", "Android 16". */
  os: string;
  /** A simulator's device type identifier. */
  model?: string;
}

/** A simulator model the newest iOS on the Mac can run. */
export interface SimulatorModel {
  id: string;
  name: string;
  family: 'iPhone' | 'iPad' | string;
}

/** Why a platform offers nothing on this computer. */
export type CaptureMissing = 'mac' | 'xcode' | 'sdk';

export interface PlatformDevices {
  missing?: CaptureMissing;
  devices: CaptureDevice[];
  models: SimulatorModel[];
}

export interface CaptureDevices {
  ios: PlatformDevices;
  android: PlatformDevices;
}

export interface CaptureApp {
  id: string;
  name: string;
  /** Open on the device now (on Android, the app in front). */
  running: boolean;
}

/** A screenshot just taken, before or after it went into a frame. */
export interface CapturedShot {
  /** `asset:<id>`, stored once in the media table. */
  ref: string;
  width: number;
  height: number;
  deviceName: string;
  platform: CapturePlatform;
  /** The language the app was opened in, when Capture opened it. */
  language: string | null;
  takenAt: number;
}

/** A recording just taken, stored in the media table. */
export interface CapturedClip {
  mediaId: string;
  width: number;
  height: number;
  duration: number;
  deviceName: string;
  takenAt: number;
}
