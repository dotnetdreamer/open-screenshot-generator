"use client";
import type React from 'react';
import type { DeviceType } from '@/types/artboard';
import { getDeviceDescriptor } from '@/lib/deviceRegistry';

// The flat (non-3D) device frame's own chrome: outer corner radius, body
// colour, and the notch / Dynamic Island / punch-hole JSX. Shared by
// DeviceFrameElement (screenshot inside the screen) and VideoDeviceElement
// (screen recording inside the screen) so a bezel or cutout fix lands in ONE
// place and both element types stay identical.
//
// Sizes derive from the element's EFFECTIVE width (size * scale), matching how
// DraggableElement renders the wrapper. Cutouts are anchored inside the screen
// (percentages + aspect-ratio), so they stay glued to its top edge at any size
// or aspect ratio, and they read --notch-bg / --frame-bg from the frame style
// below so per-element colour overrides work without prop drilling.

export interface FlatDeviceChrome {
  /** CSS border-radius for the device body. */
  outerBorderRadius: string;
  /** Default body colour (element.frameColor overrides it). */
  bodyColor: string;
  /** Notch / island / punch-hole, or null for devices without a cutout. */
  notch: React.ReactNode;
  /** CSS border-radius of the screen area. */
  screenBorderRadius: string;
  /** Bezel insets as % of the effective width (all four derive from width). */
  paddingPercent: { top: number; right: number; bottom: number; left: number };
  label: string;
}

const DEFAULT_PADDING = { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 };

/** Dynamic Island pill (iPhone 15/15 Pro/17 Pro Max). */
function islandNotch(topPercent: string, widthPercent: string, aspect: string): React.ReactNode {
  return (
    <div
      data-device-notch="true"
      style={{
        position: 'absolute',
        top: topPercent,
        left: '50%',
        transform: 'translateX(-50%)',
        width: widthPercent,
        aspectRatio: aspect,
        backgroundColor: 'var(--notch-bg, #000)',
        borderRadius: '9999px',
        zIndex: 3, // Above screen content
      }}
    />
  );
}

/** Classic notch glued to the screen's top edge (iPhone X/13/14, Android). */
function classicNotch(
  widthPercent: string,
  aspect: string,
  radiusX: string,
  radiusY: string,
  bodyColor: string
): React.ReactNode {
  return (
    <div
      data-device-notch="true"
      style={{
        position: 'absolute',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: widthPercent,
        aspectRatio: aspect,
        backgroundColor: `var(--notch-bg, var(--frame-bg, ${bodyColor}))`,
        borderBottomLeftRadius: `${radiusX} ${radiusY}`,
        borderBottomRightRadius: `${radiusX} ${radiusY}`,
        zIndex: 3,
      }}
    />
  );
}

/** Circular camera cutout (Android punch hole). */
function punchHoleNotch(): React.ReactNode {
  return (
    <div
      data-device-notch="true"
      style={{
        position: 'absolute',
        top: '1.2%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '5%',
        aspectRatio: '1 / 1',
        backgroundColor: 'var(--notch-bg, #000)',
        borderRadius: '50%',
        zIndex: 3,
      }}
    />
  );
}

/**
 * Chrome for one flat device frame at the given effective width.
 * `custom` devices (user-uploaded frame image) have no generated chrome.
 */
export function getFlatDeviceChrome(deviceType: DeviceType, effectiveWidth: number): FlatDeviceChrome {
  const descriptor = getDeviceDescriptor(deviceType);
  const chrome: FlatDeviceChrome = {
    outerBorderRadius: 'calc(1rem * var(--scale-factor, 1))',
    bodyColor: '#111',
    notch: null,
    screenBorderRadius: descriptor.screen
      ? `${effectiveWidth * descriptor.screen.radiusFactor}px`
      : 'calc(0.8rem * var(--scale-factor, 1))',
    paddingPercent: descriptor.screen?.paddingPercent ?? DEFAULT_PADDING,
    label: descriptor.label,
  };
  const radius = (factor: number) => `${effectiveWidth * factor}px`;

  switch (deviceType) {
    case 'iphone-15':
      chrome.outerBorderRadius = radius(0.14);
      chrome.notch = islandNotch('1.6%', '26%', '3.5 / 1');
      break;
    case 'iphone-15-pro':
      chrome.outerBorderRadius = radius(0.14);
      chrome.bodyColor = '#1e1e1e'; // Darker titanium color
      chrome.notch = islandNotch('1.6%', '26%', '3.5 / 1');
      break;
    case 'iphone-17-pro-max':
      chrome.outerBorderRadius = radius(0.15);
      chrome.bodyColor = '#1e1e1e';
      chrome.notch = islandNotch('1.5%', '25%', '3.6 / 1');
      break;
    case 'iphone-14':
      chrome.outerBorderRadius = radius(0.13);
      chrome.notch = classicNotch('32%', '4.6 / 1', '11%', '50%', chrome.bodyColor);
      break;
    case 'iphone-13':
      chrome.outerBorderRadius = radius(0.12);
      chrome.notch = classicNotch('34%', '4.4 / 1', '11%', '48%', chrome.bodyColor);
      break;
    case 'iphone-x':
      chrome.outerBorderRadius = radius(0.12);
      chrome.notch = classicNotch('36%', '4.2 / 1', '12%', '50%', chrome.bodyColor);
      break;
    case 'iphone':
      chrome.outerBorderRadius = radius(0.1);
      break;
    case 'android-bar':
      chrome.outerBorderRadius = radius(0.025);
      break;
    case 'android-notch':
      chrome.outerBorderRadius = radius(0.025);
      chrome.notch = classicNotch('32%', '5 / 1', '12%', '60%', chrome.bodyColor);
      break;
    case 'android-punch-hole':
      chrome.outerBorderRadius = radius(0.025);
      chrome.notch = punchHoleNotch();
      break;
    case 'tablet':
      chrome.outerBorderRadius = radius(0.02);
      break;
    case 'ipad-pro-13':
      // Modern iPad Pro/Air slab: uniform thin bezel, softly rounded body.
      chrome.outerBorderRadius = radius(0.05);
      chrome.bodyColor = '#1e1e1e';
      break;
    case 'ipad-11':
      chrome.outerBorderRadius = radius(0.055);
      chrome.bodyColor = '#1e1e1e';
      break;
    case 'tablet-7':
      // Chunkier bezels than the 10-inch; typical budget Android slate.
      chrome.outerBorderRadius = radius(0.045);
      break;
    case 'tablet-10':
      chrome.outerBorderRadius = radius(0.032);
      break;
    case 'desktop':
      chrome.outerBorderRadius = radius(0.013);
      chrome.bodyColor = '#333';
      break;
    case 'apple-watch':
    case 'custom':
      break;
  }
  return chrome;
}

export interface FlatFrameStyleOptions {
  frameColor?: string;
  frameOpacity?: number;
  frameStyle?: 'solid' | 'outline';
  notchColor?: string;
  scale?: number;
}

/**
 * The body + screen CSS for a flat frame, honouring the colored-device presets
 * (recolour, translucent "clay", hollow outline). Element id is stamped on the
 * nodes so the video exporter can find the screen and frame while capturing
 * chrome sprites.
 */
export function getFlatFrameStyles(
  chrome: FlatDeviceChrome,
  effectiveWidth: number,
  opts: FlatFrameStyleOptions
): { frame: React.CSSProperties; screen: React.CSSProperties; isOutline: boolean } {
  const frameFill = opts.frameColor ?? chrome.bodyColor;
  const frameAlpha = opts.frameOpacity ?? 1;
  const isOutline = opts.frameStyle === 'outline';
  const frameFillCss =
    frameAlpha >= 1
      ? frameFill
      : `color-mix(in srgb, ${frameFill} ${Math.round(frameAlpha * 100)}%, transparent)`;

  const frame: React.CSSProperties = {
    width: '100%',
    height: '100%',
    // A drop shadow behind a see-through or hollow frame reads as a dark slab
    boxShadow: isOutline || frameAlpha < 1 ? 'none' : '0 4px 12px rgba(0,0,0,0.3)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    borderRadius: chrome.outerBorderRadius,
    backgroundColor: isOutline ? 'transparent' : frameFillCss,
    border: isOutline ? `${Math.max(2, effectiveWidth * 0.014)}px solid ${frameFillCss}` : undefined,
    boxSizing: 'border-box',
    ['--frame-bg' as any]: frameFill,
    ...(opts.notchColor ? { ['--notch-bg' as any]: opts.notchColor } : {}),
    ['--scale-factor' as any]: opts.scale || 1,
    overflow: 'visible',
  };

  // Absolutely positioned with px insets derived from the effective width so
  // the bezel is uniform on all sides at any aspect ratio (CSS % margins would
  // resolve top/bottom against the WIDTH and skew tall frames).
  const bezelPx = (percent: number) => (effectiveWidth * percent) / 100;
  const screen: React.CSSProperties = {
    position: 'absolute',
    top: `${bezelPx(chrome.paddingPercent.top)}px`,
    right: `${bezelPx(chrome.paddingPercent.right)}px`,
    bottom: `${bezelPx(chrome.paddingPercent.bottom)}px`,
    left: `${bezelPx(chrome.paddingPercent.left)}px`,
    backgroundColor: '#000',
    overflow: 'hidden',
    borderRadius: chrome.screenBorderRadius,
    zIndex: 1,
  };

  return { frame, screen, isOutline };
}
