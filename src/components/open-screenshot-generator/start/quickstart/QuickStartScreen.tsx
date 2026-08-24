"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Layers,
  Loader2,
  Palette,
  Search,
  Smartphone,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { trackScreenshotUploaded } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import type { DeviceType, Project } from '@/types/artboard';
import {
  applyFormat,
  deviceLabel,
  fillTemplate,
  slotOwners,
  suggestedFormat,
  type FillOptions,
} from '@/lib/intake/autoFill';
import { persistIntakeShots, toPlaceable, type PersistedShot } from '@/lib/intake/intakeAssets';
import {
  buildIntakeProfile,
  buildTemplateIndex,
  rankTemplates,
} from '@/lib/intake/templateIndex';
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
import { DEVICE_REGISTRY } from '@/lib/deviceRegistry';
import type { AppListing } from '@/lib/intake/appStoreLookup';
import { IntakeDropZone } from './IntakeDropZone';
import { ScreenshotStrip } from './ScreenshotStrip';
import { StoreImportPanel } from './StoreImportPanel';
import { TemplateMatchCard } from './TemplateMatchCard';
import { deckBoardBox } from './deckLayout';

interface QuickStartScreenProps {
  templates: Project[];
  isLoadingTemplates: boolean;
  onCreateProject: (project: Project, options: { nameOverride?: string }) => void | Promise<void>;
  /** Hand off to the AI agent, carrying whatever has been uploaded. */
  onHandOffToAgent?: (shots: PersistedShot[]) => void;
  /** Give up on matching and browse the full catalog. */
  onBrowseAll?: () => void;
  /**
   * Files dropped somewhere else in the dialog, plus a token that changes on
   * every drop so the same batch is never taken twice.
   */
  pendingFiles?: { files: File[]; token: number } | null;
  /** Called once a pending batch has been taken, so it is not taken twice. */
  onPendingFilesConsumed?: () => void;
  /**
   * False while another view is on top. The screen stays mounted so nothing the
   * user has done is lost, but it must stop listening for a paste, or a capture
   * pasted on the AI screen would land here instead.
   */
  active?: boolean;
}

/**
 * The WebGL budget for the results grid.
 *
 * Every 3D device frame builds its own THREE.WebGLRenderer, and Chrome keeps
 * roughly sixteen contexts alive before it starts evicting the oldest, which
 * blanks whatever it evicted. The editor canvas is still mounted behind this
 * dialog and holds contexts of its own, so the grid spends well under half.
 */
const LIVE_3D_BUDGET = 6;

/**
 * Drop screenshots, see finished designs, open one.
 *
 * The competitor's flow is four gated steps and a model call before anything is
 * on screen. This one has no steps. The moment an image lands, every template
 * in the catalog is scored against it and the best ones are rendered with the
 * user's own screenshots already inside them, using the same renderer the
 * canvas and the PNG export use. Everything else here, the app name, the
 * colour, the device, is an optional refinement that re-renders the grid live,
 * and none of it gates anything.
 */
export function QuickStartScreen({
  templates,
  isLoadingTemplates,
  onCreateProject,
  onHandOffToAgent,
  onBrowseAll,
  pendingFiles,
  onPendingFilesConsumed,
  active = true,
}: QuickStartScreenProps) {
  const { toast } = useToast();
  const [shots, setShots] = useState<PersistedShot[]>([]);
  const [appName, setAppName] = useState('');
  const [query, setQuery] = useState('');
  const [accent, setAccent] = useState<string | null>(null);
  const [matchDevice, setMatchDevice] = useState(false);
  const [applyFormatSwap, setApplyFormatSwap] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [remembered, setRemembered] = useState(0);
  // Which shot is lit, and its tap-to-pin equivalent for a finger.
  const [hoverShot, setHoverShot] = useState<number | null>(null);
  const [pinnedShot, setPinnedShot] = useState<number | null>(null);
  const [hoverTemplateId, setHoverTemplateId] = useState<string | null>(null);
  // The strip's "Add" tile and the drop zone need the same picker, and the
  // zone collapses to its compact form once there is a set, so the input lives
  // here rather than inside either of them.
  const addMoreRef = useRef<HTMLInputElement>(null);

  // localStorage is read in an effect, never in the initial state, so the
  // static export and the markup React hydrates agree.
  useEffect(() => {
    setRemembered(peekRememberedCount());
    const name = peekRememberedAppName();
    if (name) setAppName(name);
  }, []);

  // Persist the set whenever it settles, so closing this and coming back
  // tomorrow does not mean uploading the same five files again.
  useEffect(() => {
    if (shots.length === 0) return;
    const timer = window.setTimeout(() => void rememberIntake(shots, appName), 800);
    return () => window.clearTimeout(timer);
  }, [shots, appName]);

  /**
   * A live mirror of the set, so a second batch that starts while the first is
   * still decoding sees what the first one is about to add.
   *
   * `addFiles` closes over `shots`, and both the cap and the duplicate check
   * are computed from what it is handed. Two overlapping calls reading the same
   * pre-batch array is how twenty screenshots get past a limit of twenty and
   * how one folder dropped twice arrives as two of everything.
   */
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
        // The keystone. Every image is stored once in the media table and
        // carried as an asset reference from here on, so a deck showing the
        // same five screenshots in a dozen designs holds one decoded copy of
        // each instead of one per card.
        const persisted = await persistIntakeShots(result.shots);
        if (persisted.shots.length > 0) {
          // Update the mirror before the state, so a call that starts between
          // this line and the re-render still sees these.
          shotsRef.current = [...shotsRef.current, ...persisted.shots];
          setShots(shotsRef.current);
          trackScreenshotUploaded({
            source: 'drop_in',
            deviceType: persisted.shots[0].analysis.device,
            count: persisted.shots.length,
          });
        }
        const problems: string[] = [];
        if (result.duplicates > 0) {
          problems.push(`${result.duplicates} already in the set`);
        }
        if (result.overflow > 0) {
          problems.push(`${result.overflow} over the limit of ${INTAKE_MAX}`);
        }
        if (result.failed.length > 0) {
          problems.push(`${result.failed.length} could not be read`);
        }
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
    [shots, toast]
  );

  // Files dropped on another part of the dialog arrive as a batch plus a token
  // that changes each time, so the same drop is never taken twice and two
  // identical drops in a row both land.
  const drainedToken = useRef<number | null>(null);
  useEffect(() => {
    if (!pendingFiles || pendingFiles.files.length === 0) return;
    if (drainedToken.current === pendingFiles.token) return;
    drainedToken.current = pendingFiles.token;
    // Tell the owner it has been taken. drainedToken is a per-mount ref, and
    // this screen unmounts on Back or on closing the dialog, so without this
    // the same batch is ingested again the next time it is opened.
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

  const index = useMemo(
    () => (isLoadingTemplates ? new Map() : buildTemplateIndex(templates)),
    [templates, isLoadingTemplates]
  );

  const templateById = useMemo(() => {
    const map = new Map<string, Project>();
    for (const project of templates) map.set(project.id, project);
    return map;
  }, [templates]);

  const palette = useMemo(() => mergePalettes(shots.map((shot) => shot.analysis), 6), [shots]);

  const profile = useMemo(
    () => buildIntakeProfile(shots, { query: query.trim() || appName.trim() }),
    [shots, query, appName]
  );

  const majorityDevice = profile.device;

  const ranked = useMemo(() => {
    if (index.size === 0) return [];
    return rankTemplates(index, profile).slice(0, 36);
  }, [index, profile]);

  /**
   * Which cards render their 3D frames, and which flatten them.
   *
   * Nothing is denied a live render: a card past the budget still shows the
   * user's screenshots, just with the phone body drawn flat instead of in 3D.
   * Falling back to the shipped preview PNG would show somebody else's app,
   * which is the one thing this deck exists not to do.
   */
  const budget = useMemo(() => {
    const downgraded = new Set<string>();
    if (shots.length === 0) return { downgraded };
    let spent = 0;
    for (const scored of ranked) {
      const shown = deckBoardBox(scored.entry.canvas).boardsShown;
      const cost = scored.entry.slots.filter(
        (slot) => slot.is3d && slot.artboardIndex < shown
      ).length;
      if (cost === 0) continue;
      if (spent + cost > LIVE_3D_BUDGET) {
        downgraded.add(scored.entry.id);
        continue;
      }
      spent += cost;
    }
    return { downgraded };
  }, [ranked, shots.length]);

  const placeable = useMemo(() => toPlaceable(shots), [shots]);

  /**
   * The shot currently lit, whichever way the user expressed it. A pin beats a
   * hover, because on a coarse pointer the pin IS the hover.
   */
  const litShot = pinnedShot ?? hoverShot;

  /**
   * Where each shot lands, for the design under the pointer.
   *
   * Cached per template so the hover handshake does not re-walk the same
   * placement on every pointer move. The cache is cleared whenever the set or
   * the trim policy changes, since both move the mapping.
   */
  // Keyed, not cleared in an effect. The cache is read during RENDER, and an
  // effect runs after the commit, so clearing it there left the render that
  // follows a removal reading maps built for the old shot count.
  const ownersCache = useRef<{ key: number; byTemplate: Map<string, Map<string, number>> }>({
    key: -1,
    byTemplate: new Map(),
  });
  const ownersFor = useCallback(
    (template: Project): Map<string, number> => {
      if (ownersCache.current.key !== shots.length) {
        ownersCache.current = { key: shots.length, byTemplate: new Map() };
      }
      const cached = ownersCache.current.byTemplate.get(template.id);
      if (cached) return cached;
      const built = slotOwners(template, shots.length, 'trim');
      ownersCache.current.byTemplate.set(template.id, built);
      return built;
    },
    [shots.length]
  );

  /**
   * What to print under a chip while a design is hovered: the board that shot
   * lands on, or that it does not land anywhere in this one.
   */
  const slotLabel = useCallback(
    (index: number): string | null => {
      if (!hoverTemplateId) return null;
      const template = templateById.get(hoverTemplateId);
      if (!template) return null;
      const owners = ownersFor(template);
      let board = 0;
      for (const [boardIndex, artboard] of (template.projectData ?? []).entries()) {
        for (const element of artboard.elements) {
          if (element.type !== 'device') continue;
          if (owners.get(element.id) === index) {
            board = boardIndex + 1;
            return `to board ${board}`;
          }
        }
      }
      return 'unused';
    },
    [hoverTemplateId, templateById, ownersFor]
  );

  const fillOptions = useMemo(
    (): FillOptions => ({
      unusedBoards: 'trim',
      matchDeviceType: matchDevice,
      accentColor: accent,
    }),
    [matchDevice, accent]
  );

  const selected = selectedId ? templateById.get(selectedId) ?? null : null;

  /**
   * The store format this upload wants, if the design it is going into is not
   * already in it. Falls back to the top match rather than waiting for a
   * selection: this banner is the answer to "why does nothing here look built
   * for my Android screenshots", and it has to be readable before the click,
   * not after it.
   */
  const formatTarget = selected ?? (ranked[0] ? templateById.get(ranked[0].entry.id) ?? null : null);
  const formatSuggestion = useMemo(() => {
    if (!formatTarget || shots.length === 0) return null;
    return suggestedFormat(formatTarget, majorityDevice);
  }, [formatTarget, shots.length, majorityDevice]);

  // --- commit --------------------------------------------------------------

  const use = useCallback(
    async (template: Project) => {
      if (creating) return;
      setCreating(true);
      try {
        const result = fillTemplate(template, placeable, {
          ...fillOptions,
          nameOverride: appName.trim() || undefined,
        });
        let project = result.project;
        const preset = shots.length > 0 ? suggestedFormat(template, majorityDevice) : null;
        if (preset && applyFormatSwap) project = applyFormat(project, preset);

        await onCreateProject(project, {
          nameOverride: appName.trim() || `${template.name} Copy`,
        });

        if (result.trimmed > 0) {
          toast({
            title: 'Project created',
            description: `${result.placed} screenshots placed, ${result.trimmed} unused boards removed`,
          });
        }
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
    [
      appName,
      applyFormatSwap,
      creating,
      fillOptions,
      majorityDevice,
      onCreateProject,
      placeable,
      shots.length,
      toast,
    ]
  );

  // --- render --------------------------------------------------------------

  const hasShots = shots.length > 0;
  const framedCount = shots.filter((shot) => shot.analysis.looksFramed).length;

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

        {/* Intake. In normal flow, NOT sticky: once the shots are in, the deck
            below is what the user is reading, and pinning the drop zone and the
            strip to the top ate the room the designs need. Scrolling up takes
            the whole intake off screen; scrolling back down returns it. */}
        <section className="space-y-3 pb-2 pt-1">
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
                    {`in board order, from ${deviceLabel(majorityDevice)}`}
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
                highlight={litShot}
                onHoverShot={setHoverShot}
                pinned={pinnedShot}
                onPin={setPinnedShot}
                slotLabel={slotLabel}
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
              {framedCount > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {framedCount === 1
                    ? 'One of these looks like it already has a device frame around it. Raw captures look better inside a mockup'
                    : `${framedCount} of these look like they already have device frames around them. Raw captures look better inside a mockup`}
                </p>
              )}
            </div>
          )}
        </section>

        {/* The store import, kept a sibling of the intake rather than a child
            of it, so its own height is never bounded by that section. */}
        {storeOpen && (
          <StoreImportPanel
            onClose={() => setStoreOpen(false)}
            onImportFiles={(files, listing) => {
              if (!appName.trim()) setAppName(listing.name);
              setStoreOpen(false);
              void addFiles(files);
            }}
            onAdoptDetails={(listing) => {
              setAppName(listing.name);
              if (!query.trim() && listing.category) setQuery(listing.category);
            }}
          />
        )}

        {/* Refinements. Every one of these re-renders the grid immediately. */}
        <section className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border bg-muted/20 p-3">
          <div className="min-w-[12rem] flex-1 space-y-1">
            <Label htmlFor="quickstart-name" className="text-xs">
              App name
            </Label>
            <Input
              id="quickstart-name"
              value={appName}
              onChange={(event) => setAppName(event.target.value)}
              placeholder="Optional, names the project"
              className="h-9"
            />
          </div>

          <div className="min-w-[12rem] flex-1 space-y-1">
            <Label htmlFor="quickstart-query" className="text-xs">
              What is it about
            </Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="quickstart-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Fitness, finance, meditation"
                className="h-9 pl-8"
              />
            </div>
          </div>

          {palette.length > 0 && (
            <div className="space-y-1">
              <Label className="flex items-center gap-1 text-xs">
                <Palette className="h-3 w-3" />
                Theme
              </Label>
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
                  <TooltipContent side="top" className="z-[60] text-sm">
                    Keep each design its own colours
                  </TooltipContent>
                </Tooltip>
                {palette.slice(0, 5).map((hex) => (
                  <Tooltip key={hex}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setAccent(accent === hex ? null : hex)}
                        style={{ backgroundColor: hex }}
                        className={cn(
                          'h-7 w-7 rounded-full border transition-all',
                          accent === hex
                            ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                            : 'hover:scale-110'
                        )}
                        aria-label={`Theme everything around ${hex}`}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="z-[60] text-sm">
                      Pull every board toward {hex}, taken from your screenshots
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}

          {hasShots && (
            <div className="flex items-center gap-2 pb-1">
              <Switch id="quickstart-device" checked={matchDevice} onCheckedChange={setMatchDevice} />
              <Label htmlFor="quickstart-device" className="flex cursor-pointer items-center gap-1 text-xs">
                <Smartphone className="h-3 w-3" />
                {`Use ${deviceLabel(majorityDevice)} frames`}
              </Label>
            </div>
          )}
        </section>

        {formatSuggestion && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            <Layers className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              {`Your screenshots are ${deviceLabel(majorityDevice)}. These designs are built for another size, so whichever you pick is converted to ${formatSuggestion.label} at ${formatSuggestion.artboard.width} x ${formatSuggestion.artboard.height}, the size that store accepts`}
            </span>
            <div className="flex items-center gap-2">
              <Switch
                id="quickstart-format"
                checked={applyFormatSwap}
                onCheckedChange={setApplyFormatSwap}
              />
              <Label htmlFor="quickstart-format" className="cursor-pointer text-xs">
                Convert on open
              </Label>
            </div>
          </div>
        )}

        {/* Results */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {hasShots ? 'Your screenshots, in these designs' : 'Designs to start from'}
              {ranked.length > 0 && (
                <span className="ml-2 font-normal text-muted-foreground">{ranked.length} ranked</span>
              )}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {onHandOffToAgent && (
                <Button type="button" variant="ghost" size="sm" onClick={() => onHandOffToAgent(shots)}>
                  <Wand2 className="h-3.5 w-3.5" />
                  Let the AI write the copy too
                </Button>
              )}
              {onBrowseAll && (
                <Button type="button" variant="ghost" size="sm" onClick={onBrowseAll}>
                  Browse everything
                </Button>
              )}
            </div>
          </div>

          {isLoadingTemplates ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-2 rounded-xl border p-3">
                  <Skeleton className="h-[251px] w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          ) : ranked.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing in the catalog can hold this set. Try removing a screenshot, or browse
              everything
            </p>
          ) : (
            <div className="flex flex-wrap gap-4">
              {ranked.map((scored) => {
                const template = templateById.get(scored.entry.id);
                if (!template) return null;
                return (
                  <TemplateMatchCard
                    key={scored.entry.id}
                    template={template}
                    scored={scored}
                    shots={placeable}
                    fillOptions={fillOptions}
                    ownerOf={ownersFor(template)}
                    live
                    downgrade3d={budget.downgraded.has(scored.entry.id)}
                    highlightShot={litShot}
                    onHoverBoard={(shotIndex) => {
                      setHoverShot(shotIndex);
                      setHoverTemplateId(shotIndex === null ? null : scored.entry.id);
                    }}
                    selected={selectedId === scored.entry.id}
                    onSelect={() => setSelectedId(scored.entry.id)}
                    onUse={() => void use(template)}
                  />
                );
              })}
            </div>
          )}
        </section>

        {creating && (
          <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-background/60">
            <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 shadow-lg">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm font-medium">Building your project</span>
            </div>
          </div>
        )}

        {!hasShots && !isLoadingTemplates && (
          <p className="flex items-center justify-center gap-1.5 pb-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            Add screenshots above and every design here fills with them, instantly
          </p>
        )}
      </div>
    </TooltipProvider>
  );
}
