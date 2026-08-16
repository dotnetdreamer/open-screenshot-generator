"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { StaticArtboard, getArtboardBackgroundStyle, count3dDevices } from './StaticArtboard';
import { artboardBackground } from '@/lib/artboardBackground';
import { detectArtboardsFormat } from '@/lib/deviceRegistry';
import type { ArtboardState } from '@/types/artboard';

/**
 * The screenshots inside a mock store listing, at phone point size.
 *
 * The point is scale, not decoration. A board is designed at 1290×2796 on a
 * desktop canvas and looks great there; in the actual App Store carousel it is
 * about 224pt wide, and in a search result about 105pt, which is where a
 * 40px headline stops being readable. This surface is the only place in the
 * app that shows that, so the layout numbers below are the load-bearing part
 * and the chrome around them is just enough context to make the size read
 * honestly.
 *
 * Everything except the screenshots is a placeholder: the ratings, counts and
 * chart position are fixed sample values, not data about anyone's app.
 */

export type StoreKind = 'appstore' | 'play';
type StoreSurface = 'product' | 'search';
type ThemeKind = 'light' | 'dark';

// The phone the listing is drawn on. Sizes are logical points/dp, which is the
// unit the store lays its listing out in.
const PHONES: Record<StoreKind, { label: string; width: number; height: number; radius: number }> = {
  appstore: { label: 'iPhone 16 Pro', width: 393, height: 852, radius: 54 },
  play: { label: 'Pixel 9', width: 412, height: 915, radius: 44 },
};

const BEZEL = 11;

interface StoreTheme {
  page: string;
  text: string;
  subtext: string;
  hairline: string;
  chip: string;
  /** The buy/install button fill. */
  accent: string;
  accentText: string;
  /** Tappable text (developer name, icons). */
  link: string;
  skeleton: string;
  shotBorder: string;
  statusIcon: string;
}

const THEMES: Record<StoreKind, Record<ThemeKind, StoreTheme>> = {
  appstore: {
    light: {
      page: '#ffffff',
      text: '#000000',
      subtext: 'rgba(60,60,67,0.6)',
      hairline: 'rgba(60,60,67,0.18)',
      chip: '#e9e9eb',
      accent: '#e9e9eb',
      accentText: '#007aff',
      link: '#007aff',
      skeleton: 'rgba(60,60,67,0.12)',
      shotBorder: 'rgba(0,0,0,0.12)',
      statusIcon: '#000000',
    },
    dark: {
      page: '#000000',
      text: '#ffffff',
      subtext: 'rgba(235,235,245,0.6)',
      hairline: 'rgba(235,235,245,0.2)',
      chip: '#2c2c2e',
      accent: '#2c2c2e',
      accentText: '#0a84ff',
      link: '#0a84ff',
      skeleton: 'rgba(235,235,245,0.14)',
      shotBorder: 'rgba(255,255,255,0.16)',
      statusIcon: '#ffffff',
    },
  },
  play: {
    light: {
      page: '#ffffff',
      text: '#1f1f1f',
      subtext: '#5f6368',
      hairline: 'rgba(31,31,31,0.14)',
      chip: '#f1f3f4',
      accent: '#01875f',
      accentText: '#ffffff',
      link: '#01875f',
      skeleton: 'rgba(31,31,31,0.1)',
      shotBorder: 'rgba(0,0,0,0.12)',
      statusIcon: '#1f1f1f',
    },
    dark: {
      page: '#131314',
      text: '#e3e3e3',
      subtext: '#a8abaf',
      hairline: 'rgba(227,227,227,0.16)',
      chip: '#1f2023',
      accent: '#a8c7fa',
      accentText: '#062e6f',
      link: '#a8c7fa',
      skeleton: 'rgba(227,227,227,0.12)',
      shotBorder: 'rgba(255,255,255,0.14)',
      statusIcon: '#e3e3e3',
    },
  },
};

const FONTS: Record<StoreKind, string> = {
  appstore: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  play: 'Roboto, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
};

// --- screenshot sizing -------------------------------------------------------

const APPSTORE_PAD = 20;
const PLAY_PAD = 16;
const SHOT_GAP = 8;
// Play scales a listing's screenshots to a fixed row height, so a taller
// aspect ends up narrower. That is the whole reason Play shots read smaller.
const PLAY_ROW_HEIGHT = 240;

/**
 * How wide one screenshot actually is in each context, in points.
 *
 * App Store: the product-page carousel gives a portrait shot a little over half
 * the screen (you always see the edge of the next one), and lets a landscape
 * shot run the full content width. Search results pack three across.
 *
 * Play: the row is height-driven, so a taller aspect comes out narrower — which
 * is exactly why 9:19.5 art reads smaller on Play than the same art on iOS.
 */
function shotBox(
  store: StoreKind,
  surface: StoreSurface,
  viewportWidth: number,
  board: ArtboardState
): { width: number; height: number } {
  const aspect = board.size.width / board.size.height;
  const portrait = aspect < 0.95;

  if (store === 'appstore') {
    const content = viewportWidth - APPSTORE_PAD * 2;
    const width =
      surface === 'search'
        ? (content - SHOT_GAP * 2) / 3
        : portrait
          ? Math.round(viewportWidth * 0.57)
          : content;
    return { width, height: width / aspect };
  }

  const content = viewportWidth - PLAY_PAD * 2;
  if (surface === 'search') {
    const width = (content - SHOT_GAP * 2) / 3;
    return { width, height: width / aspect };
  }
  // Fixed row height, width follows the aspect, capped so a wide shot still
  // leaves the next one peeking.
  const height = PLAY_ROW_HEIGHT;
  const width = height * aspect;
  if (width > content) return { width: content, height: content / aspect };
  return { width, height };
}

// --- shared bits -------------------------------------------------------------

/** A board drawn at store size, or its flat background while it waits its turn. */
function Shot({
  board,
  width,
  height,
  radius,
  theme,
  live,
  index,
  observer,
}: {
  board: ArtboardState;
  width: number;
  height: number;
  radius: number;
  theme: StoreTheme;
  live: boolean;
  index: number;
  observer: IntersectionObserver | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!observer || !node) return;
    observer.observe(node);
    return () => observer.unobserve(node);
  }, [observer]);

  return (
    <div
      ref={ref}
      data-shot-index={index}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        borderRadius: `${radius}px`,
        overflow: 'hidden',
        flexShrink: 0,
        boxShadow: `inset 0 0 0 1px ${theme.shotBorder}`,
        scrollSnapAlign: 'start',
      }}
    >
      {live ? (
        <StaticArtboard artboard={board} scale={width / board.size.width} />
      ) : (
        <div className="h-full w-full" style={getArtboardBackgroundStyle(board)} />
      )}
    </div>
  );
}

/** Grey bars standing in for the body copy below the fold. */
function SkeletonLines({ theme, widths }: { theme: StoreTheme; widths: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      {widths.map((w, i) => (
        <div
          key={i}
          style={{ width: w, height: '9px', borderRadius: '4px', background: theme.skeleton }}
        />
      ))}
    </div>
  );
}

/**
 * The results that would sit under the user's own. They are deliberately blank:
 * the page has to keep going past the fold to read as a real listing, but
 * nothing here should look like data about a real app.
 */
function SkeletonResults({
  theme,
  count,
  iconSize,
  radius,
  padding,
}: {
  theme: StoreTheme;
  count: number;
  iconSize: number;
  radius: number;
  padding: number;
}) {
  return (
    <div className="flex flex-col gap-5" style={{ padding: `22px ${padding}px 0` }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3" style={{ opacity: 0.75 - i * 0.18 }}>
          <div
            style={{
              width: iconSize,
              height: iconSize,
              borderRadius: radius,
              background: theme.skeleton,
              flexShrink: 0,
            }}
          />
          <div className="flex flex-1 flex-col gap-2">
            <div style={{ width: `${52 - i * 8}%`, height: 10, borderRadius: 5, background: theme.skeleton }} />
            <div style={{ width: `${34 - i * 6}%`, height: 9, borderRadius: 5, background: theme.skeleton }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function AppIcon({
  size,
  radius,
  initials,
  background,
  foreground,
}: {
  size: number;
  radius: number;
  initials: string;
  background: React.CSSProperties;
  foreground: string;
}) {
  return (
    <div
      className="flex flex-shrink-0 items-center justify-center"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${radius}px`,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
        ...background,
      }}
    >
      <span
        style={{
          fontSize: `${Math.round(size * 0.42)}px`,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: foreground,
        }}
      >
        {initials}
      </span>
    </div>
  );
}

function StatusBar({ store, theme }: { store: StoreKind; theme: StoreTheme }) {
  const color = theme.statusIcon;
  return (
    <div
      className="flex flex-shrink-0 items-center justify-between"
      style={{ height: store === 'appstore' ? 54 : 34, padding: '0 26px', color }}
    >
      <span style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '0.01em' }}>
        {store === 'appstore' ? '9:41' : '12:30'}
      </span>
      <div className="flex items-center gap-1.5">
        {/* signal */}
        <svg width="17" height="11" viewBox="0 0 17 11" fill={color} aria-hidden="true">
          <rect x="0" y="7.5" width="3" height="3.5" rx="1" />
          <rect x="4.6" y="5.5" width="3" height="5.5" rx="1" />
          <rect x="9.2" y="3" width="3" height="8" rx="1" />
          <rect x="13.8" y="0.5" width="3" height="10.5" rx="1" />
        </svg>
        {/* wifi */}
        <svg width="16" height="11" viewBox="0 0 16 11" fill={color} aria-hidden="true">
          <path d="M8 10.6 5.6 7.9a3.6 3.6 0 0 1 4.8 0L8 10.6Z" />
          <path
            d="M3.4 5.6a6.8 6.8 0 0 1 9.2 0"
            stroke={color}
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M1 3a10.2 10.2 0 0 1 14 0"
            stroke={color}
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
        {/* battery */}
        <svg width="25" height="12" viewBox="0 0 25 12" aria-hidden="true">
          <rect
            x="0.5"
            y="0.5"
            width="21"
            height="11"
            rx="3.2"
            fill="none"
            stroke={color}
            strokeOpacity="0.4"
          />
          <rect x="2" y="2" width="15" height="8" rx="2" fill={color} />
          <path d="M23 4.2v3.6a2 2 0 0 0 0-3.6Z" fill={color} fillOpacity="0.5" />
        </svg>
      </div>
    </div>
  );
}

// --- App Store ---------------------------------------------------------------

function AppStoreProduct({
  artboards,
  appName,
  developerName,
  theme,
  icon,
  liveIndexes,
  observer,
  width,
}: SurfaceProps) {
  return (
    <>
      <div style={{ padding: `4px ${APPSTORE_PAD}px 0` }}>
        <div className="flex gap-4">
          <AppIcon
            size={118}
            radius={26}
            initials={icon.initials}
            background={icon.background}
            foreground={icon.foreground}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              style={{
                fontSize: '22px',
                lineHeight: '26px',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: theme.text,
              }}
            >
              {appName}
            </span>
            <span style={{ fontSize: '15px', lineHeight: '20px', color: theme.subtext }}>
              {developerName}
            </span>
            <div className="mt-auto flex items-end justify-between">
              <div className="flex flex-col gap-1">
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: '74px',
                    height: '30px',
                    borderRadius: '15px',
                    background: theme.accent,
                  }}
                >
                  <span
                    style={{ fontSize: '17px', fontWeight: 700, color: theme.accentText }}
                  >
                    GET
                  </span>
                </div>
                <span style={{ fontSize: '10px', color: theme.subtext }}>In-App Purchases</span>
              </div>
              <svg width="18" height="22" viewBox="0 0 18 22" fill="none" aria-hidden="true">
                <path
                  d="M9 1v13M9 1 4.5 5.5M9 1l4.5 4.5M1 12v7.5A1.5 1.5 0 0 0 2.5 21h13a1.5 1.5 0 0 0 1.5-1.5V12"
                  stroke={theme.link}
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>

        {/* Ratings / age / chart strip */}
        <div
          className="mt-5 flex items-stretch"
          style={{ borderTop: `1px solid ${theme.hairline}`, paddingTop: '12px' }}
        >
          {[
            { label: '1.2K RATINGS', value: '4.8', sub: '★★★★★' },
            { label: 'AGE', value: '4+', sub: 'Years Old' },
            { label: 'CHART', value: '#12', sub: 'Productivity' },
          ].map((cell, i) => (
            <div
              key={cell.label}
              className="flex flex-1 flex-col items-center justify-center gap-0.5"
              style={i > 0 ? { borderLeft: `1px solid ${theme.hairline}` } : undefined}
            >
              <span
                style={{ fontSize: '11px', fontWeight: 600, color: theme.subtext, letterSpacing: '0.02em' }}
              >
                {cell.label}
              </span>
              <span style={{ fontSize: '19px', fontWeight: 700, color: theme.subtext }}>
                {cell.value}
              </span>
              <span style={{ fontSize: '10px', color: theme.subtext }}>{cell.sub}</span>
            </div>
          ))}
        </div>
      </div>

      <ShotRow
        artboards={artboards}
        store="appstore"
        surface="product"
        theme={theme}
        radius={12}
        padding={APPSTORE_PAD}
        marginTop={18}
        liveIndexes={liveIndexes}
        observer={observer}
        width={width}
      />

      <div style={{ padding: `20px ${APPSTORE_PAD}px 32px` }}>
        <span
          style={{ fontSize: '20px', fontWeight: 700, color: theme.text, letterSpacing: '-0.02em' }}
        >
          Description
        </span>
        <div className="mt-3">
          <SkeletonLines theme={theme} widths={['100%', '96%', '88%', '64%']} />
        </div>
        <div className="mt-7" style={{ borderTop: `1px solid ${theme.hairline}`, paddingTop: '18px' }}>
          <span
            style={{ fontSize: '20px', fontWeight: 700, color: theme.text, letterSpacing: '-0.02em' }}
          >
            Ratings &amp; Reviews
          </span>
          <div className="mt-3">
            <SkeletonLines theme={theme} widths={['46%', '90%', '72%']} />
          </div>
        </div>
      </div>
    </>
  );
}

function AppStoreSearch({
  artboards,
  appName,
  developerName,
  theme,
  icon,
  liveIndexes,
  observer,
  width,
}: SurfaceProps) {
  return (
    <>
      <div style={{ padding: `0 ${APPSTORE_PAD}px` }}>
        <span
          style={{ fontSize: '34px', fontWeight: 700, letterSpacing: '-0.03em', color: theme.text }}
        >
          Search
        </span>
        <div
          className="mt-3 flex items-center gap-2"
          style={{ height: '36px', borderRadius: '10px', background: theme.chip, padding: '0 10px' }}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="6.8" cy="6.8" r="5" stroke={theme.subtext} strokeWidth="1.8" />
            <path d="m10.6 10.6 4 4" stroke={theme.subtext} strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: '17px', color: theme.text }}>{appName}</span>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <AppIcon
            size={62}
            radius={14}
            initials={icon.initials}
            background={icon.background}
            foreground={icon.foreground}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className="truncate"
              style={{ fontSize: '17px', fontWeight: 600, color: theme.text }}
            >
              {appName}
            </span>
            <span className="truncate" style={{ fontSize: '13px', color: theme.subtext }}>
              {developerName}
            </span>
            <span style={{ fontSize: '11px', color: theme.subtext }}>★★★★★ 4.8</span>
          </div>
          <div
            className="flex items-center justify-center"
            style={{ width: '68px', height: '28px', borderRadius: '14px', background: theme.accent }}
          >
            <span style={{ fontSize: '15px', fontWeight: 700, color: theme.accentText }}>GET</span>
          </div>
        </div>
      </div>

      <ShotRow
        artboards={artboards.slice(0, 3)}
        store="appstore"
        surface="search"
        theme={theme}
        radius={8}
        padding={APPSTORE_PAD}
        marginTop={12}
        liveIndexes={liveIndexes}
        observer={observer}
        width={width}
      />

      <div style={{ borderTop: `1px solid ${theme.hairline}`, marginTop: '20px' }}>
        <SkeletonResults theme={theme} count={3} iconSize={62} radius={14} padding={APPSTORE_PAD} />
      </div>
    </>
  );
}

// --- Google Play -------------------------------------------------------------

function PlayProduct({
  artboards,
  appName,
  developerName,
  theme,
  icon,
  liveIndexes,
  observer,
  width,
}: SurfaceProps) {
  return (
    <>
      <div style={{ padding: `0 ${PLAY_PAD}px` }}>
        <div className="flex gap-4">
          <AppIcon
            size={72}
            radius={16}
            initials={icon.initials}
            background={icon.background}
            foreground={icon.foreground}
          />
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
            <span
              style={{ fontSize: '22px', lineHeight: '26px', fontWeight: 500, color: theme.text }}
            >
              {appName}
            </span>
            <span style={{ fontSize: '14px', fontWeight: 500, color: theme.link }}>
              {developerName}
            </span>
            <span style={{ fontSize: '12px', color: theme.subtext }}>Contains ads · In-app purchases</span>
          </div>
        </div>

        <div className="mt-6 flex items-stretch" style={{ height: '46px' }}>
          {[
            { value: '4.6 ★', sub: '12K reviews' },
            { value: '100K+', sub: 'Downloads' },
            { value: '3+', sub: 'Rated for 3+' },
          ].map((cell, i) => (
            <div
              key={cell.sub}
              className="flex flex-1 flex-col items-center justify-center gap-1"
              style={i > 0 ? { borderLeft: `1px solid ${theme.hairline}` } : undefined}
            >
              <span style={{ fontSize: '14px', fontWeight: 500, color: theme.text }}>{cell.value}</span>
              <span style={{ fontSize: '11px', color: theme.subtext }}>{cell.sub}</span>
            </div>
          ))}
        </div>

        <div
          className="mt-5 flex items-center justify-center"
          style={{ height: '40px', borderRadius: '20px', background: theme.accent }}
        >
          <span style={{ fontSize: '15px', fontWeight: 500, color: theme.accentText }}>Install</span>
        </div>
      </div>

      <ShotRow
        artboards={artboards}
        store="play"
        surface="product"
        theme={theme}
        radius={8}
        padding={PLAY_PAD}
        marginTop={24}
        liveIndexes={liveIndexes}
        observer={observer}
        width={width}
      />

      <div style={{ padding: `24px ${PLAY_PAD}px 32px` }}>
        <span style={{ fontSize: '18px', fontWeight: 500, color: theme.text }}>About this app</span>
        <div className="mt-3">
          <SkeletonLines theme={theme} widths={['100%', '92%', '70%']} />
        </div>
        <div className="mt-7" style={{ borderTop: `1px solid ${theme.hairline}`, paddingTop: '18px' }}>
          <span style={{ fontSize: '18px', fontWeight: 500, color: theme.text }}>Data safety</span>
          <div className="mt-3">
            <SkeletonLines theme={theme} widths={['88%', '64%']} />
          </div>
        </div>
      </div>
    </>
  );
}

function PlaySearch({
  artboards,
  appName,
  developerName,
  theme,
  icon,
  liveIndexes,
  observer,
  width,
}: SurfaceProps) {
  return (
    <>
      <div style={{ padding: `0 ${PLAY_PAD}px` }}>
        <div
          className="flex items-center gap-3"
          style={{ height: '48px', borderRadius: '24px', background: theme.chip, padding: '0 16px' }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M15 9H3M3 9l5-5M3 9l5 5" stroke={theme.subtext} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontSize: '16px', color: theme.text }}>{appName}</span>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <AppIcon
            size={56}
            radius={13}
            initials={icon.initials}
            background={icon.background}
            foreground={icon.foreground}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate" style={{ fontSize: '16px', color: theme.text }}>
              {appName}
            </span>
            <span className="truncate" style={{ fontSize: '13px', color: theme.subtext }}>
              {developerName}
            </span>
            <span style={{ fontSize: '12px', color: theme.subtext }}>4.6 ★ · 24 MB</span>
          </div>
          <div
            className="flex items-center justify-center"
            style={{ height: '32px', padding: '0 18px', borderRadius: '16px', background: theme.accent }}
          >
            <span style={{ fontSize: '14px', fontWeight: 500, color: theme.accentText }}>Install</span>
          </div>
        </div>
      </div>

      <ShotRow
        artboards={artboards.slice(0, 3)}
        store="play"
        surface="search"
        theme={theme}
        radius={8}
        padding={PLAY_PAD}
        marginTop={14}
        liveIndexes={liveIndexes}
        observer={observer}
        width={width}
      />

      <SkeletonResults theme={theme} count={3} iconSize={56} radius={13} padding={PLAY_PAD} />
    </>
  );
}

// --- the row every surface shares -------------------------------------------

interface SurfaceProps {
  artboards: ArtboardState[];
  appName: string;
  developerName: string;
  theme: StoreTheme;
  icon: { initials: string; background: React.CSSProperties; foreground: string };
  liveIndexes: Set<number>;
  observer: IntersectionObserver | null;
  width: number;
}

function ShotRow({
  artboards,
  store,
  surface,
  theme,
  radius,
  padding,
  marginTop,
  liveIndexes,
  observer,
  width,
}: {
  artboards: ArtboardState[];
  store: StoreKind;
  surface: StoreSurface;
  theme: StoreTheme;
  radius: number;
  padding: number;
  marginTop: number;
  liveIndexes: Set<number>;
  observer: IntersectionObserver | null;
  width: number;
}) {
  return (
    <div
      className="flex overflow-x-auto [&::-webkit-scrollbar]:hidden"
      style={{
        gap: `${SHOT_GAP}px`,
        padding: `0 ${padding}px`,
        marginTop: `${marginTop}px`,
        scrollbarWidth: 'none',
        scrollSnapType: surface === 'product' ? 'x mandatory' : undefined,
        // Without this the snap point sits under the row's own left padding.
        scrollPaddingLeft: `${padding}px`,
      }}
    >
      {artboards.map((board, index) => {
        const box = shotBox(store, surface, width, board);
        return (
          <Shot
            key={board.id}
            board={board}
            width={box.width}
            height={box.height}
            radius={radius}
            theme={theme}
            live={liveIndexes.has(index)}
            index={index}
            observer={observer}
          />
        );
      })}
    </div>
  );
}

// --- icon derivation ---------------------------------------------------------

function initialsFrom(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'A';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Rough perceived lightness of a hex colour, or null when it is not hex. */
function hexLightness(color: string): number | null {
  const hex = color.trim().replace('#', '');
  const full =
    hex.length === 3
      ? hex.split('').map((c) => c + c).join('')
      : hex.length === 6
        ? hex
        : null;
  if (!full || !/^[0-9a-f]{6}$/i.test(full)) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * A stand-in app icon built from the first board's own background, so the mock
 * listing reads as the user's app rather than as a generic grey tile. A board
 * that is basically white would make an invisible icon, so that falls back to a
 * neutral slate.
 */
function deriveIcon(board: ArtboardState | undefined, name: string) {
  const initials = initialsFrom(name);
  const fallback = { background: { background: '#3f4a5a' }, foreground: '#ffffff' };
  if (!board) return { initials, ...fallback };

  const { backgroundColor, backgroundImage } = artboardBackground(board);
  const light = hexLightness(backgroundColor);
  if (light !== null && light > 0.9 && backgroundImage === 'none') {
    return { initials, ...fallback };
  }
  return {
    initials,
    background: {
      backgroundColor,
      backgroundImage,
    } as React.CSSProperties,
    foreground: light !== null && light > 0.62 ? '#1f2430' : '#ffffff',
  };
}

// --- the surface itself ------------------------------------------------------

/** Mounting every board live would exhaust the WebGL contexts; see count3dDevices. */
const LIVE_3D_BUDGET = 6;
const MAX_LIVE_SHOTS = 12;

export function StoreListingPreview({
  artboards,
  appName,
  developerName = 'Your Company',
}: {
  artboards: ArtboardState[];
  appName: string;
  developerName?: string;
}) {
  const detected = useMemo(() => detectArtboardsFormat(artboards), [artboards]);
  const [store, setStore] = useState<StoreKind>(() =>
    detected === 'android' || detected === 'tablet-7' || detected === 'tablet-10'
      ? 'play'
      : 'appstore'
  );
  const [surface, setSurface] = useState<StoreSurface>('product');
  const [themeKind, setThemeKind] = useState<ThemeKind>('light');

  const boxRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [observer, setObserver] = useState<IntersectionObserver | null>(null);
  const [visible, setVisible] = useState<Set<number>>(() => new Set());

  const phone = PHONES[store];
  const theme = THEMES[store][themeKind];

  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setBox({ width: rect.width, height: rect.height });
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const frameWidth = phone.width + BEZEL * 2;
  const frameHeight = phone.height + BEZEL * 2;
  const scale =
    box.width > 0 && box.height > 0
      ? Math.min(1, (box.height - 16) / frameHeight, (box.width - 16) / frameWidth)
      : 0;
  // The phone only renders once the box has been measured, so the observer has
  // to wait for it or it would bind to the viewport instead of the screen.
  const phoneMounted = scale > 0;

  // Which shots are on screen. The row scrolls horizontally and the page
  // scrolls vertically, so this watches the phone screen as the root and lets
  // whatever is off to the right stay a flat background until it arrives.
  useEffect(() => {
    if (!phoneMounted) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const entry of entries) {
            const raw = (entry.target as HTMLElement).dataset.shotIndex;
            if (raw === undefined) continue;
            const index = Number(raw);
            if (entry.isIntersecting) {
              if (!next.has(index)) {
                next.add(index);
                changed = true;
              }
            } else if (next.delete(index)) {
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { root: screenRef.current, rootMargin: '200px' }
    );
    setObserver(io);
    return () => io.disconnect();
    // Rebound when the store or surface changes: the row is a different set of
    // nodes each time, and the indexes reset with it.
  }, [store, surface, phoneMounted]);

  useEffect(() => {
    setVisible(new Set());
  }, [store, surface]);

  const liveIndexes = useMemo(() => {
    const live = new Set<number>();
    let budget = LIVE_3D_BUDGET;
    // Reading order, so what goes without is always the far end of the row
    // rather than a different shot on every scroll.
    for (let i = 0; i < artboards.length; i += 1) {
      if (!visible.has(i)) continue;
      if (live.size >= MAX_LIVE_SHOTS) break;
      const cost = count3dDevices(artboards[i]);
      if (cost > budget) continue;
      budget -= cost;
      live.add(i);
    }
    return live;
  }, [artboards, visible]);

  const icon = useMemo(() => deriveIcon(artboards[0], appName), [artboards, appName]);

  const surfaceProps: SurfaceProps = {
    artboards,
    appName,
    developerName,
    theme,
    icon,
    liveIndexes,
    observer,
    width: phone.width,
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-2 px-4 pb-3">
        <Segmented
          options={[
            { value: 'appstore', label: 'App Store' },
            { value: 'play', label: 'Google Play' },
          ]}
          value={store}
          onChange={(v) => setStore(v as StoreKind)}
        />
        <Segmented
          options={[
            { value: 'product', label: 'Listing' },
            { value: 'search', label: 'Search results' },
          ]}
          value={surface}
          onChange={(v) => setSurface(v as StoreSurface)}
        />
        <Segmented
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          value={themeKind}
          onChange={(v) => setThemeKind(v as ThemeKind)}
        />
      </div>

      <div ref={boxRef} className="flex flex-1 items-center justify-center overflow-hidden px-4">
        {scale > 0 && (
          <div
            style={{
              width: `${frameWidth}px`,
              height: `${frameHeight}px`,
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
              borderRadius: `${phone.radius + BEZEL}px`,
              padding: `${BEZEL}px`,
              background: '#0b0b0d',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.14), 0 30px 60px rgba(0,0,0,0.55)',
              flexShrink: 0,
            }}
          >
            <div
              ref={screenRef}
              className="relative overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden"
              style={{
                width: `${phone.width}px`,
                height: `${phone.height}px`,
                borderRadius: `${phone.radius}px`,
                background: theme.page,
                color: theme.text,
                fontFamily: FONTS[store],
                scrollbarWidth: 'none',
              }}
            >
              <StatusBar store={store} theme={theme} />

              {store === 'appstore' && (
                // The Dynamic Island sits over the page, so it has to float
                // rather than take part in the scroll.
                <div
                  className="pointer-events-none absolute left-1/2 -translate-x-1/2"
                  style={{
                    top: '11px',
                    width: '125px',
                    height: '36px',
                    borderRadius: '18px',
                    background: '#000',
                    boxShadow: themeKind === 'dark' ? '0 0 0 1px rgba(255,255,255,0.08)' : 'none',
                  }}
                />
              )}

              {store === 'appstore' && surface === 'product' && <AppStoreProduct {...surfaceProps} />}
              {store === 'appstore' && surface === 'search' && <AppStoreSearch {...surfaceProps} />}
              {store === 'play' && surface === 'product' && <PlayProduct {...surfaceProps} />}
              {store === 'play' && surface === 'search' && <PlaySearch {...surfaceProps} />}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-0.5 px-4 pb-4 pt-3 text-center">
        <span className="text-xs text-white/60">
          {phone.label}, {phone.width} × {phone.height}pt
          {scale > 0 && scale < 0.999 ? `, shown at ${Math.round(scale * 100)}%` : ''}
          {'. '}
          {surface === 'search'
            ? 'Search results are where small text disappears first.'
            : 'Scroll the phone. The row swipes sideways.'}
        </span>
        <span className="text-[11px] text-white/35">
          Ratings, downloads and chart position are placeholders.
        </span>
      </div>
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex rounded-full bg-white/10 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-medium transition-colors',
            option.value === value
              ? 'bg-white text-black'
              : 'text-white/70 hover:bg-white/10 hover:text-white'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
