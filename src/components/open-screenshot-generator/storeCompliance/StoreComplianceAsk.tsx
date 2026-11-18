"use client";

// Ask AI in the Store compliance view: questions about the rules, the store's
// message after a rejection, and a check of the open project's screenshots
// and the store page against the playbook. The same AI as Growth answers
// (the picker sets Growth's one AI setting), and the conversation lives in
// chat.ts, so it outlives this screen. With the app's code folder added
// (StoreComplianceCodeFolder.tsx), Claude Code reads the code for all three.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  ClipboardCheckIcon,
  FileCode2Icon,
  FileTextIcon,
  ImageIcon,
  Loader2Icon,
  MessageSquareWarningIcon,
  SparklesIcon,
  SquareIcon,
  SquarePenIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { openExternal } from '@/lib/desktop';
import { readListing } from '@/lib/growth/db';
import { getGrowthSettings, setGrowthSettings, useGrowthSettings } from '@/lib/growth/settings';
import type { ListingSnapshot } from '@/lib/growth/types';
import { APP_TRAITS, checkRules, type AppTrait, type CheckResult } from '@/lib/storeCompliance/ai';
import { askRulesQuestion, newRulesChat, runRulesCheck, stopRulesChat, useRulesChat, type ChatEntry } from '@/lib/storeCompliance/chat';
import { artboardPlaces, MAX_PASTED, pastedPlace, storePagePlaces } from '@/lib/storeCompliance/places';
import { ruleFix, ruleTitle } from '@/lib/storeCompliance/plain';
import { getProjectLocales } from '@/lib/i18n/localization';
import { cn } from '@/lib/utils';
import { AiLogo, AiPicker, type AiChoice } from '../growth/AiPicker';
import { RulesMarkdown, useMarkdown } from './RulesMarkdown';
import { CheckAgain, CodeFolderControl, useCodeFolderState } from './StoreComplianceCodeFolder';
import { CopyButton, DeadlineChip, Gate, PlainText, RuleChip, SeverityBadge, formatAgo, useRulesView } from './StoreComplianceShared';

const STARTERS = [
  'Can I link to my website so people pay there instead?',
  'Do I have to let people delete their account?',
  'What should I write in the notes for the App Store reviewer?',
  'What changes for my app in the next 90 days?',
];

/** What the check form holds between visits to the screen. */
const form: { traits: AppTrait[]; about: string; pasted: string; useArtboards: boolean; useListing: boolean; useCode: boolean } = {
  traits: [],
  about: '',
  pasted: '',
  useArtboards: true,
  useListing: true,
  useCode: true,
};

function Answer({ text }: { text: string }) {
  const view = useRulesView();
  const blocks = useMarkdown(text);
  const rules = useMemo(() => new Map(view.library.rules.map((rule) => [rule.id, rule])), [view.library.rules]);
  const deadlines = useMemo(() => new Map(view.library.deadlines.map((deadline) => [deadline.id, deadline])), [view.library.deadlines]);
  return (
    <RulesMarkdown
      blocks={blocks}
      className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      onLink={(href) => {
        // An answer links only to the web; anything else is left as text.
        if (/^https?:/i.test(href)) void openExternal(href);
      }}
      token={(id) => {
        const rule = rules.get(id);
        if (rule) return <RuleChip rule={rule} onOpen={view.openRule} />;
        const deadline = deadlines.get(id);
        if (deadline) return <DeadlineChip deadline={deadline} onOpen={(deadlineId) => view.goTo('deadlines', { deadline: deadlineId })} />;
        return null;
      }}
    />
  );
}

function CheckCard({ result, projectName }: { result: CheckResult; projectName: string }) {
  const view = useRulesView();
  const rules = new Map(view.library.rules.map((rule) => [rule.id, rule]));
  const findings = result.findings.filter((finding) => rules.has(finding.rule));
  return (
    <div className="overflow-hidden rounded-2xl border bg-card" data-testid="store-compliance-check-result">
      <div className="flex items-start gap-3 border-b bg-muted/30 px-4 py-3">
        <span
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            findings.length === 0 ? 'bg-[hsl(var(--rules-accent))]/15 text-[hsl(var(--rules-accent))]' : 'bg-[hsl(var(--rules-high))]/10 text-[hsl(var(--rules-high))]'
          )}
        >
          {findings.length === 0 ? <CheckCircle2Icon className="h-4 w-4" /> : <ClipboardCheckIcon className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {findings.length === 0
              ? result.code
                ? 'No problems found in your text or code'
                : 'No problems found in your text'
              : `${findings.length} thing${findings.length === 1 ? '' : 's'} to look at`}
          </p>
          <p className="text-xs text-muted-foreground">
            {projectName ? `${projectName}, ` : ''}
            {result.placeCount} place{result.placeCount === 1 ? '' : 's'} read
            {result.code ? ` and the code in ${result.code.name}` : ''}
            {result.skipped ? `, ${result.skipped} left out because there was too much text` : ''}, {formatAgo(result.at)}
            {result.ai ? `, by ${result.ai}` : ''}
          </p>
        </div>
      </div>
      {result.summary && <p className="border-b px-4 py-3 text-sm leading-relaxed">{result.summary}</p>}
      {findings.length > 0 ? (
        <ol className="divide-y">
          {findings.map((finding, index) => {
            const rule = rules.get(finding.rule)!;
            return (
              <li key={`${finding.rule}-${index}`} className="space-y-2 px-4 py-3.5" data-finding={finding.rule}>
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={rule.severity} />
                  <button type="button" className="min-w-0 text-left text-sm font-semibold leading-snug hover:underline" onClick={() => view.openRule(rule.id)}>
                    {ruleTitle(rule)}
                  </button>
                </div>
                {finding.code && (
                  <div className="space-y-1 text-xs" data-code-file={finding.code.file}>
                    <p className="inline-flex min-w-0 max-w-full items-center gap-1 text-muted-foreground">
                      <FileCode2Icon className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 truncate" title={`${finding.code.file}, line ${finding.code.line}`}>
                        {finding.code.file}, line {finding.code.line}
                      </span>
                    </p>
                    {finding.quote && (
                      <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] leading-snug text-foreground">
                        {finding.quote}
                      </pre>
                    )}
                  </div>
                )}
                {finding.place && (
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      {finding.place.id.startsWith('Store page') ? <FileTextIcon className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                      {finding.place.label}
                    </span>
                    {finding.quote && <mark className="rounded bg-[hsl(var(--rules-medium))]/15 px-1.5 py-0.5 font-medium text-foreground">&quot;{finding.quote}&quot;</mark>}
                  </p>
                )}
                {finding.why && <p className="text-sm leading-relaxed text-muted-foreground">{finding.why}</p>}
                {ruleFix(rule) && (
                  <div className="rounded-lg bg-[hsl(var(--rules-accent))]/5 px-3 py-2 text-xs leading-relaxed">
                    <p className="font-semibold text-[hsl(var(--rules-accent))]">How to fix it</p>
                    <PlainText text={ruleFix(rule)} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {result.code
            ? "AI can miss things. Go through the checklist too. Most rejections come from things like a demo login or your privacy answers."
            : 'AI only reads text. Go through the checklist too. Most rejections come from things like a demo login or your privacy answers.'}
        </p>
      )}
    </div>
  );
}

function Entry({ entry }: { entry: ChatEntry }) {
  const view = useRulesView();
  if (entry.kind === 'question') {
    return (
      <div className="flex flex-col items-end gap-1">
        {entry.rejected && <span className="text-[11px] font-medium text-muted-foreground">The store&apos;s message</span>}
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm leading-relaxed">{entry.text}</p>
      </div>
    );
  }
  if (entry.kind === 'answer') {
    const plain = entry.text.replace(/\s*\[[A-Z][A-Z0-9]*(?:-[A-Z0-9.()]+)+\]/g, '');
    // After a rejection the answer ends with a reply for the reviewer, which gets a copy button of its own.
    const reply = plain.split(/^\W*reply to the reviewer:\W*$/im)[1]?.trim();
    return (
      <div className="flex gap-3" data-testid="store-compliance-answer">
        <AiLogo choice={view.ai.inUse} tile className="h-7 w-7 shrink-0" />
        <div className="min-w-0 flex-1">
          <Answer text={entry.text} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {reply && <CopyButton text={reply} label="Copy the reply" className="h-7" />}
            <CopyButton text={plain} label="Copy" className="h-6 border-0 px-2 text-muted-foreground shadow-none" />
            {entry.ai && <span className="text-[11px] text-muted-foreground">Written by {entry.ai}</span>}
          </div>
        </div>
      </div>
    );
  }
  if (entry.kind === 'check') return <CheckCard result={entry.result} projectName={entry.projectName} />;
  return (
    <p className="flex items-start gap-2 rounded-xl border border-[hsl(var(--rules-medium))]/30 bg-[hsl(var(--rules-medium))]/10 px-3 py-2.5 text-sm" role="alert">
      <CircleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--rules-medium))]" />
      {entry.text}
    </p>
  );
}

function CheckForm({ onClose }: { onClose: () => void }) {
  const view = useRulesView();
  const project = useMemo(() => view.readProject(), [view]);
  const [traits, setTraits] = useState<AppTrait[]>(form.traits);
  const [about, setAbout] = useState(form.about);
  const [pasted, setPasted] = useState(form.pasted);
  const [useArtboards, setUseArtboards] = useState(form.useArtboards);
  const [useListing, setUseListing] = useState(form.useListing);
  const [useCode, setUseCode] = useState(form.useCode);
  const [listing, setListing] = useState<ListingSnapshot | null>(null);
  const code = useCodeFolderState();
  const readsCode = code.readsCode && useCode;

  useEffect(() => {
    Object.assign(form, { traits, about, pasted, useArtboards, useListing, useCode });
  }, [traits, about, pasted, useArtboards, useListing, useCode]);

  useEffect(() => {
    const appId = getGrowthSettings().appId;
    if (!appId) return;
    let live = true;
    void readListing(appId)
      .then((found) => live && setListing(found ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const artboardText = useMemo(() => artboardPlaces(project.artboards), [project.artboards]);
  const artboards = artboardText.places;
  // What doesn't fit in one check, said on the form rather than left out quietly.
  const skipped = artboardText.skipped;
  const languages = 1 + getProjectLocales(project.artboards).length;
  const boardsWithText = new Set(artboards.map((place) => place.id.split(' ')[0])).size;
  const listingPlaces = storePagePlaces(listing);
  const listingName = listing?.locales.find((entry) => entry.locale === listing.primaryLocale)?.name ?? listing?.locales[0]?.name ?? '';
  const ruleCount = checkRules(view.library, view.stores, readsCode).length;
  const running = useRulesChat().running;

  const run = () => {
    const places = [...(useArtboards ? artboards : []), ...(listing && useListing ? listingPlaces : pastedPlace(pasted))];
    onClose();
    void runRulesCheck(
      { stores: view.stores, traits, about, places, skipped: useArtboards ? skipped.length : 0, code: readsCode ? code.folder : null },
      { library: view.library, ai: view.ai.label, projectId: project.id, projectName: project.name }
    );
  };

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm" data-testid="store-compliance-check-form">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--rules-accent))]/10 text-[hsl(var(--rules-accent))]">
          <ClipboardCheckIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Check my app</p>
          <p className="text-xs text-muted-foreground">
            AI checks your app against {ruleCount} rules for {view.stores.length === 2 ? 'the App Store and Google Play' : view.stores[0] === 'apple' ? 'the App Store' : 'Google Play'}.
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close the check" title="Close">
          <XIcon className="h-4 w-4" />
        </Button>
      </div>

      <p className="mb-2 text-xs font-medium">What does your app have?</p>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {APP_TRAITS.map((trait) => {
          const on = traits.includes(trait.id);
          return (
            <button
              key={trait.id}
              type="button"
              aria-pressed={on}
              onClick={() => setTraits(on ? traits.filter((id) => id !== trait.id) : [...traits, trait.id])}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                on ? 'border-[hsl(var(--rules-accent))] bg-[hsl(var(--rules-accent))]/10 font-medium text-[hsl(var(--rules-accent))]' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {trait.label}
            </button>
          );
        })}
      </div>

      <label className="mb-1.5 block text-xs font-medium" htmlFor="rules-check-about">
        What does it do? <span className="font-normal text-muted-foreground">Optional</span>
      </label>
      <Textarea
        id="rules-check-about"
        value={about}
        onChange={(event) => setAbout(event.target.value)}
        placeholder="For example: a habit tracker with a free plan and a paid one"
        className="mb-4 min-h-[60px] font-sans text-sm"
        maxLength={2000}
      />

      <p className="mb-2 text-xs font-medium">What the AI reads</p>
      <div className="mb-4 space-y-2">
        <label className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm', artboards.length === 0 && 'opacity-60')}>
          <input type="checkbox" className="mt-1 accent-[hsl(var(--rules-accent))]" checked={useArtboards && artboards.length > 0} disabled={artboards.length === 0} onChange={(event) => setUseArtboards(event.target.checked)} />
          <span>
            <span className="block">{artboards.length === 0 ? 'Your screenshots have no text to read' : `The text on ${boardsWithText} artboard${boardsWithText === 1 ? '' : 's'}${languages > 1 ? `, in ${languages} languages` : ''}`}</span>
            {project.name && <span className="block text-xs text-muted-foreground">From {project.name}</span>}
            {useArtboards && skipped.length > 0 && (
              <span className="mt-1 block text-xs text-[hsl(var(--rules-medium))]" data-testid="store-compliance-check-skipped">
                That&apos;s more text than one check can read, so the AI skips{' '}
                {skipped.length <= 3 ? skipped.join('; ') : `${skipped.slice(0, 3).join('; ')} and ${skipped.length - 3} more`}
              </span>
            )}
          </span>
        </label>
        {listing && listingPlaces.length > 0 ? (
          <label className="flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm">
            <input type="checkbox" className="mt-1 accent-[hsl(var(--rules-accent))]" checked={useListing} onChange={(event) => setUseListing(event.target.checked)} />
            <span>
              <span className="block">Your store page{listingName ? ` for ${listingName}` : ''}</span>
              <span className="block text-xs text-muted-foreground">As Growth last read it</span>
            </span>
          </label>
        ) : (
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground" htmlFor="rules-check-pasted">
              Paste your store page text (optional)
            </label>
            <Textarea id="rules-check-pasted" value={pasted} onChange={(event) => setPasted(event.target.value)} className="min-h-[60px] font-sans text-sm" />
            {pasted.trim().length > MAX_PASTED && (
              <p className="mt-1 text-xs text-[hsl(var(--rules-medium))]">The AI reads the first {MAX_PASTED.toLocaleString()} characters of this</p>
            )}
          </div>
        )}
        {code.hidden ? null : code.folder ? (
          <label className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm', !code.readsCode && !code.block && 'opacity-60')}>
            <input
              type="checkbox"
              className="mt-1 accent-[hsl(var(--rules-accent))]"
              checked={readsCode}
              disabled={!code.readsCode}
              onChange={(event) => setUseCode(event.target.checked)}
            />
            <span className="min-w-0">
              <span className="block">Your app&apos;s code in {code.folder.name}</span>
              <span className={cn('block text-xs', code.reason ? 'text-[hsl(var(--rules-medium))]' : 'text-muted-foreground')}>
                {code.reason ?? 'Claude Code reads it on this computer. This can take a few minutes.'}
              </span>
              {code.block && <CheckAgain folder={code.folder} />}
            </span>
          </label>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block">Your app&apos;s code</span>
              <span className="block text-xs text-muted-foreground">Add your app&apos;s folder and Claude Code checks the code too</span>
            </span>
            <CodeFolderControl state={code} addLabel="Add folder" />
          </div>
        )}
      </div>

      <Gate reason={view.ai.reason ?? (running ? 'Wait for the answer that is on its way' : null)}>
        <Button className="w-full gap-1.5 sm:w-auto" onClick={run}>
          <SparklesIcon className="h-4 w-4" />
          Run the check
        </Button>
      </Gate>
    </div>
  );
}

function RejectedForm({ onClose }: { onClose: () => void }) {
  const view = useRulesView();
  const [message, setMessage] = useState('');
  const running = useRulesChat().running;
  const code = useCodeFolderState();
  const send = () => {
    if (!message.trim()) return;
    onClose();
    void askRulesQuestion(message, {
      library: view.library,
      stores: view.stores,
      today: view.today,
      ai: view.ai.label,
      rejected: true,
      code: code.readsCode ? code.folder : null,
    });
  };
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm" data-testid="store-compliance-rejected-form">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--rules-high))]/10 text-[hsl(var(--rules-high))]">
          <MessageSquareWarningIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">I got rejected</p>
          <p className="text-xs text-muted-foreground">Paste the message Apple or Google sent you. The AI finds what's wrong, how to fix it, and writes a reply.</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close" title="Close">
          <XIcon className="h-4 w-4" />
        </Button>
      </div>
      <Textarea
        autoFocus
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Guideline 2.1 - Performance - App Completeness ..."
        aria-label="The message from the store"
        className="mb-3 min-h-[120px] font-sans text-sm"
        maxLength={8000}
      />
      <div className="mb-3">
        <CodeFolderControl state={code} compact />
      </div>
      <Gate reason={view.ai.reason ?? (running ? 'Wait for the answer that is on its way' : !message.trim() ? 'Paste the message first' : null)}>
        <Button className="gap-1.5" onClick={send}>
          <SparklesIcon className="h-4 w-4" />
          Find the fix
        </Button>
      </Gate>
    </div>
  );
}

const RUNNING_WORDS: Record<NonNullable<ReturnType<typeof useRulesChat>['running']>, string> = {
  question: 'Looking through the rules',
  rejection: 'Reading the message and finding the fix',
  check: 'Reading your screenshots against the rules',
};

/** The same, while Claude Code reads the code too, which takes longer. */
const RUNNING_WITH_CODE: Record<NonNullable<ReturnType<typeof useRulesChat>['running']>, string> = {
  question: 'Looking through the rules and your code',
  rejection: 'Reading the message and your code',
  check: 'Reading your screenshots and code. This can take a few minutes',
};

export function StoreComplianceAsk() {
  const view = useRulesView();
  const chat = useRulesChat();
  const [settings] = useGrowthSettings();
  const [mode, setMode] = useState<'check' | 'rejected' | null>(view.options.start ?? null);
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const aiChoice: AiChoice | null = settings.aiWriter && settings.aiWriter !== 'auto' ? settings.aiWriter : view.ai.inUse;
  const code = useCodeFolderState();

  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [chat.entries.length, chat.running, mode]);

  const send = (text: string) => {
    const question = text.trim();
    if (!question || chat.running || view.ai.reason) return;
    setDraft('');
    setMode(null);
    void askRulesQuestion(question, {
      library: view.library,
      stores: view.stores,
      today: view.today,
      ai: view.ai.label,
      code: code.readsCode ? code.folder : null,
    });
  };
  const composerReason = view.ai.reason ?? (chat.running ? 'Wait for the answer that is on its way' : null);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="store-compliance-ask">
      <div className="flex items-center gap-2.5 border-b px-4 py-2.5">
        <AiLogo choice={aiChoice} tile className="h-7 w-7" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">Ask AI</p>
          {view.ai.label && !view.ai.reason ? (
            <p className="truncate text-[11px] text-muted-foreground" data-testid="store-compliance-ai-status">
              Using {view.ai.label}
            </p>
          ) : (
            <p className="truncate text-[11px] text-[hsl(var(--rules-medium))]" title={view.ai.reason ?? undefined} data-testid="store-compliance-ai-status">
              {view.ai.reason ?? 'Looking for Claude Code and Codex'}
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={chat.entries.length === 0 && !mode} onClick={() => { newRulesChat(); setMode(null); }} title="Start a new conversation" aria-label="New chat">
          <SquarePenIcon className="h-4 w-4" />
        </Button>
      </div>
      <div className="border-b px-4 py-2">
        <div className="mx-auto max-w-2xl">
          <AiPicker value={aiChoice} onPick={(choice) => setGrowthSettings({ aiWriter: choice })} title="The AI for Store compliance and Growth, one choice for both" />
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6">
          {chat.entries.length === 0 && !mode && !chat.running && (
            <div className="flex flex-col items-center gap-6 py-4 text-center" data-testid="store-compliance-ask-welcome">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[hsl(var(--rules-accent))] to-[hsl(var(--rules-accent))]/60 text-white shadow-lg shadow-[hsl(var(--rules-accent))]/20 dark:text-background">
                <SparklesIcon className="h-7 w-7" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Will your app pass review?</h2>
                <p className="mt-1 text-sm text-muted-foreground">Ask about a rule, check your app, or get help after a rejection.</p>
              </div>
              <div className="grid w-full gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setMode('check')}
                  className="group flex flex-col gap-1.5 rounded-2xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[hsl(var(--rules-accent))]/40 hover:shadow-md"
                >
                  <ClipboardCheckIcon className="h-5 w-5 text-[hsl(var(--rules-accent))]" />
                  <span className="text-sm font-semibold">Check my app</span>
                  <span className="text-xs text-muted-foreground">AI reads your screenshots and store page and finds problems</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('rejected')}
                  className="group flex flex-col gap-1.5 rounded-2xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[hsl(var(--rules-high))]/40 hover:shadow-md"
                >
                  <MessageSquareWarningIcon className="h-5 w-5 text-[hsl(var(--rules-high))]" />
                  <span className="text-sm font-semibold">I got rejected</span>
                  <span className="text-xs text-muted-foreground">Paste the message you got. Get the fix and a reply.</span>
                </button>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.map((starter) => (
                  <Gate key={starter} reason={view.ai.reason}>
                    <button type="button" onClick={() => send(starter)} className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">
                      {starter}
                    </button>
                  </Gate>
                ))}
              </div>
            </div>
          )}
          {chat.entries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
          {chat.running && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status" data-testid="store-compliance-thinking">
              <Loader2Icon className="h-4 w-4 animate-spin text-[hsl(var(--rules-accent))]" />
              <span className="flex-1">{(chat.readsCode ? RUNNING_WITH_CODE : RUNNING_WORDS)[chat.running]}</span>
              <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={stopRulesChat}>
                <SquareIcon className="h-3 w-3" />
                Stop
              </Button>
            </div>
          )}
          {mode === 'check' && <CheckForm onClose={() => setMode(null)} />}
          {mode === 'rejected' && <RejectedForm onClose={() => setMode(null)} />}
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 pb-4 pt-1">
        {chat.entries.length > 0 && !mode && !chat.running && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button type="button" className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setMode('check')}>
              Check my app
            </button>
            <button type="button" className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setMode('rejected')}>
              I got rejected
            </button>
          </div>
        )}
        <div className="mb-1.5">
          <CodeFolderControl state={code} compact />
        </div>
        <form
          className="relative"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send(draft);
              }
            }}
            placeholder={view.ai.reason ?? 'Ask about a rule, a rejection or a deadline'}
            aria-label="Ask a question"
            disabled={!!view.ai.reason}
            rows={2}
            className="min-h-[52px] resize-none rounded-2xl pr-12 font-sans text-sm"
            maxLength={4000}
          />
          <div className="absolute bottom-2 right-2">
            <Gate reason={composerReason ?? (!draft.trim() ? 'Type a question first' : null)}>
              <Button type="submit" size="icon" className="h-8 w-8 rounded-full" aria-label="Send">
                <ArrowUpIcon className="h-4 w-4" />
              </Button>
            </Gate>
          </div>
        </form>
      </div>
    </div>
  );
}
