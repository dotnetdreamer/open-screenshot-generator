"use client";

// The review inbox: every written review of one app, or of all the user's
// apps on both stores, with what still needs an answer first.
//
// A review is to do, replied, or marked done without a reply (reviewInbox.ts).
// Tags and that mark are the user's own and live beside the reviews; the
// reply goes to the store. A reply is public (Apple checks it before it
// shows, Google Play shows it at once), so nothing here sends one without a
// click on Send: the AI or a template fills the box, the person edits it.
// Google Play does not say where a reviewer is, so its reviews are filtered
// and named by the reviewer's language instead, and its API has no way to
// delete a reply.
//
// The keys J and K move between the reviews, R opens the reply box, E marks
// a review as done and X selects it, so a person can work through a long
// list without the mouse.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckIcon,
  DownloadIcon,
  FileTextIcon,
  LanguagesIcon,
  Loader2Icon,
  MessageSquareIcon,
  MessageSquareReplyIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  TagIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { saveBlobToDisk } from '@/lib/desktop';
import { suggestReply, translateText, type ReplyTone } from '@/lib/growth/ai';
import { MAX_REPLY_LENGTH, deleteReviewReply, replyToReview } from '@/lib/growth/asc';
import { formatDay, today } from '@/lib/growth/dates';
import { updateReviewMarks, writeReview } from '@/lib/growth/db';
import { formatAgo, formatExact } from '@/lib/growth/format';
import { MAX_PLAY_REPLY_LENGTH, replyToPlayReview } from '@/lib/growth/play';
import {
  DEFAULT_FILTER,
  SORT_LABELS,
  STATUS_LABELS,
  changeAfterReply,
  fillTemplate,
  filterReviews,
  markedDone,
  placeName,
  placeOf,
  reviewerName,
  reviewsCsv,
  sortTemplates,
  statusCounts,
  statusOf,
  tagColor,
  templateName,
  toggledTag,
  versionsOf,
  withTag,
  writeTags,
  writeTemplates,
  type PeriodFilter,
  type ReviewFilter,
  type ReviewSort,
  type ReviewStatus,
  type StarFilter,
} from '@/lib/growth/reviewInbox';
import { REVIEW_TOPIC_LABELS, reviewDay, topicCounts, topicsOf, type ReviewTopic } from '@/lib/growth/reviewTopics';
import { isPlayApp } from '@/lib/growth/stores';
import { listingLanguageFor, listingLanguageName, territoryName } from '@/lib/growth/territories';
import type { ReplyTemplate, ReviewMark, ReviewTag, StoreReview } from '@/lib/growth/types';
import { useReviewInbox, type ReviewInboxData } from '@/lib/growth/useReviewInbox';
import { cn } from '@/lib/utils';
import { InfoTip } from '../capture/InfoTip';
import { EmptyState, Gated, Panel, SectionTitle, StoreImage, Stars, useGrowthView, type GrowthView } from './GrowthShared';

const PAGE = 40;

type Scope = 'app' | 'every';

function readerLanguage(): string {
  try {
    const code = (typeof navigator !== 'undefined' ? navigator.language : 'en').split('-')[0];
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? 'English';
  } catch {
    return 'English';
  }
}

/** A key press meant for a box being typed in, or for a menu that is open, is not a shortcut. */
function typingOrMenu(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')) return true;
  return !!document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"]');
}

export function GrowthReviews() {
  const view = useGrowthView();
  const options = view.tabOptions;
  const everyApp = view.apps.filter((entry) => entry.id);
  const [scope, setScope] = useState<Scope>('app');
  const appIds = useMemo(
    () => (scope === 'every' && everyApp.length > 1 ? everyApp.map((entry) => entry.id) : view.app.id ? [view.app.id] : []),
    // The ids are what matter, not the objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, everyApp.map((entry) => entry.id).join(','), view.app.id]
  );
  const inbox = useReviewInbox(appIds);

  // Opened from somewhere else with a filter: an insight card, a summary's theme.
  const [filter, setFilter] = useState<ReviewFilter>(() => ({
    ...DEFAULT_FILTER,
    status: options.reviewIds?.length ? 'all' : options.reviewUnanswered ? 'todo' : options.reviewRating !== undefined || options.reviewTopic ? 'all' : 'todo',
    stars: options.reviewRating === undefined ? 'all' : options.reviewRating <= 2 ? 'low' : (String(options.reviewRating) as StarFilter),
    topic: (options.reviewTopic as ReviewTopic) ?? 'all',
    ids: options.reviewIds?.length ? options.reviewIds : null,
  }));
  const [sort, setSort] = useState<ReviewSort>('newest');
  const [limit, setLimit] = useState(PAGE);
  // Answered or marked while "To do" is showing: kept in view, so the reply
  // and its state can be seen, until the filters change.
  const [kept, setKept] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [replyRequest, setReplyRequest] = useState<{ id: string; nonce: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const patch = (change: Partial<ReviewFilter>) => setFilter((current) => ({ ...current, ...change }));
  useEffect(() => {
    setLimit(PAGE);
    setKept(new Set());
  }, [filter, sort, scope]);

  const play = !!view.app.id && isPlayApp(view.app.id) && scope === 'app';
  const allPlay = inbox.reviews.length > 0 && inbox.reviews.every((review) => isPlayApp(review.appId));
  const places = useMemo(() => Array.from(new Set(inbox.reviews.map(placeOf))).filter(Boolean).sort(), [inbox.reviews]);
  const versions = useMemo(() => versionsOf(inbox.reviews), [inbox.reviews]);
  const topics = useMemo(() => topicCounts(inbox.reviews), [inbox.reviews]);
  const counts = useMemo(() => statusCounts(inbox.reviews, inbox.marks), [inbox.reviews, inbox.marks]);
  const shown = useMemo(() => filterReviews(inbox.reviews, inbox.marks, filter, sort, { keep: kept, now: today() }), [inbox.reviews, inbox.marks, filter, sort, kept]);
  const visible = shown.slice(0, limit);
  const appOf = useCallback((appId: string) => view.apps.find((entry) => entry.id === appId) ?? (appId === view.app.id ? view.app : null), [view.apps, view.app]);
  const nameOf = useCallback((appId: string) => appOf(appId)?.name ?? 'Your app', [appOf]);
  const selectedReviews = inbox.reviews.filter((review) => selected.has(review.id));

  // Selection only holds reviews still on the list.
  useEffect(() => {
    setSelected((current) => {
      const ids = new Set(shown.map((review) => review.id));
      const next = new Set(Array.from(current).filter((id) => ids.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [shown]);

  const keep = (ids: string[]) => setKept((current) => new Set([...current, ...ids]));

  const setDone = async (reviews: StoreReview[], done: boolean) => {
    keep(reviews.map((review) => review.id));
    await updateReviewMarks(reviews, (mark, review) => markedDone(mark, review, done));
  };

  const setTag = async (reviews: StoreReview[], tagId: string, on: boolean) => {
    await updateReviewMarks(reviews, (mark, review) => toggledTag(mark, review, tagId, on));
  };

  const createTag = async (name: string): Promise<ReviewTag | null> => {
    const { tags, tag } = withTag(inbox.tags, name);
    if (tags !== inbox.tags) await writeTags(tags);
    return tag;
  };

  const exportCsv = async (reviews: StoreReview[]) => {
    const text = reviewsCsv(reviews, inbox.marks, inbox.tags, nameOf);
    const stem = scope === 'every' ? 'Reviews' : `${view.app.name} reviews`;
    await saveBlobToDisk(new Blob([text], { type: 'text/csv;charset=utf-8' }), `${stem} ${today()}.csv`);
  };

  // The keyboard: J and K move, R replies, E marks, X selects, / searches.
  const latest = useRef({ visible, focused, shown, limit, inbox, setDone });
  latest.current = { visible, focused, shown, limit, inbox, setDone };
  useEffect(() => {
    if (!view.active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typingOrMenu(event)) return;
      const now = latest.current;
      const index = now.focused ? now.shown.findIndex((review) => review.id === now.focused) : -1;
      const move = (to: number) => {
        const target = now.shown[Math.max(0, Math.min(now.shown.length - 1, to))];
        if (!target) return;
        if (to >= now.limit) setLimit((value) => value + PAGE);
        setFocused(target.id);
        window.setTimeout(() => {
          const card = document.querySelector<HTMLElement>(`[data-review-id="${CSS.escape(target.id)}"]`);
          card?.focus({ preventScroll: true });
          card?.scrollIntoView({ block: 'nearest' });
        }, 0);
      };
      const current = index >= 0 ? now.shown[index] : null;
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        move(index + 1);
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        move(index <= 0 ? 0 : index - 1);
      } else if (event.key === 'r' && current) {
        event.preventDefault();
        setReplyRequest({ id: current.id, nonce: Date.now() });
      } else if (event.key === 'e' && current) {
        event.preventDefault();
        if (!current.response) void now.setDone([current], statusOf(current, now.inbox.marks.get(current.id)) !== 'done');
      } else if (event.key === 'x' && current) {
        event.preventDefault();
        setSelected((selection) => {
          const next = new Set(selection);
          if (next.has(current.id)) next.delete(current.id);
          else next.add(current.id);
          return next;
        });
      } else if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view.active]);

  if (!inbox.loaded) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="h-4 w-4 animate-spin" />
        Loading the reviews
      </p>
    );
  }

  if (inbox.reviews.length === 0 && scope === 'app') {
    return (
      <div className="space-y-4">
        <EmptyState icon={MessageSquareIcon} title="No written reviews yet">
          {view.data.status.reviews.state === 'forbidden'
            ? view.data.status.reviews.message
            : play
              ? view.data.status.reviews.state === 'empty'
                ? 'Google Play has no written reviews from the last 7 days. The monthly report files under Setup bring the older reviews.'
                : 'Refresh to load your written reviews. Google Play sends the reviews of the last 7 days, and the monthly report files under Setup bring the older reviews.'
              : 'Refresh to load your written reviews. Star ratings without text are on Ratings.'}
        </EmptyState>
        {everyApp.length > 1 && (
          <div className="flex justify-center">
            <Button size="sm" variant="outline" onClick={() => setScope('every')}>
              See the reviews of every app
            </Button>
          </div>
        )}
      </div>
    );
  }

  const placeWord = play || allPlay ? 'language' : 'country';
  const statusTabs: Array<[ReviewStatus | 'all', string]> = [
    ['todo', 'To do'],
    ['replied', 'Replied'],
    ['done', 'Done'],
    ['all', 'All reviews'],
  ];
  const filtered =
    filter.stars !== 'all' || filter.place !== 'all' || filter.version !== 'all' || filter.tag !== 'all' || filter.topic !== 'all' || filter.period !== 'all' || filter.query.trim() !== '' || filter.changed || !!filter.ids;

  return (
    <div className="space-y-4" data-testid="growth-reviews">
      <SectionTitle
        title="Reviews"
        hint={
          <span className="inline-flex items-center gap-1">
            Answer each review, or mark it done if it needs no answer. Tags help you find reviews again.
            <InfoTip label="How the review inbox works">
              <p>To do has every review without a reply. Replied has the ones you answered, also replies Apple is still checking. Done has the ones you marked done without a reply.</p>
              <p>Keys: J and K move between reviews. R opens the reply box. E marks a review as done. X selects it. / jumps to the search.</p>
            </InfoTip>
          </span>
        }
        actions={
          <>
            {everyApp.length > 1 && (
              <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Which apps">
                {(['app', 'every'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={scope === value}
                    onClick={() => setScope(value)}
                    className={cn('rounded px-2.5 py-1 text-xs', scope === value ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')}
                  >
                    {value === 'app' ? 'This app' : 'Every app'}
                  </button>
                ))}
              </div>
            )}
            <Button size="sm" variant="outline" className="h-8" onClick={() => void exportCsv(shown)} disabled={shown.length === 0} title="Save the reviews on the list as a spreadsheet file">
              <DownloadIcon className="mr-1.5 h-3.5 w-3.5" />
              Export CSV
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-1 border-b" role="group" aria-label="Show reviews">
        {statusTabs.map(([value, label]) => {
          const count = counts[value];
          return (
            <button
              key={value}
              type="button"
              aria-pressed={filter.status === value}
              onClick={() => patch({ status: value })}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                filter.status === value ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{formatExact(count)}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input ref={searchRef} value={filter.query} onChange={(event) => patch({ query: event.target.value })} placeholder="Search reviews and replies" className="h-9 pl-8 text-sm" aria-label="Search reviews" />
        </div>
        <Select value={filter.stars} onValueChange={(value) => patch({ stars: value as StarFilter })}>
          <SelectTrigger className="h-9 w-[140px] text-xs" aria-label="Filter by stars">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All ratings</SelectItem>
            <SelectItem value="low" className="text-xs">1 and 2 stars</SelectItem>
            <SelectItem value="mid" className="text-xs">3 stars</SelectItem>
            <SelectItem value="high" className="text-xs">4 and 5 stars</SelectItem>
            {[5, 4, 3, 2, 1].map((star) => (
              <SelectItem key={star} value={String(star)} className="text-xs">
                Only {star} star{star === 1 ? '' : 's'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {places.length > 1 && (
          <Select value={filter.place} onValueChange={(value) => patch({ place: value })}>
            <SelectTrigger className="h-9 w-[160px] text-xs" aria-label={placeWord === 'language' ? 'Filter by language' : 'Filter by country'}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">{placeWord === 'language' ? 'All languages' : 'All countries'}</SelectItem>
              {places.map((code) => (
                <SelectItem key={code} value={code} className="text-xs">
                  {/^[A-Z]{2}$/.test(code) ? territoryName(code) : listingLanguageName(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {versions.length > 0 && (
          <Select value={filter.version} onValueChange={(value) => patch({ version: value })}>
            <SelectTrigger className="h-9 w-[140px] text-xs" aria-label="Filter by version">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Any version</SelectItem>
              {versions.map((version) => (
                <SelectItem key={version} value={version} className="text-xs">
                  Version {version}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={filter.tag} onValueChange={(value) => patch({ tag: value })}>
          <SelectTrigger className="h-9 w-[130px] text-xs" aria-label="Filter by tag">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Any tag</SelectItem>
            <SelectItem value="none" className="text-xs">No tag</SelectItem>
            {inbox.tags.map((tag) => (
              <SelectItem key={tag.id} value={tag.id} className="text-xs">
                {tag.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filter.topic} onValueChange={(value) => patch({ topic: value as ReviewTopic | 'all' })}>
          <SelectTrigger className="h-9 w-[150px] text-xs" aria-label="Filter by topic">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Any topic</SelectItem>
            {topics.map((entry) => (
              <SelectItem key={entry.topic} value={entry.topic} className="text-xs">
                {REVIEW_TOPIC_LABELS[entry.topic]} ({entry.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filter.period} onValueChange={(value) => patch({ period: value as PeriodFilter })}>
          <SelectTrigger className="h-9 w-[130px] text-xs" aria-label="Filter by date">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Any time</SelectItem>
            <SelectItem value="7" className="text-xs">Last 7 days</SelectItem>
            <SelectItem value="30" className="text-xs">Last 30 days</SelectItem>
            <SelectItem value="90" className="text-xs">Last 90 days</SelectItem>
            <SelectItem value="365" className="text-xs">Last 12 months</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(value) => setSort(value as ReviewSort)}>
          <SelectTrigger className="h-9 w-[150px] text-xs" aria-label="Sort reviews">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as ReviewSort[]).map((value) => (
              <SelectItem key={value} value={value} className="text-xs">
                {SORT_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          aria-pressed={filter.changed}
          onClick={() => patch({ changed: !filter.changed })}
          className={cn('h-9 rounded-md border px-3 text-xs', filter.changed ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted')}
          title="Only reviews whose stars changed after Growth first loaded them"
        >
          Stars changed
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        <span>
          {shown.length === inbox.reviews.length
            ? `${formatExact(shown.length)} review${shown.length === 1 ? '' : 's'}`
            : `${formatExact(shown.length)} of ${formatExact(inbox.reviews.length)} reviews`}
          {filter.ids ? ' from the summary' : ''}
        </span>
        {filtered && (
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setFilter({ ...DEFAULT_FILTER, status: filter.status })}>
            Clear the filters
          </button>
        )}
        {shown.length > 0 && (
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => setSelected(selected.size === Math.min(shown.length, limit) ? new Set() : new Set(visible.map((review) => review.id)))}
          >
            {selected.size === Math.min(shown.length, limit) ? 'Select none' : `Select the ${visible.length === 1 ? 'review' : `${visible.length} reviews`} shown`}
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-sm" data-testid="growth-reviews-selection">
          <span className="text-xs font-medium">{selected.size} selected</span>
          <TagMenu
            tags={inbox.tags}
            label="Tag the selected reviews"
            onPick={(tag) => void setTag(selectedReviews, tag.id, true)}
            onCreate={async (name) => {
              const tag = await createTag(name);
              if (tag) await setTag(selectedReviews, tag.id, true);
            }}
          />
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void setDone(selectedReviews.filter((review) => !review.response), true)}>
            <CheckIcon className="mr-1 h-3.5 w-3.5" />
            Mark as done
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void setDone(selectedReviews, false)}>
            <Undo2Icon className="mr-1 h-3.5 w-3.5" />
            Back to To do
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void exportCsv(selectedReviews)}>
            <DownloadIcon className="mr-1 h-3.5 w-3.5" />
            Export CSV
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {shown.length === 0 ? (
        filter.status === 'todo' && !filtered ? (
          <EmptyState icon={CheckIcon} title="Nothing to do">
            Every review has a reply or is done.{' '}
            <button type="button" className="underline underline-offset-2" onClick={() => patch({ status: 'all' })}>
              See all reviews
            </button>
          </EmptyState>
        ) : (
          <EmptyState icon={SearchIcon} title="No reviews match">
            <button type="button" className="underline underline-offset-2" onClick={() => setFilter({ ...DEFAULT_FILTER, status: 'all' })}>
              Show all reviews
            </button>
          </EmptyState>
        )
      ) : (
        <ul className="space-y-3">
          {visible.map((review) => (
            <li key={review.id}>
              <ReviewCard
                review={review}
                inbox={inbox}
                mark={inbox.marks.get(review.id)}
                app={appOf(review.appId)}
                showApp={scope === 'every'}
                focused={focused === review.id}
                selected={selected.has(review.id)}
                replyRequest={replyRequest?.id === review.id ? replyRequest.nonce : null}
                onFocus={() => setFocused(review.id)}
                onSelect={(on) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (on) next.add(review.id);
                    else next.delete(review.id);
                    return next;
                  })
                }
                onAnswered={() => keep([review.id])}
                onDone={(done) => void setDone([review], done)}
                onTag={(tagId, on) => void setTag([review], tagId, on)}
                onCreateTag={async (name) => {
                  const tag = await createTag(name);
                  if (tag) await setTag([review], tag.id, true);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {shown.length > limit && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setLimit((value) => value + PAGE)}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}

// --- tags -------------------------------------------------------------------------------

export function TagChip({ tag, onRemove }: { tag: ReviewTag; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: tagColor(tag.color) }} />
      {tag.name}
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-foreground" aria-label={`Take the tag ${tag.name} off`}>
          <XIcon className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

/** A menu of the tags, with a box to make a new one. */
function TagMenu({
  tags,
  label,
  active,
  onPick,
  onCreate,
  compact,
}: {
  tags: ReviewTag[];
  label: string;
  active?: Set<string>;
  onPick: (tag: ReviewTag, on: boolean) => void;
  onCreate: (name: string) => Promise<void>;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const create = async () => {
    if (!name.trim()) return;
    await onCreate(name);
    setName('');
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant={compact ? 'ghost' : 'outline'} className={cn(compact ? 'h-6 px-2 text-[11px]' : 'h-7 text-xs')} aria-label={label}>
          <TagIcon className={cn('mr-1', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
          {compact ? 'Tag' : 'Add a tag'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        {tags.length === 0 ? (
          <p className="px-1 pb-2 text-xs text-muted-foreground">No tags yet. Type a name to make the first one.</p>
        ) : (
          <div className="mb-2 max-h-56 space-y-0.5 overflow-y-auto">
            {tags.map((tag) => {
              const on = active?.has(tag.id) ?? false;
              return (
                <label key={tag.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted">
                  <Checkbox checked={on} onCheckedChange={(checked) => onPick(tag, checked === true)} aria-label={tag.name} />
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: tagColor(tag.color) }} />
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                </label>
              );
            })}
          </div>
        )}
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="New tag" className="h-7 text-xs" aria-label="New tag" maxLength={30} />
          <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!name.trim()} aria-label="Make the tag">
            <PlusIcon className="h-3.5 w-3.5" />
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

// --- one review -------------------------------------------------------------------------

type Busy = 'suggest' | 'translate-review' | 'translate-draft' | 'send' | 'delete' | null;

function ReviewCard({
  review,
  inbox,
  mark,
  app,
  showApp,
  focused,
  selected,
  replyRequest,
  onFocus,
  onSelect,
  onAnswered,
  onDone,
  onTag,
  onCreateTag,
}: {
  review: StoreReview;
  inbox: ReviewInboxData;
  mark: ReviewMark | undefined;
  app: GrowthView['app'] | null;
  showApp: boolean;
  focused: boolean;
  selected: boolean;
  replyRequest: number | null;
  onFocus: () => void;
  onSelect: (on: boolean) => void;
  onAnswered: () => void;
  onDone: (done: boolean) => void;
  onTag: (tagId: string, on: boolean) => void;
  onCreateTag: (name: string) => Promise<void>;
}) {
  const view = useGrowthView();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [tone, setTone] = useState<ReplyTone>('friendly');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [translation, setTranslation] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // What the AI is writing for this card has nowhere to go once the card is
  // gone (another section, another filter), so leaving stops its CLI. A reply
  // or a delete already sent to the store is let finish.
  const aiJob = useRef<AbortController | null>(null);
  useEffect(() => () => aiJob.current?.abort(), []);
  const aiSignal = () => {
    aiJob.current = new AbortController();
    return aiJob.current.signal;
  };

  useEffect(() => {
    if (replyRequest === null) return;
    if (review.response) setDraft(review.response.body);
    setComposing(true);
    window.setTimeout(() => box.current?.focus(), 0);
    // Only a new request opens the box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyRequest]);

  const play = isPlayApp(review.appId);
  const status = statusOf(review, mark);
  const topics = topicsOf(review);
  const tags = inbox.tags.filter((tag) => mark?.tags.includes(tag.id));
  const reviewerLanguage = listingLanguageName(review.language ?? listingLanguageFor(review.territory));
  const maxLength = play ? MAX_PLAY_REPLY_LENGTH : MAX_REPLY_LENGTH;
  const owner = play ? 'Google' : 'Apple';
  const appName = app?.name ?? view.app.name;
  const sendReason =
    view.blocked.app ??
    (play
      ? view.playCredentials
        ? null
        : 'Add your Google Play service account key under Setup first'
      : view.credentials
        ? null
        : 'Add your App Store Connect API key under Setup first');
  const change = review.ratingChanges?.length ? review.ratingChanges[review.ratingChanges.length - 1] : null;
  const afterReply = changeAfterReply(review);
  const templates = useMemo(() => sortTemplates(inbox.templates), [inbox.templates]);

  const pastReplies = useMemo(
    () =>
      inbox.reviews
        .filter((other) => other.appId === review.appId && other.response?.body && other.id !== review.id)
        .slice(0, 4)
        .map((other) => other.response!.body),
    [inbox.reviews, review.appId, review.id]
  );

  const run = async (kind: NonNullable<Busy>, task: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    setSaved(null);
    try {
      await task();
    } catch (failure) {
      if ((failure as Error)?.name === 'AbortError') return;
      console.error('Growth review action failed', failure);
      setError(failure instanceof Error ? failure.message : 'Your last action did not work. Try again');
    } finally {
      setBusy(null);
    }
  };

  const send = () =>
    run('send', async () => {
      const text = draft.trim();
      if (!text) throw new Error('Write a reply first');
      onAnswered();
      let response;
      if (play) {
        if (!view.playCredentials) throw new Error('Add your Google Play service account key under Setup first');
        response = await replyToPlayReview(view.playCredentials, review.id, text);
      } else {
        if (!view.credentials) throw new Error('Add your App Store Connect API key under Setup first');
        response = await replyToReview(view.credentials, review.id, text);
      }
      await writeReview({ ...review, response });
      setComposing(false);
      setDraft('');
    });

  const remove = () =>
    run('delete', async () => {
      if (!review.response) return;
      if (!view.credentials) throw new Error('Add your App Store Connect API key under Setup first');
      await deleteReviewReply(view.credentials, review.response.id);
      await writeReview({ ...review, response: undefined });
    });

  const suggest = () =>
    run('suggest', async () => {
      const listing = review.appId === view.app.id ? view.data.listing : null;
      const primary = listing?.locales.find((locale) => locale.locale === listing.primaryLocale);
      setDraft(
        await suggestReply({
          signal: aiSignal(),
          review,
          appName,
          appDescription: primary?.description,
          releaseNotes: primary?.whatsNew || undefined,
          pastReplies,
          notes: draft,
          store: play ? 'playstore' : 'appstore',
          tone,
          language: review.language ? reviewerLanguage : undefined,
        })
      );
    });

  const applyTemplate = async (template: ReplyTemplate) => {
    setDraft(fillTemplate(template.body, { name: reviewerName(review), app: appName }));
    setComposing(true);
    await writeTemplates(inbox.templates.map((entry) => (entry.id === template.id ? { ...entry, uses: entry.uses + 1 } : entry)));
    window.setTimeout(() => box.current?.focus(), 0);
  };

  const saveTemplate = async () => {
    const body = draft.trim();
    if (!body) return;
    if (inbox.templates.some((entry) => entry.body.trim() === body)) {
      setSaved('That reply is a template already');
      return;
    }
    await writeTemplates([...inbox.templates, { id: `tpl-${Date.now().toString(36)}`, name: templateName(body), body, createdAt: Date.now(), uses: 0 }]);
    setSaved('Saved as a template');
  };

  const length = Array.from(draft).length;

  return (
    <Panel
      className={cn('space-y-2 outline-none transition-shadow', focused && 'ring-2 ring-ring', selected && 'border-foreground/40')}
      data-review-id={review.id}
      data-review-status={status}
      tabIndex={-1}
      onFocus={onFocus}
      onPointerDown={onFocus}
    >
      <div className="flex items-start gap-3">
        <Checkbox checked={selected} onCheckedChange={(checked) => onSelect(checked === true)} aria-label="Select the review" className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Stars rating={review.rating} />
            {/* Google Play reviews seldom have a title, so a missing one is not worth a line there. */}
            {(review.title || !play) && <p className="text-sm font-semibold">{review.title || 'No title'}</p>}
            <span
              className={cn(
                'ml-auto rounded-full px-2 py-0.5 text-[11px]',
                status === 'todo' ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300' : 'bg-muted text-muted-foreground'
              )}
            >
              {status === 'replied' && review.response?.state === 'PENDING_PUBLISH' ? `Replied, ${owner} is checking` : STATUS_LABELS[status]}
            </span>
          </div>
          <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
            {showApp && app && (
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                {app.iconUrl && <StoreImage src={app.iconUrl} alt="" className="h-4 w-4 rounded" />}
                {app.name},
              </span>
            )}
            <span>
              {review.nickname ? `${review.nickname}, ` : ''}
              {play ? (review.language ? `in ${reviewerLanguage}` : 'Google Play') : placeName(review)}, {formatDay(reviewDay(review))}
              {review.appVersion ? `, version ${review.appVersion}` : ''}
            </span>
          </p>
        </div>
      </div>

      <p className="whitespace-pre-line pl-7 text-sm">{showTranslation && translation ? translation : review.body}</p>

      {change && (
        <p className="pl-7 text-xs">
          <span
            className={cn(
              'rounded px-1.5 py-0.5',
              change.to > change.from ? 'bg-[hsl(var(--growth-good))]/10 text-[hsl(var(--growth-good))]' : 'bg-[hsl(var(--growth-bad))]/10 text-[hsl(var(--growth-bad))]'
            )}
          >
            {afterReply
              ? `Changed from ${afterReply.from} to ${afterReply.to} stars after your reply`
              : `Changed from ${change.from} to ${change.to} stars, ${formatAgo(change.at)}`}
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pl-7">
        {topics.map((topic) => (
          <span key={topic} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" title="Found in the text by Growth">
            {REVIEW_TOPIC_LABELS[topic]}
          </span>
        ))}
        {tags.map((tag) => (
          <TagChip key={tag.id} tag={tag} onRemove={() => onTag(tag.id, false)} />
        ))}
        <TagMenu tags={inbox.tags} label="Tag the review" active={new Set(mark?.tags ?? [])} onPick={(tag, on) => onTag(tag.id, on)} onCreate={onCreateTag} compact />
        <Gated reason={view.blocked.ai}>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            disabled={busy === 'translate-review'}
            onClick={() => {
              if (translation) {
                setShowTranslation((value) => !value);
                return;
              }
              void run('translate-review', async () => {
                setTranslation(await translateText(`${review.title}\n${review.body}`, readerLanguage(), aiSignal()));
                setShowTranslation(true);
              });
            }}
          >
            {busy === 'translate-review' ? <Loader2Icon className="mr-1 h-3 w-3 animate-spin" /> : <LanguagesIcon className="mr-1 h-3 w-3" />}
            {translation ? (showTranslation ? 'Show original' : 'Show translation') : `Translate to ${readerLanguage()}`}
          </Button>
        </Gated>
      </div>

      {review.response && !composing && (
        <div className="ml-7 rounded-md border-l-2 border-[hsl(var(--growth-series))] bg-muted/50 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium">
              Your reply
              <span className="ml-2 font-normal text-muted-foreground">
                {review.response.state === 'PENDING_PUBLISH' ? `Waiting for ${owner} to check the reply` : 'Published'}
                {review.response.lastModified ? `, ${formatDay(review.response.lastModified.slice(0, 10))}` : ''}
              </span>
            </p>
            <div className="flex gap-1">
              <Gated reason={sendReason}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setDraft(review.response!.body);
                    setComposing(true);
                  }}
                >
                  <PencilIcon className="mr-1 h-3.5 w-3.5" />
                  Edit
                </Button>
              </Gated>
              {!play && (
                <Gated reason={sendReason}>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={busy === 'delete'} onClick={() => void remove()}>
                    {busy === 'delete' ? <Loader2Icon className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Trash2Icon className="mr-1 h-3.5 w-3.5" />}
                    Delete
                  </Button>
                </Gated>
              )}
            </div>
          </div>
          <p className="mt-1 whitespace-pre-line text-sm">{review.response.body}</p>
        </div>
      )}

      {!review.response && !composing && (
        <div className="flex flex-wrap gap-2 pl-7">
          <Gated reason={sendReason}>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setComposing(true)}>
              <MessageSquareReplyIcon className="mr-1.5 h-3.5 w-3.5" />
              Reply
            </Button>
          </Gated>
          {templates.length > 0 && (
            <Gated reason={sendReason}>
              <TemplateMenu templates={templates} onUse={(template) => void applyTemplate(template)} onManage={() => view.goTo('replies')} />
            </Gated>
          )}
          {status === 'done' ? (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => onDone(false)}>
              <Undo2Icon className="mr-1.5 h-3.5 w-3.5" />
              Back to To do
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => onDone(true)} title="Mark the review done without a reply, so it leaves To do">
              <CheckIcon className="mr-1.5 h-3.5 w-3.5" />
              Done
            </Button>
          )}
        </div>
      )}

      {composing && (
        <div className="ml-7 space-y-2 rounded-md border p-3">
          <Textarea
            ref={box}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            placeholder={view.aiAvailable ? 'Write a reply, or some notes for the AI to use' : 'Write a reply'}
            className="text-sm"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                // Not while the AI is still writing: the box holds the notes
                // it was given, and those must never go out as the reply.
                if (busy !== null) return;
                void send();
              }
              if (event.key === 'Escape') (event.target as HTMLTextAreaElement).blur();
            }}
            aria-label="Reply"
            autoFocus
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Gated reason={view.blocked.ai}>
                <Button variant="outline" size="sm" className="h-8 text-xs" disabled={busy !== null} onClick={() => void suggest()}>
                  {busy === 'suggest' ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <SparklesIcon className="mr-1.5 h-3.5 w-3.5" />}
                  {draft.trim() ? 'Write from notes' : 'Suggest a reply'}
                </Button>
              </Gated>
              <Select value={tone} onValueChange={(value) => setTone(value as ReplyTone)}>
                <SelectTrigger className="h-8 w-[110px] text-xs" aria-label="How the reply sounds">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="friendly" className="text-xs">Friendly</SelectItem>
                  <SelectItem value="formal" className="text-xs">Formal</SelectItem>
                  <SelectItem value="short" className="text-xs">Short</SelectItem>
                </SelectContent>
              </Select>
              <TemplateMenu templates={templates} onUse={(template) => void applyTemplate(template)} onManage={() => view.goTo('replies')} onSave={draft.trim() ? () => void saveTemplate() : undefined} />
              {draft.trim() && (
                <Gated reason={view.blocked.ai}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={busy !== null}
                    onClick={() => void run('translate-draft', async () => setDraft(await translateText(draft, reviewerLanguage, aiSignal())))}
                    title={
                      play
                        ? `Translate the reply into ${reviewerLanguage}, the language of the review`
                        : `Translate the reply into ${reviewerLanguage}, the main language of ${territoryName(review.territory)}`
                    }
                  >
                    {busy === 'translate-draft' ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <LanguagesIcon className="mr-1.5 h-3.5 w-3.5" />}
                    Translate reply to {reviewerLanguage}
                  </Button>
                </Gated>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={cn('text-[11px] tabular-nums', length > maxLength ? 'text-destructive' : 'text-muted-foreground')}>
                {length} / {maxLength}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  aiJob.current?.abort();
                  setComposing(false);
                  setDraft('');
                  setError(null);
                  setSaved(null);
                }}
              >
                Cancel
              </Button>
              <Gated reason={sendReason}>
                <Button size="sm" className="h-8 text-xs" disabled={busy !== null || !draft.trim() || length > maxLength} onClick={() => void send()}>
                  {busy === 'send' ? <Loader2Icon className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <SendIcon className="mr-1.5 h-3.5 w-3.5" />}
                  {review.response ? 'Update reply' : 'Send reply'}
                </Button>
              </Gated>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {play
              ? 'Replies are public. Google Play shows each reply under the review.'
              : 'Replies are public. Apple checks each reply before the reply shows under the review.'}
          </p>
        </div>
      )}
      {saved && <p className="pl-7 text-xs text-[hsl(var(--growth-good))]">{saved}</p>}
      {error && <p className="pl-7 text-xs text-destructive">{error}</p>}
    </Panel>
  );
}

function TemplateMenu({
  templates,
  onUse,
  onManage,
  onSave,
  disabled,
}: {
  templates: ReplyTemplate[];
  onUse: (template: ReplyTemplate) => void;
  onManage: () => void;
  onSave?: () => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 text-xs" disabled={disabled}>
          <FileTextIcon className="mr-1.5 h-3.5 w-3.5" />
          Templates
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {templates.length > 0 ? (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Start from a template</DropdownMenuLabel>
            {templates.slice(0, 8).map((template) => (
              <DropdownMenuItem key={template.id} className="flex flex-col items-start gap-0.5 text-xs" onSelect={() => onUse(template)}>
                <span className="font-medium">{template.name}</span>
                <span className="line-clamp-2 text-muted-foreground">{template.body}</span>
              </DropdownMenuItem>
            ))}
          </>
        ) : (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">No templates yet. Save a reply you like to use it again.</DropdownMenuLabel>
        )}
        <DropdownMenuSeparator />
        {onSave && (
          <DropdownMenuItem className="text-xs" onSelect={onSave}>
            Save this reply as a template
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="text-xs" onSelect={onManage}>
          Manage templates
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
