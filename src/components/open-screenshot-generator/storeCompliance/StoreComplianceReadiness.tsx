"use client";

// Test like a reviewer: the checks a reviewer makes on the version they get,
// which no scan of the code can prove (readiness.ts). Each one is answered
// Yes, No or Doesn't apply with a reason, per project, with the day it was
// tried, and an answer older than 30 days asks to be tried again. The answers
// can leave as the playbook's `.app-review-readiness.json`, which its guard
// reads before an upload in Claude Code, Codex and the other AI tools.

import React, { useMemo, useState } from 'react';
import { CheckIcon, ClipboardCopyIcon, DownloadIcon, FileTextIcon, InfoIcon, MinusIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { isTauri, saveBlobToDisk } from '@/lib/desktop';
import {
  READINESS_FILE_NAME,
  READINESS_MAX_AGE,
  dayOf,
  readinessChecks,
  readinessFileText,
  summarize,
  useReadiness,
  type ReadinessCheck,
  type ReadinessMark,
  type ReadinessRecord,
  type ReadinessValue,
} from '@/lib/storeCompliance/readiness';
import { daysUntil } from '@/lib/storeCompliance/search';
import { DEVICE_LIST } from '@/lib/storeCompliance/ticks';
import { cn } from '@/lib/utils';
import { RulesMarkdown, useMarkdown } from './RulesMarkdown';
import { CopyButton, useGuideLinks, useRulesView } from './StoreComplianceShared';

const REVIEW_NOTES_PATH = 'templates/REVIEW-NOTES-TEMPLATE.md';

/** "today", "yesterday", "3 days ago": when an answer was given. */
function whenTried(at: number, today: string): string {
  const days = Math.max(0, daysUntil(today, dayOf(at) < today ? dayOf(at) : today));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function Answer({ value, on, title, onClick, children }: { value: ReadinessValue; on: boolean; title?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={title}
      data-readiness-answer={value}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors',
        on && value === 'pass' && 'bg-[hsl(var(--rules-accent))] font-medium text-white shadow-sm dark:text-background',
        on && value === 'fail' && 'bg-[hsl(var(--rules-critical))] font-medium text-white shadow-sm',
        on && value === 'na' && 'bg-background font-medium text-foreground shadow-sm',
        !on && 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

function CheckCard({
  check,
  mark,
  today,
  onAnswer,
  onClear,
  onNotes,
}: {
  check: ReadinessCheck;
  mark: ReadinessMark | undefined;
  today: string;
  onAnswer: (value: ReadinessValue, note?: string) => void;
  onClear: () => void;
  onNotes: (() => void) | null;
}) {
  const [writing, setWriting] = useState(false);
  const [reason, setReason] = useState('');
  // "Doesn't apply" where the guard doesn't take it, saved before the playbook said so, is still to do.
  const value = mark && (mark.value !== 'na' || check.naAllowed) ? mark.value : null;
  const age = mark ? daysUntil(today, dayOf(mark.at) < today ? dayOf(mark.at) : today) : 0;
  const old = !!value && age > READINESS_MAX_AGE;
  // The answer already given: an old one, given again, counts from today; a fresh one is taken back.
  const pick = (next: ReadinessValue) => {
    if (value === next) {
      if (old) onAnswer(next, mark?.note);
      else onClear();
    } else if (next === 'na') {
      setWriting(true);
    } else {
      onAnswer(next);
    }
  };
  const again = (next: ReadinessValue) => (value === next && old ? 'Give the same answer for today' : undefined);
  return (
    <li
      className={cn(
        'rounded-xl border bg-card p-4 transition-colors',
        value === 'pass' && !old && 'border-[hsl(var(--rules-accent))]/30',
        value === 'fail' && 'border-[hsl(var(--rules-critical))]/40 bg-[hsl(var(--rules-critical))]/5'
      )}
      data-readiness-check={check.key}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
            value === 'pass' && 'bg-[hsl(var(--rules-accent))] text-white dark:text-background',
            value === 'fail' && 'bg-[hsl(var(--rules-critical))] text-white',
            value === 'na' && 'bg-muted text-muted-foreground',
            !value && 'border-2 border-dashed border-muted-foreground/40'
          )}
        >
          {value === 'pass' && <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />}
          {value === 'fail' && <XIcon className="h-3.5 w-3.5" strokeWidth={3} />}
          {value === 'na' && <MinusIcon className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{check.title}</p>
          {check.how && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{check.how}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div role="group" aria-label={check.title} className="flex rounded-lg border bg-muted/40 p-0.5">
              <Answer value="pass" on={value === 'pass'} title={again('pass')} onClick={() => pick('pass')}>
                Yes
              </Answer>
              <Answer value="fail" on={value === 'fail'} title={again('fail')} onClick={() => pick('fail')}>
                No
              </Answer>
              {check.naAllowed && (
                <Answer value="na" on={value === 'na'} title={again('na')} onClick={() => pick('na')}>
                  Doesn&apos;t apply
                </Answer>
              )}
            </div>
            {!check.naAllowed && (
              <span className="inline-flex rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground" title="Every app has privacy answers, so this one always applies">
                Every app
              </span>
            )}
            {onNotes && (
              <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={onNotes}>
                <FileTextIcon className="h-3.5 w-3.5" />
                See what to write
              </Button>
            )}
          </div>
          {writing && (
            <form
              className="mt-2 flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!reason.trim()) return;
                onAnswer('na', reason.trim().slice(0, 200));
                setWriting(false);
                setReason('');
              }}
            >
              <Input
                autoFocus
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={check.naExample ? `Why doesn't it apply? For example: ${check.naExample}` : "Why doesn't it apply?"}
                aria-label="Why the check doesn't apply"
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
          {mark && value && !writing && (
            <p className={cn('mt-2 text-xs', old ? 'font-medium text-[hsl(var(--rules-high))]' : 'text-muted-foreground')} data-testid="store-readiness-when">
              {value === 'na' ? (
                <>
                  <span className="font-medium text-foreground">Doesn&apos;t apply:</span> {mark.note}
                  {old && <span className="block">Said {whenTried(mark.at, today)}. Check it still doesn&apos;t apply to the version you&apos;re sending</span>}
                </>
              ) : old ? (
                `Tried ${whenTried(mark.at, today)}. Try it again on the version you're sending`
              ) : value === 'fail' ? (
                `Didn't work ${whenTried(mark.at, today)}. Fix this before you send your app`
              ) : (
                `Worked ${whenTried(mark.at, today)}`
              )}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * The template's parts: the text block to paste, and the advice after it. The
 * words before the block are for developers (fastlane, the credits file), so
 * they stay in the playbook. Without a block, the whole file is the notes.
 */
export function reviewNotesParts(source: string): { notes: string; after: string } {
  const block = /```(?:text)?[^\n]*\n([\s\S]*?)```/.exec(source);
  if (!block) return { notes: source.trim(), after: '' };
  return { notes: block[1].replace(/\s+$/, ''), after: source.slice((block.index ?? 0) + block[0].length).trim() };
}

function ReviewNotesSheet({ open, source, onClose }: { open: boolean; source: string; onClose: () => void }) {
  const { notes, after } = reviewNotesParts(source);
  const blocks = useMarkdown(after);
  const onLink = useGuideLinks(REVIEW_NOTES_PATH);
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl" data-testid="store-review-notes">
        <SheetHeader className="space-y-1 border-b p-5 pr-12 text-left">
          <SheetTitle className="text-lg leading-snug">What to write in your review notes</SheetTitle>
          <SheetDescription className="text-xs">
            Paste the notes into App Review Information in App Store Connect, then fill in each part
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap gap-2 border-b px-5 py-3">
          <CopyButton text={notes} label="Copy the notes" />
        </div>
        <div className="space-y-4 p-5 text-sm">
          <pre className="whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed text-foreground" data-testid="store-review-notes-text">
            {notes}
          </pre>
          {after && <RulesMarkdown blocks={blocks} onLink={onLink} className="[&_h2:first-child]:mt-0" />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FileCard({ record, checks, today, onEnforce }: { record: ReadinessRecord; checks: ReadinessCheck[]; today: string; onEnforce: (on: boolean) => void }) {
  const [saved, setSaved] = useState(false);
  const [info, setInfo] = useState(false);
  const answered = Object.keys(record.marks).length > 0;
  const text = readinessFileText(record, checks, today);
  const desktop = isTauri();
  return (
    <section className="rounded-2xl border bg-card p-5" aria-labelledby="store-readiness-file-title" data-testid="store-readiness-file">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 id="store-readiness-file-title" className="text-sm font-semibold">
            For your AI coding tool
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Using Claude Code, Codex or another AI tool with the playbook&apos;s guard? Put these answers in your app&apos;s code folder, and the guard stops an upload while one says No.
          </p>
        </div>
        <button
          type="button"
          className="rounded p-0.5 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
          onClick={() => setInfo((value) => !value)}
          aria-expanded={info}
          aria-label="More about the file"
          title="More about the file"
        >
          <InfoIcon className="h-4 w-4" />
        </button>
      </div>
      {info && (
        <div className="mt-3 space-y-1.5 rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground" data-testid="store-readiness-file-info">
          <p>
            The file is called <code className="rounded bg-background px-1 font-mono text-[11px] text-foreground">{READINESS_FILE_NAME}</code>, with a dot at the start. It goes in the folder you point the guard at.
          </p>
          {!desktop && <p>A download loses the dot, so add it back. Or copy the text, paste it to your AI tool and ask it to save the file in your app&apos;s folder.</p>}
          <p>The guard counts the answers as old once the oldest is more than {READINESS_MAX_AGE} days old.</p>
        </div>
      )}
      <label className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Switch checked={record.enforce} onCheckedChange={onEnforce} aria-label="Also stop the upload while a check isn't done" />
        Also stop the upload while a check isn&apos;t done
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className={cn('inline-flex', !answered && 'cursor-not-allowed')} title={answered ? undefined : 'Answer a check first'}>
          <Button
            size="sm"
            className="h-8 gap-1.5"
            disabled={!answered}
            onClick={() => {
              void saveBlobToDisk(new Blob([text], { type: 'application/json' }), desktop ? READINESS_FILE_NAME : READINESS_FILE_NAME.slice(1))
                .then((path) => {
                  if (path === null) return;
                  setSaved(true);
                  window.setTimeout(() => setSaved(false), 1600);
                })
                .catch((error) => console.error('Saving the readiness file failed', error));
            }}
          >
            {saved ? <CheckIcon className="h-3.5 w-3.5" /> : <DownloadIcon className="h-3.5 w-3.5" />}
            {saved ? 'Saved' : desktop ? 'Save the file' : 'Download the file'}
          </Button>
        </span>
        {answered ? (
          <CopyButton text={text} label="Copy the file" className="h-8" />
        ) : (
          <span className="inline-flex cursor-not-allowed" title="Answer a check first">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled>
              <ClipboardCopyIcon className="h-3.5 w-3.5" />
              Copy the file
            </Button>
          </span>
        )}
      </div>
    </section>
  );
}

export function StoreComplianceReadiness() {
  const view = useRulesView();
  const { library, project, today } = view;
  const list = project.id ?? DEVICE_LIST;
  const { record, loaded, change } = useReadiness(list);
  const checks = useMemo(() => readinessChecks(library.readinessChecks), [library.readinessChecks]);
  const summary = summarize(record, checks, today);
  const [notesOpen, setNotesOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [build, setBuild] = useState<string | null>(null);

  const answer = (key: string, value: ReadinessValue, note?: string) =>
    change((current) => ({ ...current, marks: { ...current.marks, [key]: { value, at: Date.now(), ...(note ? { note } : {}) } } }));
  const clear = (key: string) =>
    change((current) => {
      const marks = { ...current.marks };
      delete marks[key];
      return { ...current, marks };
    });
  const saveBuild = () => {
    if (build === null) return;
    const next = build.trim().slice(0, 80);
    setBuild(null);
    if (next !== record.build) change((current) => ({ ...current, build: next }));
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 md:p-6" data-testid="store-compliance-readiness">
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">Test your app like a reviewer</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Apple and Google try these on the version you send. Try them yourself first{project.name ? (
                <>
                  , then say how it went for <span className="font-medium text-foreground">{project.name}</span>
                </>
              ) : (
                ', then say how it went'
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums tracking-tight" data-testid="store-readiness-count">
              {summary.done}
              <span className="text-base font-normal text-muted-foreground"> of {summary.total}</span>
            </p>
            <p className="text-xs text-muted-foreground">done</p>
          </div>
        </div>
        <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full bg-[hsl(var(--rules-accent))] transition-[width] duration-700 ease-out" style={{ width: `${(summary.done / Math.max(1, summary.total)) * 100}%` }} />
          <div className="h-full bg-[hsl(var(--rules-critical))] transition-[width] duration-700 ease-out" style={{ width: `${(summary.failed / Math.max(1, summary.total)) * 100}%` }} />
        </div>
        {(summary.failed > 0 || summary.old > 0) && (
          <ul className="mt-3 space-y-1 text-xs" data-testid="store-readiness-warnings">
            {summary.failed > 0 && (
              <li className="font-medium text-[hsl(var(--rules-critical))]">
                {summary.failed === 1 ? "1 check didn't work. Fix it before you send your app" : `${summary.failed} checks didn't work. Fix them before you send your app`}
              </li>
            )}
            {summary.old > 0 && (
              <li className="font-medium text-[hsl(var(--rules-high))]">
                {summary.old === 1
                  ? `1 answer is more than ${READINESS_MAX_AGE} days old. Try it again on the version you're sending`
                  : `${summary.old} answers are more than ${READINESS_MAX_AGE} days old. Try them again on the version you're sending`}
              </li>
            )}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            Version you tried
            <Input
              value={build ?? record.build}
              onChange={(event) => setBuild(event.target.value)}
              onBlur={saveBuild}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
              }}
              placeholder="1.2 (14)"
              aria-label="Version you tried"
              maxLength={80}
              disabled={!loaded}
              className="h-7 w-32 text-xs"
            />
          </label>
          <span className="ml-auto flex items-center gap-2">
            {confirmReset ? (
              <>
                <span className="text-foreground">Clear every answer?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  onClick={() => {
                    change((current) => ({ ...current, build: '', marks: {} }));
                    setBuild(null);
                    setConfirmReset(false);
                  }}
                >
                  Clear them
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmReset(false)}>
                  Keep them
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-xs"
                disabled={Object.keys(record.marks).length === 0 && !record.build}
                onClick={() => setConfirmReset(true)}
                title="Clear every answer, for your next version"
              >
                <RotateCcwIcon className="h-3.5 w-3.5" />
                Start over
              </Button>
            )}
          </span>
        </div>
      </div>

      {loaded && (
        <ul className="space-y-2" aria-label="The checks a reviewer makes">
          {checks.map((check) => (
            <CheckCard
              key={check.key}
              check={check}
              mark={record.marks[check.key]}
              today={today}
              onAnswer={(value, note) => answer(check.key, value, note)}
              onClear={() => clear(check.key)}
              onNotes={check.key === 'review_notes' && library.reviewNotes ? () => setNotesOpen(true) : null}
            />
          ))}
        </ul>
      )}

      {loaded && <FileCard record={record} checks={checks} today={today} onEnforce={(on) => change((current) => ({ ...current, enforce: on }))} />}

      {library.reviewNotes && <ReviewNotesSheet open={notesOpen} source={library.reviewNotes} onClose={() => setNotesOpen(false)} />}
    </div>
  );
}
