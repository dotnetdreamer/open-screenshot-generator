"use client";

// The Properties panel's way into Capture, beside Upload Screenshot and
// Upload Recording. A screenshot frame takes the running device's screen at
// once (the layout's handleCaptureScreenshot); a recording frame, or a frame
// with no device running, opens Capture on that frame instead.
//
// isTauri() is false on the server and in the first render (rule 14 in
// .agents/AGENTS.md), so the button decides it is on the desktop after mount.
// On the web it stays on screen, turned off with the reason, the way Growth's
// buttons are.

import React, { useEffect, useState } from 'react';
import { CameraIcon, CircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  const from = platform === 'ios' ? 'Simulator' : platform === 'android' ? 'emulator' : 'a device';
  const label = kind === 'recording' ? `Record from ${from}` : `From ${from}`;
  const title = !desktop
    ? 'Needs the desktop app'
    : kind === 'recording'
      ? `Record the screen of ${platform === 'android' ? 'an Android emulator or phone' : 'the iPhone Simulator'} in Capture`
      : `Take a screenshot from ${platform === 'android' ? 'an Android emulator or phone' : 'the iPhone Simulator'}`;
  const button = (
    <Button
      variant="outline"
      size="sm"
      className="h-8 text-xs"
      title={desktop ? title : undefined}
      disabled={!desktop}
      onClick={onClick}
      data-testid="capture-from-device"
    >
      {kind === 'recording' ? <CircleIcon className="mr-1.5 h-3 w-3 fill-current" /> : <CameraIcon className="mr-1.5 h-3 w-3" />}
      {label}
    </Button>
  );
  if (desktop) return button;
  return (
    <span className="inline-flex cursor-not-allowed" title={title} data-gated-reason={title}>
      {button}
    </span>
  );
}
