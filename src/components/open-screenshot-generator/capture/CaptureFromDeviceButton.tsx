"use client";

// The Properties panel's way into Capture, beside Upload Screenshot and
// Upload Recording. A screenshot frame takes the running device's screen at
// once (the layout's handleCaptureScreenshot); a recording frame, or a frame
// with no device running, opens Capture on that frame instead.
//
// isTauri() is false on the server and in the first render (rule 14 in
// .agents/AGENTS.md), so the button decides it is on the desktop after mount.
// On the web it stays on screen, turned off with the reason, the way Growth's
// buttons are. So it does for an iPhone frame on a computer that cannot run
// the iPhone Simulator: Windows and Linux. The labels call the Simulator a
// virtual iPhone and an emulator a virtual device, as the Capture view does.

import React, { useEffect, useState } from 'react';
import { CameraIcon, CircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { knowPlatforms } from '@/lib/capture/desktop';
import { useCaptureSession } from '@/lib/capture/session';
import { isTauri } from '@/lib/desktop';
import { getDeviceDescriptor } from '@/lib/deviceRegistry';
import type { DeviceType } from '@/types/artboard';

export function CaptureFromDeviceButton({
  deviceType,
  kind,
  onClick,
}: {
  deviceType: DeviceType;
  kind: 'screenshot' | 'recording';
  onClick: () => void;
}) {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isTauri()), []);
  const platform = deviceType === 'custom' ? 'neutral' : getDeviceDescriptor(deviceType).platform;
  useEffect(() => {
    if (desktop && platform === 'ios') knowPlatforms();
  }, [desktop, platform]);
  const { iosMissing } = useCaptureSession();
  const noSimulator = desktop && platform === 'ios' && iosMissing === 'mac';
  const label = kind === 'recording' ? 'Record from device' : 'Screenshot from device';
  const on = platform === 'ios' ? 'a virtual iPhone' : platform === 'android' ? 'an Android phone or virtual device' : 'a device';
  const title = !desktop
    ? 'Needs the desktop app'
    : noSimulator
      ? 'Virtual iPhones need a Mac with Xcode'
      : kind === 'recording'
        ? `Open Capture to record your app on ${on}`
        : `Take a screenshot of your app on ${on}`;
  const off = !desktop || noSimulator;
  const button = (
    <Button
      variant="outline"
      size="sm"
      className="h-8 text-xs"
      title={off ? undefined : title}
      disabled={off}
      onClick={onClick}
      data-testid="capture-from-device"
    >
      {kind === 'recording' ? <CircleIcon className="mr-1.5 h-3 w-3 fill-current" /> : <CameraIcon className="mr-1.5 h-3 w-3" />}
      {label}
    </Button>
  );
  if (!off) return button;
  return (
    <span className="inline-flex cursor-not-allowed" title={title} data-gated-reason={title}>
      {button}
    </span>
  );
}
