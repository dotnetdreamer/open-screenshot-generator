"use client";

import React from 'react';
import type { ArtboardState } from '@/types/artboard';
import { mix } from '@/lib/graphics/color';
import { REAL_SIZES, androidSafeCircle, layerBoard, type AndroidMask, type IconPlatform } from '@/lib/appIcon/specs';
import { StaticArtboard } from '../StaticArtboard';
import { AppIconArt, IOS_DARK_BACKDROP, type IconLook, type IconShape } from './AppIconArt';

/**
 * Where the icon is seen: a Home Screen, a launcher, a Mac's Dock, a store
 * listing, and the icon at the real sizes each system draws it.
 *
 * The other apps are blank tiles on purpose. A screen full of real app icons
 * would put other companies' marks in the user's mockup, and a made-up one
 * that looks like a real app is worse, so they are colour and shape only and
 * their names are bars.
 */

export type Wallpaper = 'aurora' | 'daylight' | 'midnight';

export const WALLPAPERS: { id: Wallpaper; label: string; css: string }[] = [
  { id: 'aurora', label: 'Aurora', css: 'linear-gradient(165deg, #1E2A78 0%, #6247AA 48%, #F29CB4 100%)' },
  { id: 'daylight', label: 'Daylight', css: 'linear-gradient(165deg, #CFE8FF 0%, #F6D7F5 55%, #FFE6C7 100%)' },
  { id: 'midnight', label: 'Midnight', css: 'linear-gradient(165deg, #070B19 0%, #18213D 55%, #2B2550 100%)' },
];

const TILE_HUES = ['#60A5FA', '#34D399', '#F87171', '#FBBF24', '#A78BFA', '#F472B6', '#38BDF8', '#2DD4BF', '#FB923C', '#818CF8'];

/** Another app: a coloured tile and a simple shape, in the look the system gives every icon. */
function PlaceholderIcon({ index, size, shape, look, tint = '#0A84FF' }: { index: number; size: number; shape: IconShape; look: IconLook; tint?: string }) {
  const hue = TILE_HUES[index % TILE_HUES.length];
  const radius =
    shape === 'circle' ? '50%' : shape === 'rounded' ? '18%' : shape === 'teardrop' ? '50% 50% 16% 50%' : shape === 'play' ? '20%' : '23%';
  let ground = `linear-gradient(160deg, ${mix(hue, '#FFFFFF', 0.25)} 0%, ${mix(hue, '#000000', 0.12)} 100%)`;
  let glyph = 'rgba(255,255,255,0.88)';
  if (look === 'dark') {
    ground = IOS_DARK_BACKDROP;
    glyph = hue;
  } else if (look === 'tinted') {
    ground = `linear-gradient(180deg, ${mix(tint, '#000000', 0.72)} 0%, ${mix(tint, '#000000', 0.9)} 100%)`;
    glyph = mix(tint, '#FFFFFF', 0.1);
  } else if (look === 'themed-light') {
    ground = '#D3E3FD';
    glyph = '#0B1D51';
  } else if (look === 'themed-dark') {
    ground = '#26314A';
    glyph = '#C2D3FF';
  }
  const variant = index % 3;
  return (
    <div aria-hidden style={{ width: size, height: size, borderRadius: radius, background: ground, position: 'relative', flexShrink: 0 }}>
      {variant === 0 && (
        <span style={{ position: 'absolute', inset: '31%', borderRadius: '50%', background: glyph }} />
      )}
      {variant === 1 && (
        <span style={{ position: 'absolute', inset: '30%', borderRadius: '28%', border: `${Math.max(1.5, size * 0.07)}px solid ${glyph}` }} />
      )}
      {variant === 2 && (
        <>
          <span style={{ position: 'absolute', left: '28%', right: '28%', top: '36%', height: '9%', borderRadius: 99, background: glyph }} />
          <span style={{ position: 'absolute', left: '28%', right: '42%', top: '55%', height: '9%', borderRadius: 99, background: glyph }} />
        </>
      )}
    </div>
  );
}

function NameBar({ width, dark }: { width: number; dark: boolean }) {
  return <span aria-hidden style={{ display: 'block', width, height: 4, borderRadius: 99, background: dark ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.75)', margin: '5px auto 0' }} />;
}

function NameLabel({ name, width, color = '#FFFFFF', size = 10.5 }: { name: string; width: number; color?: string; size?: number }) {
  return (
    <span
      className="block truncate text-center"
      style={{ width, marginTop: 4, fontSize: size, lineHeight: 1.2, fontWeight: 500, color, textShadow: color === '#FFFFFF' ? '0 1px 2px rgba(0,0,0,0.35)' : undefined }}
    >
      {name}
    </span>
  );
}

function StatusBar({ color, width }: { color: string; width: number }) {
  const unit = width / 330;
  return (
    <div className="flex items-center justify-between" style={{ height: 22 * unit, padding: `0 ${26 * unit}px`, color, fontSize: 12.5 * unit, fontWeight: 600 }}>
      <span>9:41</span>
      <span className="flex items-center" style={{ gap: 4 * unit }} aria-hidden>
        <span style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5 * unit, height: 9 * unit }}>
          {[4, 6, 8, 10].map((h) => (
            <span key={h} style={{ width: 2.5 * unit, height: h * unit * 0.9, borderRadius: 1, background: color }} />
          ))}
        </span>
        <span style={{ width: 20 * unit, height: 9.5 * unit, borderRadius: 3 * unit, border: `${1.2 * unit}px solid ${color}`, padding: 1 * unit, display: 'flex' }}>
          <span style={{ flex: 1, borderRadius: 1.5 * unit, background: color }} />
        </span>
      </span>
    </div>
  );
}

const ROWS = 4;
const COLUMNS = 4;

/** An iPhone Home Screen with the icon in its second row, and in the Dock. */
export function IphoneHome({
  board,
  appName,
  look,
  tint,
  wallpaper,
  width = 300,
}: {
  board: ArtboardState;
  appName: string;
  look: 'light' | 'dark' | 'tinted';
  tint: string;
  wallpaper: Wallpaper;
  width?: number;
}) {
  const height = Math.round(width * 2.17);
  // A 60 pt icon on a 402 pt wide screen.
  const icon = Math.round(width * 0.149);
  const side = width * 0.075;
  const pitch = (width - side * 2) / COLUMNS;
  const art = WALLPAPERS.find((entry) => entry.id === wallpaper)?.css ?? WALLPAPERS[0].css;
  const dimmed = look === 'dark' || look === 'tinted';
  const mine = { row: 1, column: 1 };
  let index = 0;
  return (
    <div
      role="img"
      aria-label={`${appName} on an iPhone Home Screen, ${look === 'light' ? 'light' : look} icons`}
      className="relative overflow-hidden"
      style={{
        width,
        height,
        borderRadius: width * 0.155,
        background: art,
        boxShadow: '0 0 0 7px #0B0B0D, 0 0 0 8px #3A3A3F, 0 28px 60px -24px rgba(0,0,0,0.55)',
      }}
    >
      {dimmed && <div aria-hidden className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.38)' }} />}
      <div className="relative" style={{ paddingTop: width * 0.04 }}>
        <span aria-hidden className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black" style={{ top: width * 0.03, width: width * 0.3, height: width * 0.085 }} />
        <StatusBar color="#FFFFFF" width={width} />
        <div style={{ padding: `${width * 0.09}px ${side}px 0`, display: 'grid', gridTemplateColumns: `repeat(${COLUMNS}, ${pitch}px)`, rowGap: width * 0.075 }}>
          {Array.from({ length: ROWS * COLUMNS }).map((_, slot) => {
            const row = Math.floor(slot / COLUMNS);
            const column = slot % COLUMNS;
            const isMine = row === mine.row && column === mine.column;
            const tileIndex = isMine ? -1 : index++;
            return (
              <div key={slot} className="flex flex-col items-center">
                {isMine ? (
                  <AppIconArt board={board} size={icon} shape="apple" look={look} tint={tint} label={`${appName} icon`} />
                ) : (
                  <PlaceholderIcon index={tileIndex} size={icon} shape="apple" look={look} tint={tint} />
                )}
                {isMine ? <NameLabel name={appName} width={pitch} size={width * 0.034} /> : <NameBar width={icon * 0.62} dark={dimmed} />}
              </div>
            );
          })}
        </div>
      </div>
      <div
        aria-hidden
        className="absolute flex items-center justify-around"
        style={{
          left: width * 0.045,
          right: width * 0.045,
          bottom: width * 0.045,
          height: icon * 1.58,
          borderRadius: width * 0.1,
          background: dimmed ? 'rgba(40,40,44,0.55)' : 'rgba(255,255,255,0.28)',
          padding: `0 ${side * 0.6}px`,
        }}
      >
        {[11, 12, 13].map((i) => (
          <PlaceholderIcon key={i} index={i} size={icon} shape="apple" look={look} tint={tint} />
        ))}
        <AppIconArt board={board} size={icon} shape="apple" look={look} tint={tint} />
      </div>
    </div>
  );
}

/** A Pixel-style home screen: the icon under Android's mask, plain or themed. */
export function AndroidHome({
  board,
  appName,
  look,
  mask,
  wallpaper,
  width = 300,
}: {
  board: ArtboardState;
  appName: string;
  look: 'light' | 'dark' | 'themed';
  mask: AndroidMask;
  wallpaper: Wallpaper;
  width?: number;
}) {
  const height = Math.round(width * 2.1);
  // A 48 dp icon on a 412 dp wide screen.
  const icon = Math.round(width * 0.135);
  const side = width * 0.06;
  const pitch = (width - side * 2) / COLUMNS;
  const art = WALLPAPERS.find((entry) => entry.id === wallpaper)?.css ?? WALLPAPERS[0].css;
  const dark = look === 'dark' || wallpaper === 'midnight';
  const iconLook: IconLook = look === 'themed' ? (dark ? 'themed-dark' : 'themed-light') : 'light';
  const shade = look === 'dark' ? 'rgba(0,0,0,0.42)' : null;
  return (
    <div
      role="img"
      aria-label={`${appName} on an Android home screen, ${mask} icons${look === 'themed' ? ', themed' : ''}`}
      className="relative overflow-hidden"
      style={{ width, height, borderRadius: width * 0.1, background: art, boxShadow: '0 0 0 7px #111214, 0 0 0 8px #34363B, 0 28px 60px -24px rgba(0,0,0,0.55)' }}
    >
      {shade && <div aria-hidden className="absolute inset-0" style={{ background: shade }} />}
      <div className="relative" style={{ paddingTop: width * 0.025 }}>
        <span aria-hidden className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black" style={{ top: width * 0.025, width: width * 0.04, height: width * 0.04 }} />
        <StatusBar color="#FFFFFF" width={width} />
        <div aria-hidden style={{ padding: `${width * 0.08}px ${side + width * 0.03}px 0` }}>
          <span className="block" style={{ width: width * 0.42, height: width * 0.03, borderRadius: 99, background: 'rgba(255,255,255,0.8)' }} />
          <span className="mt-2 block" style={{ width: width * 0.26, height: width * 0.022, borderRadius: 99, background: 'rgba(255,255,255,0.55)' }} />
        </div>
      </div>
      <div className="absolute" style={{ left: side, right: side, bottom: width * 0.43, display: 'grid', gridTemplateColumns: `repeat(${COLUMNS}, ${pitch}px)`, rowGap: width * 0.07 }}>
        {Array.from({ length: COLUMNS * 2 }).map((_, slot) => (
          <div key={slot} className="flex flex-col items-center">
            {slot === 4 ? (
              <AppIconArt board={board} size={icon} shape={mask} look={iconLook} label={`${appName} icon`} />
            ) : (
              <PlaceholderIcon index={slot + 3} size={icon} shape={mask} look={iconLook} />
            )}
            {slot === 4 ? <NameLabel name={appName} width={pitch} size={width * 0.034} /> : <NameBar width={icon * 0.7} dark={dark} />}
          </div>
        ))}
      </div>
      <div className="absolute flex items-center justify-around" style={{ left: side, right: side, bottom: width * 0.235 }}>
        {[20, 21, 22].map((i) => (
          <PlaceholderIcon key={i} index={i} size={icon} shape={mask} look={iconLook} />
        ))}
        <AppIconArt board={board} size={icon} shape={mask} look={iconLook} />
      </div>
      <div
        aria-hidden
        className="absolute flex items-center"
        style={{ left: side, right: side, bottom: width * 0.06, height: width * 0.12, borderRadius: 99, background: 'rgba(255,255,255,0.85)', padding: `0 ${width * 0.04}px`, gap: width * 0.03 }}
      >
        <span style={{ width: width * 0.05, height: width * 0.05, borderRadius: '50%', background: '#94A3B8' }} />
        <span style={{ flex: 1, height: width * 0.022, borderRadius: 99, background: '#CBD5E1' }} />
      </div>
    </div>
  );
}

/**
 * The two layers apart, as Android moves them: the front drifts over the back
 * the way a launcher nudges it, inside the mask, with the safe circle drawn on
 * when asked. The drift stops for anyone who asked for less motion.
 */
export function AndroidLayers({ board, mask, size = 132, showSafe }: { board: ArtboardState; mask: AndroidMask; size?: number; showSafe: boolean }) {
  const back = layerBoard(board, 'back');
  const front = layerBoard(board, 'front');
  const scale = size / Math.max(1, board.size.width);
  const radius = mask === 'circle' ? '50%' : mask === 'rounded' ? '18%' : mask === 'teardrop' ? '50% 50% 16% 50%' : '30%';
  const safe = androidSafeCircle({ width: size, height: size });
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: radius }}>
        <StaticArtboard artboard={back} scale={scale} />
        <div className="osg-icon-drift absolute inset-0">
          <StaticArtboard artboard={front} scale={scale} />
        </div>
      </div>
      {showSafe && (
        <svg aria-hidden className="pointer-events-none absolute inset-0" width={size} height={size}>
          <circle cx={safe.cx} cy={safe.cy} r={safe.r} fill="none" stroke="#34D399" strokeWidth={1.5} strokeDasharray="4 3" />
        </svg>
      )}
    </div>
  );
}

/** A Mac desktop with the icon on it and in the Dock. */
export function MacDesktop({ board, appName, dark, width = 520 }: { board: ArtboardState; appName: string; dark: boolean; width?: number }) {
  const height = Math.round(width * 0.62);
  const wallpaper = dark
    ? 'linear-gradient(160deg, #0B1026 0%, #23214A 50%, #3B2D5C 100%)'
    : 'linear-gradient(160deg, #9EC5FF 0%, #C8B6FF 50%, #FFD5C2 100%)';
  const dockIcon = Math.round(width * 0.085);
  return (
    <div
      role="img"
      aria-label={`${appName} on a Mac desktop and in the Dock`}
      className="relative overflow-hidden rounded-xl"
      style={{ width, height, background: wallpaper, boxShadow: '0 24px 50px -24px rgba(0,0,0,0.5)' }}
    >
      <div aria-hidden className="flex items-center gap-3 px-3" style={{ height: 22, background: dark ? 'rgba(20,20,28,0.55)' : 'rgba(255,255,255,0.55)' }}>
        {[22, 34, 28, 40].map((w, i) => (
          <span key={i} style={{ width: w, height: 5, borderRadius: 99, background: dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)' }} />
        ))}
      </div>
      <div className="absolute flex flex-col items-center" style={{ top: height * 0.17, right: width * 0.07 }}>
        <AppIconArt board={board} size={Math.round(width * 0.17)} shape="mac" label={`${appName} icon on the desktop`} />
        <span className="mt-1 max-w-[120px] truncate rounded px-1.5 text-center text-[11px] font-medium text-white" style={{ background: 'rgba(0,0,0,0.25)' }}>
          {appName}
        </span>
      </div>
      <div
        aria-hidden
        className="absolute left-1/2 flex -translate-x-1/2 items-end"
        style={{
          bottom: 8,
          gap: dockIcon * 0.16,
          padding: `${dockIcon * 0.14}px ${dockIcon * 0.2}px`,
          borderRadius: dockIcon * 0.36,
          background: dark ? 'rgba(40,40,52,0.55)' : 'rgba(255,255,255,0.4)',
          border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.5)'}`,
        }}
      >
        {[30, 31, 32, 33, 34].map((i) => (
          <div key={i} className="flex flex-col items-center">
            <div style={{ padding: dockIcon * 0.1 }}>
              <PlaceholderIcon index={i} size={Math.round(dockIcon * 0.8)} shape="apple" look="light" />
            </div>
          </div>
        ))}
        <div className="flex flex-col items-center">
          <AppIconArt board={board} size={dockIcon} shape="mac" />
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: dark ? '#FFFFFF' : '#1F2937', marginTop: 1 }} />
        </div>
      </div>
    </div>
  );
}

/** The App Store's and Google Play's listing rows, where people decide to tap. */
export function StoreCards({ board, appName, dark }: { board: ArtboardState; appName: string; dark: boolean }) {
  const card = dark ? '#1C1C1E' : '#FFFFFF';
  const text = dark ? '#F5F5F7' : '#111827';
  const bar = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.1)';
  return (
    <div className="grid w-full max-w-[560px] gap-3 sm:grid-cols-2">
      <div className="rounded-2xl p-4 shadow-sm" style={{ background: card, border: `1px solid ${bar}` }}>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: dark ? '#9CA3AF' : '#6B7280' }}>
          App Store
        </p>
        <div className="flex items-center gap-3">
          <AppIconArt board={board} size={64} shape="apple" label={`${appName} icon in the App Store`} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold" style={{ color: text }}>
              {appName}
            </p>
            <span aria-hidden className="mt-1.5 block h-2 w-24 rounded-full" style={{ background: bar }} />
          </div>
          <span aria-hidden className="rounded-full px-4 py-1 text-[13px] font-bold" style={{ background: dark ? '#2C2C2E' : '#EEF2F7', color: '#0A84FF' }}>
            Get
          </span>
        </div>
      </div>
      <div className="rounded-2xl p-4 shadow-sm" style={{ background: dark ? '#131314' : '#FFFFFF', border: `1px solid ${bar}` }}>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: dark ? '#9CA3AF' : '#6B7280' }}>
          Google Play
        </p>
        <div className="flex items-center gap-3">
          <AppIconArt board={board} size={64} shape="play" label={`${appName} icon on Google Play`} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium" style={{ color: text }}>
              {appName}
            </p>
            <span aria-hidden className="mt-1.5 block h-2 w-20 rounded-full" style={{ background: bar }} />
          </div>
          <span aria-hidden className="rounded-full px-4 py-1 text-[13px] font-semibold" style={{ background: '#0B57D0', color: '#FFFFFF' }}>
            Install
          </span>
        </div>
      </div>
    </div>
  );
}

/** The icon at each size its system draws it, in points, at one point per CSS pixel. */
export function RealSizes({
  board,
  platform,
  look,
  tint,
  mask,
  dark,
  layout = 'row',
}: {
  board: ArtboardState;
  platform: IconPlatform;
  look: IconLook;
  tint: string;
  mask: AndroidMask;
  dark: boolean;
  /** A row under a wide scene, or a list beside a phone. */
  layout?: 'row' | 'list';
}) {
  const shape: IconShape = platform === 'ios' ? 'apple' : platform === 'mac' ? 'mac' : mask;
  const ink = dark ? '#E4E4E7' : '#18181B';
  const soft = dark ? '#A1A1AA' : '#52525B';
  const sizes = REAL_SIZES[platform];
  if (layout === 'list') {
    const cell = Math.max(...sizes.map((entry) => entry.points));
    return (
      <ul className="space-y-2.5 rounded-xl px-4 py-3" style={{ background: dark ? '#0B0B0F' : '#F3F4F6' }} data-testid="app-icon-real-sizes">
        {sizes.map((entry) => (
          <li key={entry.label} className="flex items-center gap-3">
            <span className="flex shrink-0 items-center justify-center" style={{ width: cell, height: entry.points }}>
              <AppIconArt board={board} size={entry.points} shape={shape} look={look} tint={tint} />
            </span>
            <span className="text-[11px] leading-tight" style={{ color: soft }}>
              <span className="block font-medium" style={{ color: ink }}>
                {entry.label}
              </span>
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div
      className="flex flex-wrap items-end justify-center gap-x-6 gap-y-3 rounded-xl px-5 py-4"
      style={{ background: dark ? '#0B0B0F' : '#F3F4F6' }}
      data-testid="app-icon-real-sizes"
    >
      {sizes.map((entry) => (
        <figure key={entry.label} className="flex flex-col items-center gap-1.5">
          <AppIconArt board={board} size={entry.points} shape={shape} look={look} tint={tint} />
          <figcaption className="text-center text-[11px] leading-tight" style={{ color: soft }}>
            <span className="block font-medium" style={{ color: ink }}>
              {entry.label}
            </span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
