"use client";

// The playbook's checklist for the open project: every box to tick before the
// app goes to review, grouped as the playbook groups them, for the stores the
// user picked. As the playbook asks, a box ends either ticked or marked as not
// applying with a one-line reason, and both count as done, except the boxes
// the checklist says every app has (`always`): those can only be ticked. A
// box reads in plain words where the repository has them (plain.ts); the (i)
// beside it shows the playbook's own. A section's plain words leave out a line
// that only points to a guide, so its links show as buttons under them.

import React, { useMemo, useState } from 'react';
import { BookOpenIcon, CheckIcon, ChevronDownIcon, InfoIcon, MinusIcon, RotateCcwIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { checklistItemsFor } from '@/lib/storeCompliance/parse';
import { checkText, groupTitle, introLinks, sectionTitle } from '@/lib/storeCompliance/plain';
import { countsAsDone, DEVICE_LIST, useTicks, type Tick } from '@/lib/storeCompliance/ticks';
import type { ChecklistItem, ChecklistSection } from '@/lib/storeCompliance/types';
import { cn } from '@/lib/utils';
import { InlineMarkdown } from './RulesMarkdown';
import { CHECKLIST_PATH, PlainText, useGuideLinks, useRulesView } from './StoreComplianceShared';

function Item({
  item,
  tick,
  onToggle,
  onNotApplying,
  onAsk,
  onLink,
}: {
  item: ChecklistItem;
  tick: Tick | undefined;
  onToggle: (done: boolean) => void;
  onNotApplying: (reason: string | null) => void;
  onAsk: () => void;
  onLink: (href: string) => void;
}) {
  const [writing, setWriting] = useState(false);
  const [reason, setReason] = useState('');
  const [original, setOriginal] = useState(false);
  const ticked = !!tick && !tick.na;
  // A box every app has never shows as not applying, even from before the checklist said so.
  const skipped = !!tick?.na && !item.always;
  return (
    <li className={cn('group rounded-xl transition-colors', skipped ? 'bg-muted/40' : ticked ? 'bg-[hsl(var(--rules-accent))]/5' : 'hover:bg-muted/40')} data-checklist-item={item.id}>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={skipped ? 'mixed' : ticked}
          aria-label={ticked ? 'Done. Untick' : skipped ? "Doesn't apply. Clear" : 'Tick when done'}
          onClick={() => (skipped ? onNotApplying(null) : onToggle(!ticked))}
          className={cn(
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            ticked && 'scale-100 border-[hsl(var(--rules-accent))] bg-[hsl(var(--rules-accent))] text-white dark:text-background',
            skipped && 'border-muted-foreground/40 bg-muted text-muted-foreground',
            !tick && 'border-muted-foreground/40 hover:border-[hsl(var(--rules-accent))]'
          )}
        >
          {ticked && <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />}
          {skipped && <MinusIcon className="h-3.5 w-3.5" strokeWidth={3} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className={cn('text-sm leading-relaxed', (ticked || skipped) && 'text-muted-foreground')}>
            {item.plain ? (
              <PlainText text={checkText(item)} listClassName="text-[13px] text-muted-foreground" />
            ) : (
              <p>
                <InlineMarkdown text={item.text} onLink={onLink} />
              </p>
            )}
            <span className="mt-1 flex items-center gap-1.5">
              {item.always && (
                <span className="inline-flex rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground" title="Every app must do this one">
                  Every app
                </span>
              )}
              {item.plain && (
                <button
                  type="button"
                  className="inline-flex rounded p-0.5 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
                  onClick={() => setOriginal((value) => !value)}
                  aria-expanded={original}
                  aria-label="Show the original wording"
                  title="Show the original wording"
                >
                  <InfoIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          </div>
          {original && item.plain && (
            <p className="mt-1 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground" data-testid="store-check-original">
              <span className="font-medium text-foreground">Original wording: </span>
              <InlineMarkdown text={item.text} onLink={onLink} />
            </p>
          )}
          {skipped && (
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Doesn&apos;t apply:</span> {tick?.na}
            </p>
          )}
          {writing && (
            <form
              className="mt-2 flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!reason.trim()) return;
                onNotApplying(reason);
                setWriting(false);
                setReason('');
              }}
            >
              <Input
                autoFocus
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why doesn't it apply? For example: no login, so no demo account"
                aria-label="Why the box doesn't apply"
                className="h-8 min-w-[240px] flex-1 text-xs"
                maxLength={200}
              />
              <Button type="submit" size="sm" className="h-8" disabled={!reason.trim()}>
                Save
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setWriting(false)}>
                Cancel
              </Button>
            </form>
          )}
        </div>
        {!ticked && !skipped && !writing && (
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100" data-touch-reveal>
            {!item.always && (
              <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setWriting(true)}>
                Doesn&apos;t apply
              </button>
            )}
            <button
              type="button"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-[hsl(var(--rules-accent))]"
              onClick={onAsk}
              title="Ask AI what this box means and how to check it"
              aria-label="Ask AI about this box"
            >
              <SparklesIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

/** The guides a section's own words link to, kept when its plain words show instead. */
function GuideLinks({ paragraphs, onLink }: { paragraphs: string[]; onLink: (href: string) => void }) {
  const links = introLinks(paragraphs);
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-2 pt-1" data-testid="store-checklist-guides">
      {links.map((link) => (
        <button
          key={link.href}
          type="button"
          onClick={() => onLink(link.href)}
          className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <BookOpenIcon className="h-3.5 w-3.5" />
          {link.label}
        </button>
      ))}
    </div>
  );
}

function Section({
  section,
  ticks,
  hideDone,
  shown,
  onToggle,
  onNotApplying,
  onAsk,
  onLink,
}: {
  section: ChecklistSection;
  ticks: Map<string, Tick>;
  hideDone: boolean;
  shown: Set<string>;
  onToggle: (id: string, done: boolean) => void;
  onNotApplying: (id: string, reason: string | null) => void;
  onAsk: (item: ChecklistItem) => void;
  onLink: (href: string) => void;
}) {
  const groups = section.groups
    .map((group) => ({ ...group, items: group.items.filter((item) => shown.has(item.id)) }))
    .filter((group) => group.items.length > 0);
  const items = groups.flatMap((group) => group.items);
  const done = items.filter((item) => countsAsDone(item, ticks.get(item.id))).length;
  const complete = items.length > 0 && done === items.length;
  const [open, setOpen] = useState(!complete);
  if (items.length === 0) return null;
  const visible = (item: ChecklistItem) => !hideDone || !countsAsDone(item, ticks.get(item.id));
  const remaining = groups.filter((group) => group.items.some(visible));
  return (
    <section className="overflow-hidden rounded-2xl border bg-card" data-checklist-section={section.title}>
      <button type="button" className="flex w-full items-center gap-3 px-4 py-3.5 text-left" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span
          aria-hidden
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
            complete ? 'bg-[hsl(var(--rules-accent))] text-white dark:text-background' : 'bg-muted text-muted-foreground'
          )}
        >
          {complete ? <CheckIcon className="h-4 w-4" strokeWidth={3} /> : items.length - done}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{sectionTitle(section)}</span>
          <span className="block text-xs text-muted-foreground">
            {done} of {items.length} done
          </span>
        </span>
        <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
          <span className="block h-full rounded-full bg-[hsl(var(--rules-accent))] transition-[width] duration-500" style={{ width: `${(done / items.length) * 100}%` }} />
        </span>
        <ChevronDownIcon className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t px-2 pb-3 pt-2">
          {section.plain ? (
            <>
              {section.plain.intro && <PlainText className="px-3 pb-2 pt-1 text-xs leading-relaxed text-muted-foreground" text={section.plain.intro} />}
              <GuideLinks paragraphs={section.intro} onLink={onLink} />
            </>
          ) : (
            section.intro.map((paragraph, index) => (
              <p key={index} className="px-3 pb-2 pt-1 text-xs leading-relaxed text-muted-foreground">
                <InlineMarkdown text={paragraph} onLink={onLink} />
              </p>
            ))
          )}
          {remaining.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">Every box here is done</p>}
          {remaining.map((group) => (
            <div key={group.id} className="mt-1">
              {groupTitle(group) && <p className="px-3 pb-1 pt-3 text-xs font-semibold text-foreground/80">{groupTitle(group)}</p>}
              <ul className="space-y-0.5">
                {group.items.filter(visible).map((item) => (
                  <Item
                    key={item.id}
                    item={item}
                    tick={ticks.get(item.id)}
                    onToggle={(value) => onToggle(item.id, value)}
                    onNotApplying={(reason) => onNotApplying(item.id, reason)}
                    onAsk={() => onAsk(item)}
                    onLink={onLink}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function StoreComplianceChecklist() {
  const view = useRulesView();
  const { library, stores, project } = view;
  const checklist = library.checklist;
  const list = project.id ?? DEVICE_LIST;
  const { ticks, loaded, toggle, markNotApplying, reset } = useTicks(list);
  const [hideDone, setHideDone] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const onLink = useGuideLinks(CHECKLIST_PATH);

  const items = useMemo(() => checklistItemsFor(checklist, stores), [checklist, stores]);
  const shown = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const hidden = useMemo(() => (checklist ? checklistItemsFor(checklist, ['apple', 'google']).length - items.length : 0), [checklist, items.length]);
  const done = items.filter((item) => countsAsDone(item, ticks.get(item.id))).length;

  if (!checklist) {
    return <p className="p-6 text-sm text-muted-foreground">The playbook on GitHub has no checklist right now.</p>;
  }

  const otherStore = stores.length === 1 ? (stores[0] === 'apple' ? 'Google Play' : 'App Store') : null;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 md:p-6" data-testid="store-compliance-checklist">
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">Before you send your app for review</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {project.name ? (
                <>
                  For <span className="font-medium text-foreground">{project.name}</span>. Each project has its own checklist.
                </>
              ) : (
                'Saved on this computer.'
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums tracking-tight" data-testid="store-compliance-checklist-count">
              {done}
              <span className="text-base font-normal text-muted-foreground"> of {items.length}</span>
            </p>
            <p className="text-xs text-muted-foreground">done</p>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--rules-accent))]/70 to-[hsl(var(--rules-accent))] transition-[width] duration-700 ease-out" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            <Switch checked={hideDone} onCheckedChange={setHideDone} aria-label="Hide done boxes" />
            Hide done boxes
          </label>
          {otherStore && hidden > 0 && <span>{hidden === 1 ? `1 box only for ${otherStore} is hidden` : `${hidden} boxes only for ${otherStore} are hidden`}</span>}
          <span className="ml-auto flex items-center gap-2">
            {confirmReset ? (
              <>
                <span className="text-foreground">Untick every box?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  onClick={() => {
                    void reset();
                    setConfirmReset(false);
                  }}
                >
                  Untick all
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmReset(false)}>
                  Keep them
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" disabled={done === 0} onClick={() => setConfirmReset(true)} title="Untick everything, for your next version">
                <RotateCcwIcon className="h-3.5 w-3.5" />
                Start over
              </Button>
            )}
          </span>
        </div>
      </div>

      {loaded &&
        checklist.sections.map((section) => (
          <Section
            key={section.id}
            section={section}
            ticks={ticks}
            hideDone={hideDone}
            shown={shown}
            onToggle={toggle}
            onNotApplying={markNotApplying}
            onAsk={(item) => view.ask(`What does this check mean, and how do I check it for my app? "${checkText(item)}"`)}
            onLink={onLink}
          />
        ))}
    </div>
  );
}
