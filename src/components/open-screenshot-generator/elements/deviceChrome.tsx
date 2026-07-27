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
  /**
   * Non-slab devices (MacBook lid + base, iMac slab + stand): the body is
   * drawn by these absolutely-positioned nodes instead of the frame div's own
   * background, which goes fully transparent (see getFlatFrameStyles). Nodes
   * read var(--frame-bg) so the recolour presets still tint the display shell.
   */
  chassis?: React.ReactNode;
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
 * MacBook chassis: dark display lid (wide top block) over the classic wider
 * aluminum base bar with a centred thumb scoop. All lengths are % of the
 * effective width, matching the macbook screen paddings in the device
 * registry (lid side = 8, lid bezel = 2, lid bottom = base 3.4 + bezel 2.5).
 */
function macbookChassis(px: (percent: number) => number): React.ReactNode {
  const baseH = px(3.4);
  return (
    <>
      <div
        data-device-chassis="lid"
        style={{
          position: 'absolute',
          left: px(8),
          right: px(8),
          top: 0,
          bottom: baseH,
          backgroundColor: 'var(--frame-bg, #1a1a1e)',
          borderRadius: `${px(1.8)}px ${px(1.8)}px ${px(0.4)}px ${px(0.4)}px`,
        }}
      />
      <div
        data-device-chassis="base"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: baseH,
          background: 'linear-gradient(180deg, #eceded 0%, #c6c7cc 55%, #8f9096 100%)',
          borderRadius: `${px(0.4)}px ${px(0.4)}px ${px(1.7)}px ${px(1.7)}px`,
        }}
      />
      <div
        data-device-chassis="scoop"
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: baseH - px(1.15),
          width: px(12),
          height: px(1.15),
          background: 'linear-gradient(180deg, #94959b, #b9bac0)',
          borderRadius: `0 0 ${px(1.15)}px ${px(1.15)}px`,
        }}
      />
    </>
  );
}

/**
 * iMac chassis: silver display slab (its own background shows through as the
 * chin below the screen) on a tapered leg + flat foot. Lengths are % of the
 * effective width, matching the imac registry paddings (bottom 18.1 = stand
 * 10.6 + chin 7.5).
 */
function imacChassis(px: (percent: number) => number): React.ReactNode {
  const standH = px(10.6);
  return (
    <>
      <div
        data-device-chassis="slab"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: standH,
          backgroundColor: 'var(--frame-bg, #e3e3e8)',
          borderRadius: `${px(1.2)}px`,
          boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        }}
      />
      <div
        data-device-chassis="leg"
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: px(1.2),
          width: px(12),
          height: standH - px(1.2),
          background: 'linear-gradient(180deg, #c9cacf, #a9aab0)',
          clipPath: 'polygon(6% 0, 94% 0, 100% 100%, 0 100%)',
        }}
      />
      <div
        data-device-chassis="foot"
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: 0,
          width: px(26),
          height: px(1.2),
          background: 'linear-gradient(180deg, #d4d5da, #97989e)',
          borderRadius: `${px(0.6)}px`,
        }}
      />
    </>
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
    case 'macbook': {
      const px = (percent: number) => (effectiveWidth * percent) / 100;
      chrome.bodyColor = '#1a1a1e';
      chrome.chassis = macbookChassis(px);
      // Camera-housing notch glued to the screen's top edge. Measured off the
      // real MacBook Pro: ~11% of the screen width, ~3.5:1, squared top and a
      // bottom corner radius of about a third of its height — NOT a pill.
      chrome.notch = classicNotch('11%', '3.5 / 1', '9%', '32%', chrome.bodyColor);
      break;
    }
    case 'imac': {
      const px = (percent: number) => (effectiveWidth * percent) / 100;
      chrome.bodyColor = '#e3e3e8';
      chrome.chassis = imacChassis(px);
      break;
    }
    case 'apple-watch':
    case 'custom':
      break;
  }
  return chrome;
}

/**
 * The chassis nodes for rendering inside the frame div, honouring the
 * transparent-device preset: frameOpacity fades the WHOLE body (lid + base /
 * slab + stand). The wrapper div is static, so the absolutely-positioned
 * chassis nodes still anchor to the frame div.
 */
export function renderChassis(chrome: FlatDeviceChrome, frameOpacity?: number): React.ReactNode {
  if (!chrome.chassis) return null;
  const alpha = frameOpacity ?? 1;
  if (alpha >= 1) return chrome.chassis;
  return <div data-device-chassis-root="true" style={{ opacity: alpha }}>{chrome.chassis}</div>;
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
  // Chassis devices draw their body via chrome.chassis nodes; the frame div
  // itself must stay invisible or it would paint a slab behind the silhouette.
  // The outline preset has no chassis equivalent (a hollow laptop reads as
  // nothing), so it is ignored there — otherwise its only visible effect
  // would be the shadow suppression below, an incoherent half-applied state.
  // Opacity DOES apply: the components wrap chrome.chassis in an
  // opacity-carrying div (see renderChassis) so the whole body fades.
  const hasChassis = !!chrome.chassis;
  const isOutline = !hasChassis && opts.frameStyle === 'outline';
  const frameFillCss =
    frameAlpha >= 1
      ? frameFill
      : `color-mix(in srgb, ${frameFill} ${Math.round(frameAlpha * 100)}%, transparent)`;

  const frame: React.CSSProperties = {
    width: '100%',
    height: '100%',
    // A drop shadow behind a see-through or hollow frame reads as a dark slab
    boxShadow: hasChassis || isOutline || frameAlpha < 1 ? 'none' : '0 4px 12px rgba(0,0,0,0.3)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    borderRadius: hasChassis ? 0 : chrome.outerBorderRadius,
    backgroundColor: hasChassis || isOutline ? 'transparent' : frameFillCss,
    border: !hasChassis && isOutline ? `${Math.max(2, effectiveWidth * 0.014)}px solid ${frameFillCss}` : undefined,
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
