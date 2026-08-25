"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Palette, RefreshCw, Shapes } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { trackScreenshotUploaded } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import type { Project } from '@/types/artboard';
import { fillTemplate } from '@/lib/intake/autoFill';
import { deviceLabel } from '@/lib/intake/autoFill';
import { persistIntakeShots, toPlaceable, type PersistedShot } from '@/lib/intake/intakeAssets';
import { mergePalettes } from '@/lib/intake/screenshotAnalysis';
import {
  INTAKE_MAX,
  normalizePickedFiles,
  readIntakeFiles,
  reorder,
} from '@/lib/intake/intakeFiles';
import {
  forgetIntake,
  peekRememberedAppName,
  peekRememberedCount,
  recallIntake,
  rememberIntake,
} from '@/lib/intake/intakeMemory';
import { buildIntakeProfile } from '@/lib/intake/templateIndex';
import {
  assertSocialFormatPresets,
  DEFAULT_SOCIAL_FORMAT,
  getSocialFormat,
  SOCIAL_FORMATS,
  type SocialFormatId,
} from '@/lib/graphics/socialFormats';
import {
  buildSocialTemplate,
  DEFAULT_BRAND,
  SOCIAL_STYLES,
  type SocialBrand,
  type StoreBadge,
} from '@/lib/graphics/socialLayouts';
import { IntakeDropZone } from '../quickstart/IntakeDropZone';
import { ScreenshotStrip } from '../quickstart/ScreenshotStrip';
import { StoreImportPanel } from '../quickstart/StoreImportPanel';
import { GraphicsStyleCard } from './GraphicsStyleCard';

interface GraphicsStartScreenProps {
  onCreateProject: (project: Project, options: { nameOverride?: string }) => void | Promise<void>;
  /** Files dropped elsewhere in the dialog, plus a token so a batch is taken once. */
  pendingFiles?: { files: File[]; token: number } | null;
  onPendingFilesConsumed?: () => void;
  /** False while another view is on top. The screen stays mounted regardless. */
  active?: boolean;
}

/**
 * The same WebGL budget the screenshot deck spends, for the same reason: every
 * 3D frame builds its own THREE.WebGLRenderer and the browser evicts the oldest
 * once roughly sixteen are alive, blanking whatever it evicted. The editor
 * canvas behind this dialog holds contexts of its own.
 */
const LIVE_3D_BUDGET = 6;

/** Board width inside a card, per band, chosen so the grid reads at a glance. */
const CARD_WIDTH = { ultrawide: 420, wide: 400, square: 300, tall: 220 } as const;

/**
 * Drop your screenshots, get marketing graphics.
 *
 * The competitor's version of this screen asks for a style, runs a model, and
 * shows a progress bar counting through "Extracting brand colors" and "Crafting
 * compelling marketing copy". That is a lot of ceremony for an answer that is
 * deterministic: the copy is a bank keyed on the app name, the colour is the
 * dominant one in the screenshots, and the layout is arithmetic. So there is no
 * Generate step here and no spinner. Pick a format, see eight finished designs
 * with your own screens already inside them, open one.
 */
export function GraphicsStartScreen({
  onCreateProject,
  pendingFiles,
  onPendingFilesConsumed,
  active = true,
}: GraphicsStartScreenProps) {
  const { toast } = useToast();
  const [shots, setShots] = useState<PersistedShot[]>([]);
  const [appName, setAppName] = useState('');
  const [formatId, setFormatId] = useState<SocialFormatId>(DEFAULT_SOCIAL_FORMAT);
  const [accent, setAccent] = useState<string | null>(null);
  const [badge, setBadge] = useState<StoreBadge>('app-store');
  const [rotation, setRotation] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [remembered, setRemembered] = useState(0);
  const addMoreRef = useRef<HTMLInputElement>(null);

  // localStorage is read in an effect, never in initial state, so the static
  // export and the markup React hydrates agree.
  useEffect(() => {
    setRemembered(peekRememberedCount());
    const name = peekRememberedAppName();
    if (name) setAppName(name);
  }, []);

  // A drift between the format list and the canvas-size catalog is invisible in
  // the UI, so say so loudly where a developer will see it.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const problems = assertSocialFormatPresets();
    if (problems.length > 0) {
      console.warn('[graphics] format and canvas-size preset drift:\n' + problems.join('\n'));
    }
  }, []);

  useEffect(() => {
    if (shots.length === 0) return;
    const timer = window.setTimeout(() => void rememberIntake(shots, appName), 800);
    return () => window.clearTimeout(timer);
  }, [shots, appName]);

  // A live mirror of the set, so a second batch that starts while the first is
  // still decoding sees what the first is about to add.
  const shotsRef = useRef<PersistedShot[]>([]);
  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setReading(true);
      try {
        const result = await readIntakeFiles(files, shotsRef.current);
        const persisted = await persistIntakeShots(result.shots);
        if (persisted.shots.length > 0) {
          shotsRef.current = [...shotsRef.current, ...persisted.shots];
          setShots(shotsRef.current);
          trackScreenshotUploaded({
            source: 'drop_in',
            deviceType: persisted.shots[0].analysis.device,
            count: persisted.shots.length,
          });
        }
        const problems: string[] = [];
        if (result.duplicates > 0) problems.push(`${result.duplicates} already in the set`);
        if (result.overflow > 0) problems.push(`${result.overflow} over the limit of ${INTAKE_MAX}`);
        if (result.failed.length > 0) problems.push(`${result.failed.length} could not be read`);
        if (problems.length > 0) {
          toast({
            title: persisted.shots.length > 0 ? 'Some files were skipped' : 'Nothing was added',
            description: problems.join(', '),
            variant: persisted.shots.length > 0 ? 'default' : 'destructive',
          });
        }
      } catch (error) {
        toast({
          title: 'Those images could not be read',
          description: error instanceof Error ? error.message : 'Try a PNG or a JPG',
          variant: 'destructive',
        });
      } finally {
        setReading(false);
      }
    },
    [toast]
  );

  const drainedToken = useRef<number | null>(null);
  useEffect(() => {
    if (!pendingFiles || pendingFiles.files.length === 0) return;
    if (drainedToken.current === pendingFiles.token) return;
    drainedToken.current = pendingFiles.token;
    onPendingFilesConsumed?.();
    void addFiles(pendingFiles.files);
  }, [pendingFiles, addFiles, onPendingFilesConsumed]);

  const restoreRemembered = useCallback(async () => {
    setReading(true);
    try {
      const recalled = await recallIntake();
      if (recalled.length === 0) {
        setRemembered(0);
        toast({ title: 'That set is no longer on this device', variant: 'destructive' });
        return;
      }
      shotsRef.current = recalled;
      setShots(recalled);
      setRemembered(0);
    } finally {
      setReading(false);
    }
  }, [toast]);

  const clearAll = useCallback(() => {
    shotsRef.current = [];
    setShots([]);
    setSelectedId(null);
    setAccent(null);
    void forgetIntake();
    setRemembered(0);
  }, []);

  // --- derived -------------------------------------------------------------

  const format = getSocialFormat(formatId);
  const palette = useMemo(() => mergePalettes(shots.map((shot) => shot.analysis), 6), [shots]);
  const profile = useMemo(() => buildIntakeProfile(shots, { query: appName.trim() }), [shots, appName]);

  const brand = useMemo<SocialBrand>(
    () => ({
      ...DEFAULT_BRAND,
      appName,
      accent: accent ?? palette[0] ?? DEFAULT_BRAND.accent,
      badge,
      // The screenshots decide which mockup the graphics use, exactly as they
      // decide it in the screenshot flow.
      deviceType: shots.length > 0 ? profile.device : DEFAULT_BRAND.deviceType,
      rotation,
    }),
    [appName, accent, palette, badge, profile.device, shots.length, rotation]
  );

  const placeable = useMemo(() => toPlaceable(shots), [shots]);

  /**
   * The eight boards on screen.
   *
   * Built, then poured. `buildSocialBoard` composes the design and
   * `fillTemplate` puts the user's screenshots into its frames, which is the
   * same pure transform the screenshot deck uses, so a graphic and a store
   * screenshot can never disagree about how an upload lands in a mockup.
   */
  const cards = useMemo(
    () =>
      SOCIAL_STYLES.map((style) => {
        const template = buildSocialTemplate(style, format, brand);
        const board =
          placeable.length > 0
            ? fillTemplate(template, placeable, { unusedBoards: 'keep' }).project.projectData[0]
            : template.projectData[0];
        return { style, template, board };
      }),
    [format, brand, placeable]
  );

  /** Which cards may mount live 3D, and which flatten. */
  const downgraded = useMemo(() => {
    const out = new Set<string>();
    let spent = 0;
    for (const card of cards) {
      const cost = card.board.elements.filter(
        (el) => el.type === 'device' && (el.styleType === '3d-left' || el.styleType === '3d-right')
      ).length;
      if (cost === 0) continue;
      if (spent + cost > LIVE_3D_BUDGET) out.add(card.style.id);
      else spent += cost;
    }
    return out;
  }, [cards]);

  const cardWidth = CARD_WIDTH[
    format.width / format.height >= 2.6
      ? 'ultrawide'
      : format.width / format.height >= 1.4
        ? 'wide'
        : format.width / format.height >= 0.85
          ? 'square'
          : 'tall'
  ];

  // --- commit --------------------------------------------------------------

  const use = useCallback(
    async (styleId: string) => {
      if (creating) return;
      const card = cards.find((entry) => entry.style.id === styleId);
      if (!card) return;
      setCreating(true);
      try {
        // Rebuild rather than reuse the card's board, so what opens is exactly
        // what the card shows and carries no preview-only downgrade.
        const filled =
          placeable.length > 0
            ? fillTemplate(card.template, placeable, { unusedBoards: 'keep' }).project
            : card.template;
        await onCreateProject(filled, {
          nameOverride: appName.trim()
            ? `${appName.trim()} ${format.short}`
            : `${card.style.label} ${format.label}`,
        });
      } catch (error) {
        toast({
          title: 'That design could not be opened',
          description: error instanceof Error ? error.message : 'Try another one',
          variant: 'destructive',
        });
      } finally {
        setCreating(false);
      }
    },
    [appName, cards, creating, format, onCreateProject, placeable, toast]
  );

  // --- render --------------------------------------------------------------

  const hasShots = shots.length > 0;

  return (
    <TooltipProvider delayDuration={250}>
      <div className="space-y-4">
        <input
          ref={addMoreRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void addFiles(normalizePickedFiles(Array.from(event.target.files)));
            event.target.value = '';
          }}
        />

        <section className="space-y-3 pb-1 pt-1">
          <IntakeDropZone
            active={active}
            onFiles={(files) => void addFiles(files)}
            count={shots.length}
            busy={reading}
            compact={hasShots}
            onOpenStoreImport={() => setStoreOpen(true)}
            remembered={
              !hasShots && remembered > 0
                ? { count: remembered, onRestore: () => void restoreRemembered() }
                : null
            }
          />

          {hasShots && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {shots.length} {shots.length === 1 ? 'screenshot' : 'screenshots'}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {`from ${deviceLabel(profile.device)}`}
                  </span>
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
                  Clear
                </Button>
              </div>
              <ScreenshotStrip
                shots={shots}
                max={INTAKE_MAX}
                disabled={reading}
                onReorder={(from, to) =>
                  setShots((current) => {
                    const next = reorder(current, from, to);
                    shotsRef.current = next;
                    return next;
                  })
                }
                onRemove={(id) =>
                  setShots((current) => {
                    const next = current.filter((shot) => shot.id !== id);
                    shotsRef.current = next;
                    return next;
                  })
                }
                onAddMore={() => addMoreRef.current?.click()}
              />
            </div>
          )}
        </section>

        {storeOpen && (
          <StoreImportPanel
            onClose={() => setStoreOpen(false)}
            onImportFiles={(files, listing) => {
              if (!appName.trim()) setAppName(listing.name);
              setStoreOpen(false);
              void addFiles(files);
            }}
            onAdoptDetails={(listing) => setAppName(listing.name)}
          />
        )}

        {/* Refinements. Every one re-renders the whole grid immediately. */}
        <section className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border bg-muted/20 p-3">
          <div className="min-w-[12rem] max-w-sm flex-1 space-y-1">
            <Label htmlFor="graphics-name" className="text-xs">
              App name
            </Label>
            <Input
              id="graphics-name"
              value={appName}
              onChange={(event) => setAppName(event.target.value)}
              placeholder="Goes into the headline"
              className="h-9"
            />
          </div>

          {palette.length > 0 && (
            <div className="shrink-0 space-y-1">
              <Label className="text-xs">Brand colour</Label>
              <div className="flex items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setAccent(null)}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full border text-muted-foreground transition-all',
                        accent === null
                          ? 'border-primary ring-2 ring-primary ring-offset-1 ring-offset-background'
                          : 'hover:border-foreground/30'
                      )}
                    >
                      {accent === null ? <Check className="h-3.5 w-3.5" /> : <Palette className="h-3.5 w-3.5" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Straight from your screenshots</TooltipContent>
                </Tooltip>
                {palette.map((color) => (
                  <Tooltip key={color}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setAccent(color)}
                        style={{ backgroundColor: color }}
                        className={cn(
                          'h-7 w-7 rounded-full border transition-all',
                          accent === color
                            ? 'border-primary ring-2 ring-primary ring-offset-1 ring-offset-background'
                            : 'hover:scale-110'
                        )}
                        aria-label={`Use ${color}`}
                      />
                    </TooltipTrigger>
                    <TooltipContent>{color}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}

          <div className="shrink-0 space-y-1">
            <Label className="text-xs">Download badge</Label>
            <div className="flex items-center gap-1">
              {(['app-store', 'google-play', 'none'] as StoreBadge[]).map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={badge === option ? 'default' : 'outline'}
                  className="h-7 px-2 text-xs"
                  onClick={() => setBadge(option)}
                >
                  {option === 'app-store' ? 'App Store' : option === 'google-play' ? 'Google Play' : 'None'}
                </Button>
              ))}
            </div>
          </div>

          <div className="shrink-0 space-y-1">
            <Label className="text-xs">Wording</Label>
            {/* The button needs a block wrapper. A bare <Button> after a
                <Label> puts the two on the same line, because both are inline. */}
            <div className="flex items-center">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => setRotation((value) => value + 1)}
              >
                <RefreshCw className="mr-1.5 h-3 w-3" />
                New lines
              </Button>
            </div>
          </div>
        </section>

        {/* Format tabs. Plain buttons rather than Radix Tabs: there is one panel
            and it re-renders from `formatId`, so a TabsContent per format would
            mount eight boards apiece and keep them all alive (inactive panels
            stay mounted, AGENTS rule 16). */}
        <section className="space-y-3">
          <div
            className="flex flex-wrap gap-1 rounded-lg bg-muted p-1"
            role="tablist"
            aria-label="Graphic format"
          >
            {SOCIAL_FORMATS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={entry.id === formatId}
                onClick={() => setFormatId(entry.id)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  entry.id === formatId
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {entry.label}
                <span className="ml-1.5 text-[10px] font-normal opacity-60">
                  {entry.width} x {entry.height}
                </span>
              </button>
            ))}
          </div>

          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-muted-foreground">{format.blurb}</p>
            {creating && (
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Opening
              </span>
            )}
          </div>

          {!hasShots && (
            <p className="flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              <Shapes className="h-3.5 w-3.5 shrink-0" />
              These are live designs with placeholder screens. Drop your screenshots above and every
              one of them fills in
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            {cards.map(({ style, board }) => (
              <div key={style.id} style={{ width: cardWidth }}>
                <GraphicsStyleCard
                  board={board}
                  label={style.label}
                  blurb={style.blurb}
                  width={cardWidth - 16}
                  downgrade3d={downgraded.has(style.id)}
                  selected={selectedId === style.id}
                  onSelect={() => setSelectedId(style.id)}
                  onUse={() => void use(style.id)}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </TooltipProvider>
  );
}
