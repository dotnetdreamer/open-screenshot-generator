"use client";

// Where a Limelight scene starts: the built-in templates, the user's own, or
// a plain phone. Each card shows the template's frame with the user's own
// screenshots in it, drawn by one stage made for the gallery (one WebGL
// context, never one per card) as small stills, one after another, and
// given back when the gallery closes. With no screenshots in the open
// project, a plain picture of an app's screen stands in.

import React, { useEffect, useRef, useState } from 'react';
import { Loader2Icon, SmartphoneIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { shotBlob, type ProjectShot } from '@/lib/limelight/projectShots';
import { LimelightStage } from '@/lib/limelight/stage/stage';
import { deleteMyTemplate, listMyTemplates, type MyTemplate } from '@/lib/limelight/store';
import { TEMPLATES, buildTemplate } from '@/lib/limelight/templates';
import { findCardInPicture } from '@/lib/limelight/cards';
import type { LimelightFormat } from '@/lib/limelight/types';
import { cn } from '@/lib/utils';

export type GalleryChoice = { kind: 'builtin'; id: string } | { kind: 'mine'; template: MyTemplate } | { kind: 'empty' };

interface GalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shots: ProjectShot[];
  projectName: string;
  /** The project's colour and font, for templates that take them. */
  accent?: string;
  font?: string;
  /** The project's app icon, for templates that close on it. */
  captureIcon?: () => Promise<Blob | null>;
  format: LimelightFormat;
  onPick: (choice: GalleryChoice) => Promise<void>;
}

/** Pixels tall: sharp on a card about 400 CSS pixels tall on a Retina screen, and still quick to draw. */
const PREVIEW_HEIGHT = 560;

/** A stand-in screenshot: a plain app screen in soft colours, drawn here so nothing is downloaded. */
async function placeholderPicture(hue: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 590;
  canvas.height = 1280;
  const ctx = canvas.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, `hsl(${hue} 70% 96%)`);
  sky.addColorStop(1, `hsl(${hue} 45% 86%)`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const card = (x: number, y: number, w: number, h: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 28);
    ctx.fill();
  };
  card(40, 150, 510, 90, 'rgba(255,255,255,0.9)');
  card(40, 280, 510, 360, `hsl(${hue} 60% 62%)`);
  card(40, 680, 245, 240, 'rgba(255,255,255,0.92)');
  card(305, 680, 245, 240, 'rgba(255,255,255,0.92)');
  card(40, 960, 510, 120, 'rgba(255,255,255,0.85)');
  card(150, 1160, 290, 70, `hsl(${hue} 55% 45%)`);
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No picture'))), 'image/png'));
}

export function LimelightGallery({ open, onOpenChange, shots, projectName, accent, font, captureIcon, format, onPick }: GalleryProps) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [mine, setMine] = useState<MyTemplate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const urls = useRef<string[]>([]);
  // Set when a card is picked: the previews stop, so making the scene doesn't wait behind them.
  const picked = useRef(false);
  const aspect = format.width / format.height;

  useEffect(() => {
    if (!open) return;
    void listMyTemplates().then(setMine).catch(() => setMine([]));
  }, [open]);

  // The previews, drawn one after another while the gallery is open.
  useEffect(() => {
    if (!open) return;
    picked.current = false;
    let cancelled = false;
    let stage: LimelightStage | null = null;
    void (async () => {
      const pictures = new Map<string, Blob>();
      // Each picture's headline, for the templates with captions: what the scene made from them will say.
      const captions: Array<string | undefined> = [];
      const own = shots.filter((shot) => !shot.sample).slice(0, 6);
      const source = own.length > 0 ? own : shots.slice(0, 3);
      for (const shot of source) {
        const blob = await shotBlob(shot.src);
        if (!blob) continue;
        pictures.set(`preview_${pictures.size}`, blob);
        captions.push(shot.headline);
      }
      if (pictures.size === 0) {
        for (const hue of [212, 160, 330]) pictures.set(`preview_${pictures.size}`, await placeholderPicture(hue));
      }
      const ids = [...pictures.keys()];
      const cards = await Promise.all(ids.map((id) => findCardInPicture(pictures.get(id)!)));
      const iconBlob = captureIcon ? await captureIcon().catch(() => null) : null;
      if (iconBlob) pictures.set('preview_icon', iconBlob);
      if (cancelled) return;
      try {
        stage = new LimelightStage({ loadMedia: async (id) => pictures.get(id) ?? null });
      } catch (error) {
        console.warn('Limelight could not draw the template previews', error);
        return;
      }
      for (const template of TEMPLATES) {
        // Each still reads its pixels back, which holds the page for a moment
        // on a slow GPU: give clicks a turn between them.
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        if (cancelled || picked.current) break;
        let scene: Awaited<ReturnType<typeof buildTemplate>> = null;
        try {
          // A template in a file of its own comes in now, with the gallery.
          scene = await buildTemplate(template.id, { format, pictures: ids, title: projectName || 'Your app', captions, accent, font, icon: iconBlob ? 'preview_icon' : undefined, cards });
        } catch (error) {
          console.warn('Limelight could not load a template', template.id, error);
        }
        if (!scene || cancelled || picked.current) continue;
        stage.setScene(scene);
        try {
          const blob = await stage.renderStill({ width: Math.round(PREVIEW_HEIGHT * aspect), height: PREVIEW_HEIGHT, time: scene.format.duration * (template.poster ?? 0.32), type: 'image/jpeg' });
          if (cancelled) break;
          const url = URL.createObjectURL(blob);
          urls.current.push(url);
          setPreviews((current) => ({ ...current, [template.id]: url }));
        } catch (error) {
          console.warn('Limelight could not draw a template preview', template.id, error);
        }
      }
      stage?.dispose();
      stage = null;
    })();
    return () => {
      cancelled = true;
      stage?.dispose();
    };
  }, [accent, aspect, captureIcon, font, format, open, projectName, shots]);

  // The previews were made for this project's pictures: let them go with the gallery.
  useEffect(() => {
    if (open) return;
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
    setPreviews({});
  }, [open]);

  const pick = async (key: string, choice: GalleryChoice) => {
    picked.current = true;
    setBusy(key);
    try {
      await onPick(choice);
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  };

  const ownCount = shots.filter((shot) => !shot.sample).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto" data-testid="limelight-gallery">
        <DialogHeader>
          <DialogTitle>Start a scene</DialogTitle>
          <DialogDescription>
            {ownCount > 0
              ? `Pick a camera move. Your ${ownCount === 1 ? 'screenshot goes' : `${ownCount} screenshots go`} on the phones for you.`
              : 'Pick a camera move. Open a project with your screenshots in the editor, and they go on the phones for you.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <button
            type="button"
            onClick={() => void pick('empty', { kind: 'empty' })}
            disabled={busy !== null}
            className="group flex flex-col overflow-hidden rounded-xl border text-left transition-colors hover:border-primary disabled:opacity-60"
          >
            <div className="flex w-full items-center justify-center bg-muted" style={{ aspectRatio: `${aspect}` }}>
              {busy === 'empty' ? <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" /> : <SmartphoneIcon className="h-8 w-8 text-muted-foreground" />}
            </div>
            <div className="p-2.5">
              <div className="text-xs font-semibold">One phone</div>
              <div className="text-[11px] text-muted-foreground">A phone and a slow camera move, to build on</div>
            </div>
          </button>
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => void pick(template.id, { kind: 'builtin', id: template.id })}
              disabled={busy !== null}
              aria-label={`${template.name}: ${template.hint}`}
              className="group flex flex-col overflow-hidden rounded-xl border text-left transition-colors hover:border-primary disabled:opacity-60"
            >
              <div className="relative w-full bg-muted" style={{ aspectRatio: `${aspect}` }}>
                {previews[template.id] ? (
                  <img src={previews[template.id]} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                ) : (
                  <div className="absolute inset-0 animate-pulse bg-muted" />
                )}
                {busy === template.id && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                    <Loader2Icon className="h-5 w-5 animate-spin" />
                  </div>
                )}
              </div>
              <div className="p-2.5">
                <div className="text-xs font-semibold">{template.name}</div>
                <div className="text-[11px] leading-snug text-muted-foreground">{template.hint}</div>
              </div>
            </button>
          ))}
        </div>
        {mine.length > 0 && (
          <div className="mt-2 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your templates</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {mine.map((template) => (
                <MyTemplateCard
                  key={template.id}
                  template={template}
                  busy={busy}
                  onPick={() => void pick(template.id, { kind: 'mine', template })}
                  onDelete={async () => {
                    await deleteMyTemplate(template.id);
                    setMine(await listMyTemplates());
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MyTemplateCard({ template, busy, onPick, onDelete }: { template: MyTemplate; busy: string | null; onPick: () => void; onDelete: () => Promise<void> }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!template.thumb) return;
    const next = URL.createObjectURL(new Blob([template.thumb], { type: template.thumbType ?? 'image/jpeg' }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [template]);
  const aspect = template.scene.format.width / template.scene.format.height;
  return (
    <div className={cn('group relative flex flex-col overflow-hidden rounded-xl border transition-colors hover:border-primary', busy !== null && 'opacity-60')}>
      <button type="button" onClick={onPick} disabled={busy !== null} className="text-left" aria-label={`Your template ${template.name}`}>
        <div className="relative w-full bg-muted" style={{ aspectRatio: `${aspect}` }}>
          {url && <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        </div>
        <div className="p-2.5 pr-9">
          <div className="truncate text-xs font-semibold">{template.name}</div>
          <div className="text-[11px] text-muted-foreground">Your screenshots go where its pictures are</div>
        </div>
      </button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="absolute bottom-2 right-1.5 h-7 w-7 text-muted-foreground opacity-70 hover:text-destructive group-hover:opacity-100"
        aria-label={`Delete your template ${template.name}`}
        title="Delete this template"
        data-touch-reveal
        onClick={() => void onDelete()}
      >
        <Trash2Icon className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
