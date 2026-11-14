/**
 * The Capture commands of the desktop app (src-tauri/src/device_capture.rs).
 * Each one answers editor windows only. Screenshots and recordings come back
 * as raw bytes, which Tauri hands over as an ArrayBuffer.
 */

import { isTauri } from '@/lib/desktop';
import type { CaptureApp, CaptureDevices, CapturePlatform } from './types';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Taking screenshots from a device needs the desktop app');
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    // Rust answers a plain sentence; anything else is passed on as it came.
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** Bytes as Tauri delivers them: an ArrayBuffer, or a number array from an older bridge. */
function toBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw new Error('The device sent something that is not a picture');
}

export function listDevices(): Promise<CaptureDevices> {
  return call<CaptureDevices>('abs_capture_devices');
}

export function startDevice(platform: CapturePlatform, id: string): Promise<void> {
  return call<void>('abs_capture_start_device', { platform, id });
}

/** Makes a simulator of one model and answers its UDID. */
export function createSimulator(model: string): Promise<string> {
  return call<string>('abs_capture_create_simulator', { model });
}

export function listApps(platform: CapturePlatform, id: string): Promise<CaptureApp[]> {
  return call<CaptureApp[]>('abs_capture_apps', { platform, id });
}

export function tidyStatusBar(platform: CapturePlatform, id: string, tidy: boolean): Promise<void> {
  return call<void>('abs_capture_tidy_status_bar', { platform, id, tidy });
}

export function setAppearance(platform: CapturePlatform, id: string, dark: boolean): Promise<void> {
  return call<void>('abs_capture_appearance', { platform, id, dark });
}

/**
 * Opens the app from the start, in a language, on the screen a link opens.
 * The link goes to iOS as the launch argument -OSGLink for the app to open
 * (iOS asks before it opens a link from outside), to Android as a VIEW intent.
 */
export function launchApp(
  platform: CapturePlatform,
  id: string,
  appId: string,
  language?: { language: string; region?: string } | null,
  link?: string | null
): Promise<void> {
  return call<void>('abs_capture_launch', {
    platform,
    id,
    appId,
    language: language?.language ?? null,
    region: language?.region ?? null,
    link: link ?? null,
  });
}

/**
 * The screen now. `preview` asks for a smaller file for the live view (a
 * JPEG on iOS); a capture that goes into a frame is a full size PNG.
 */
export async function takeScreenshot(platform: CapturePlatform, id: string, preview = false): Promise<Blob> {
  const bytes = toBytes(await call<unknown>('abs_capture_screenshot', { platform, id, preview }));
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  // A copy into a fresh buffer: the Blob must not keep a view into Tauri's.
  return new Blob([bytes.slice()], { type: isPng ? 'image/png' : 'image/jpeg' });
}

export function startRecording(platform: CapturePlatform, id: string): Promise<void> {
  return call<void>('abs_capture_record_start', { platform, id });
}

/** Ends the recording and answers the movie. */
export async function stopRecording(platform: CapturePlatform, id: string): Promise<Blob> {
  const bytes = toBytes(await call<unknown>('abs_capture_record_stop', { platform, id }));
  return new Blob([bytes.slice()], { type: 'video/mp4' });
}
