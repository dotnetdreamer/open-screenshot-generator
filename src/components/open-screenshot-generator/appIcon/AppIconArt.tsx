"use client";

import React, { useId, useMemo } from 'react';
import type { ArtboardState } from '@/types/artboard';
import { StaticArtboard } from '../StaticArtboard';
import { hexToRgb, mix } from '@/lib/graphics/color';
import {
  ICON_SIZE,
  MAC_BODY_SHARE,
  PLAY_CORNER_SHARE,
  iconSettings,
  layerBoard,
  shapeMaskUrl,
  type AndroidMask,
} from '@/lib/appIcon/specs';

/**
 * The icon as one system shows it, live: the artboard itself drawn by
 * StaticArtboard (the renderer every preview and export shares), cut to the
 * system's shape, in the system's look. Nothing is rasterized, so it follows
 * the canvas as it changes.
 *
 * The dark, tinted and themed looks draw the front layer alone over a
 * background of the system's own, the way iOS and Android do: dark is the
 * front as designed (or white, when the icon asks for it), tinted and themed
 * colour the front by an SVG filter. SVG filters reached through CSS
 * `filter: url()` are what image tints already use on the canvas, so they hold
 * in the Mac app's WebKit too.
 */

export type IconShape = 'apple' | 'mac' | 'play' | 'square' | AndroidMask;
export type IconLook = 'light' | 'dark' | 'tinted' | 'themed-light' | 'themed-dark';

const APPLE_MASK = shapeMaskUrl(5);
const SQUIRCLE_MASK = shapeMaskUrl(4);

function maskStyle(url: string): React.CSSProperties {
  return {
    WebkitMaskImage: url,
    maskImage: url,
    WebkitMaskSize: '100% 100%',
    maskSize: '100% 100%',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
  };
}

function shapeStyle(shape: IconShape): React.CSSProperties {
  switch (shape) {
    case 'apple':
    case 'mac':
      return maskStyle(APPLE_MASK);
    case 'squircle':
      return maskStyle(SQUIRCLE_MASK);
    case 'circle':
      return { borderRadius: '50%' };
    case 'rounded':
      return { borderRadius: '18%' };
    case 'teardrop':
      return { borderRadius: '50% 50% 16% 50%' };
    case 'play':
      return { borderRadius: `${PLAY_CORNER_SHARE * 100}%` };
    case 'square':
      return {};
  }
}

/** iOS's dark icon background, as near as can be drawn; Apple publishes no values. */
export const IOS_DARK_BACKDROP = 'linear-gradient(180deg, #3A3A3C 0%, #1C1C1E 100%)';
/** Material You's themed icon colours, light and dark, for a blue wallpaper. */
const THEMED = {
  'themed-light': { tile: '#D3E3FD', glyph: '#0B1D51' },
  'themed-dark': { tile: '#26314A', glyph: '#C2D3FF' },
} as const;

/** A filter that paints every pixel one colour and keeps its alpha. */
function SolidFilter({ id, color }: { id: string; color: string }) {
  const rgb = hexToRgb(color) ?? { r: 255, g: 255, b: 255 };
  const c = (value: number) => (value / 255).toFixed(4);
  return (
    <filter id={id} colorInterpolationFilters="sRGB">
      <feColorMatrix type="matrix" values={`0 0 0 0 ${c(rgb.r)} 0 0 0 0 ${c(rgb.g)} 0 0 0 0 ${c(rgb.b)} 0 0 0 1 0`} />
    </filter>
  );
}

/** A filter that paints every pixel the tint, as bright as the pixel was light. */
function TintFilter({ id, color }: { id: string; color: string }) {
  const rgb = hexToRgb(color) ?? { r: 10, g: 132, b: 255 };
  const row = (value: number) => {
    const t = value / 255;
    return `${(0.2126 * t).toFixed(4)} ${(0.7152 * t).toFixed(4)} ${(0.0722 * t).toFixed(4)} 0 0`;
  };
  return (
    <filter id={id} colorInterpolationFilters="sRGB">
      <feColorMatrix type="matrix" values={`${row(rgb.r)} ${row(rgb.g)} ${row(rgb.b)} 0 0 0 1 0`} />
    </filter>
  );
}

export interface AppIconArtProps {
  /** The icon artboard, in the base language. */
  board: ArtboardState;
  /** On-screen size in CSS pixels. */
  size: number;
  shape: IconShape;
  look?: IconLook;
  /** The tint of iOS's tinted icons. */
  tint?: string;
  className?: string;
  /** Read by assistive tech; the icon is decoration unless named. */
  label?: string;
}

export function AppIconArt({ board, size, shape, look = 'light', tint = '#0A84FF', className, label }: AppIconArtProps) {
  const raw = useId();
  const filterId = `osg-icon-${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const settings = iconSettings(board);
  const front = useMemo(() => (look === 'light' ? null : layerBoard(board, 'front')), [board, look]);

  // A Mac icon is a smaller body with a shadow inside its square.
  const body = shape === 'mac' ? Math.round(size * MAC_BODY_SHARE) : size;
  const scale = body / Math.max(1, board.size.width || ICON_SIZE);

  let ground: string | undefined;
  let filter: React.ReactNode = null;
  let frontFilter: string | undefined;
  if (look === 'dark') {
    ground = IOS_DARK_BACKDROP;
    if (settings.dark === 'light') {
      filter = <SolidFilter id={filterId} color="#FFFFFF" />;
      frontFilter = `url(#${filterId})`;
    }
  } else if (look === 'tinted') {
    ground = `linear-gradient(180deg, ${mix(tint, '#000000', 0.72)} 0%, ${mix(tint, '#000000', 0.9)} 100%)`;
    filter = settings.dark === 'light' ? <SolidFilter id={filterId} color={tint} /> : <TintFilter id={filterId} color={tint} />;
    frontFilter = `url(#${filterId})`;
  } else if (look === 'themed-light' || look === 'themed-dark') {
    ground = THEMED[look].tile;
    filter = <SolidFilter id={filterId} color={THEMED[look].glyph} />;
    frontFilter = `url(#${filterId})`;
  }

  const art = (
    <div
      style={{
        width: body,
        height: body,
        overflow: 'hidden',
        position: 'relative',
        background: ground,
        ...shapeStyle(shape),
      }}
    >
      {front ? (
        <div style={{ filter: frontFilter, width: body, height: body }}>
          <StaticArtboard artboard={front} scale={scale} />
        </div>
      ) : (
        <StaticArtboard artboard={board} scale={scale} />
      )}
    </div>
  );

  return (
    <div
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...(shape === 'mac' ? { filter: `drop-shadow(0 ${size * 0.012}px ${size * 0.02}px rgba(0,0,0,0.32))` } : {}),
      }}
    >
      {filter && (
        <svg width="0" height="0" aria-hidden style={{ position: 'absolute', width: 0, height: 0 }}>
          <defs>{filter}</defs>
        </svg>
      )}
      {art}
    </div>
  );
}
