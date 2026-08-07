"use client";

import React, { useMemo } from 'react';
import { ChevronLeft, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Project } from '@/types/artboard';
import {
  buildTemplateCatalog,
  countDeviceSlots,
  rankTemplatesByDeviceFit,
} from '@/lib/ai/templateCatalog';
import type { UploadedScreenshot } from '@/lib/ai/imageUtils';
import { withBasePath } from '@/lib/basePath';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';

interface TemplateProposal {
  template: Project;
  slots: number;
  artboards: number;
}

interface TemplateProposalPickerProps {
  templates: Project[];
  screenshots: UploadedScreenshot[];
  busy?: boolean;
  onPick: (template: Project) => void;
  onBack?: () => void;
}

/**
 * The no-AI auto-design offer: rank the agent-usable templates by how well
 * their device frames fit the screenshot batch and show the top three. The
 * user picks one and the deterministic builder places the screenshots in its
 * frames, so this never needs a model, a key, or a network call.
 */
export function TemplateProposalPicker({
  templates,
  screenshots,
  busy = false,
  onPick,
  onBack,
}: TemplateProposalPickerProps) {
  const t = useT();
  const proposals = useMemo<TemplateProposal[]>(() => {
    if (screenshots.length === 0) return [];
    const byId = new Map(templates.map((template) => [template.id, template]));
    // buildTemplateCatalog already filters to agent-usable templates, which
    // excludes App Preview video templates (their frames take recordings).
    return rankTemplatesByDeviceFit(buildTemplateCatalog(templates), screenshots.length)
      .map((entry) => {
        const template = byId.get(entry.id);
        return template
          ? { template, slots: countDeviceSlots(entry), artboards: entry.artboards.length }
          : null;
      })
      .filter((proposal): proposal is TemplateProposal => proposal !== null && proposal.slots > 0)
      .slice(0, 3);
  }, [templates, screenshots.length]);

  const count = screenshots.length;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2 h-8 w-8 shrink-0"
            onClick={onBack}
            disabled={busy}
            aria-label={t('common.back')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold">{t('proposal.title')}</h3>
          <p className="text-sm text-muted-foreground">
            {count === 1
              ? t('proposal.placeOne')
              : t('proposal.placeMany', { count })}
          </p>
        </div>
      </div>

      {count > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {screenshots.map((shot) => (
            <li key={shot.id}>
              {/* Plain img: these are in-memory data URLs, not routed assets. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={shot.aiDataUrl}
                alt={shot.fileName}
                title={shot.fileName}
                className="h-12 w-auto rounded border"
              />
            </li>
          ))}
        </ul>
      )}

      {count === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('proposal.addOneFirst')}
        </p>
      ) : proposals.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('proposal.noTemplates')}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {proposals.map(({ template, slots, artboards }) => {
            const fitsAll = slots >= count;
            const fitLine = fitsAll
              ? count === 1
                ? t('proposal.fitsOne')
                : t('proposal.fitsAll', { count })
              : t('proposal.placesSome', { slots, count });
            const isPlaceholder = !template.previewImage || template.previewImage.includes('placehold.co');
            return (
              <button
                key={template.id}
                type="button"
                disabled={busy}
                onClick={() => onPick(template)}
                className="group flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg disabled:pointer-events-none disabled:opacity-60"
              >
                <div className="relative w-full overflow-hidden bg-muted" style={{ aspectRatio: '3 / 1' }}>
                  {isPlaceholder ? (
                    <div className="flex h-full items-center justify-center">
                      <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                    </div>
                  ) : (
                    /* Plain img: template previews are static public assets. */
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={withBasePath(template.previewImage)}
                      alt=""
                      className="absolute inset-0 h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  )}
                  {busy && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <p className="text-sm font-semibold leading-tight">{template.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {slots === 1
                      ? t('proposal.framesOne', { count: slots })
                      : t('proposal.framesMany', { count: slots })}
                    {', '}
                    {artboards === 1
                      ? t('proposal.boardsOne', { count: artboards })
                      : t('proposal.boardsMany', { count: artboards })}
                  </p>
                  <p className={cn('text-xs', fitsAll ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-500')}>
                    {fitLine}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
