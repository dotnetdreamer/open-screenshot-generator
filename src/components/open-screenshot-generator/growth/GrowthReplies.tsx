"use client";

// Replies: how the user answers reviews, and the tools for it. The numbers
// (how many reviews got a reply, how fast, how many people changed their
// stars after one), the reply templates, the tags, and the alerts for new
// reviews, in the app and in Slack.
//
// Templates and tags are the same for every app (reviewInbox.ts). The
// alert choices are Growth settings, read by reviewAlerts.ts at the end of
// every refresh.

import React, { useMemo, useState } from 'react';
import { BellIcon, CheckIcon, Loader2Icon, PlusIcon, SendIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { isTauri } from '@/lib/desktop';
import { formatDay, today, windowEndingAt } from '@/lib/growth/dates';
import { formatExact } from '@/lib/growth/format';
import { isSlackWebhook, postToSlack, type ReviewAlertLevel } from '@/lib/growth/reviewAlerts';
import {
  SUGGESTED_TAGS,
  TAG_COLORS,
  cleanTagName,
  formatHours,
  removeTag,
  replyStats,
  sortTemplates,
  tagColor,
  templateName,
  withTag,
  writeTags,
  writeTemplates,
} from '@/lib/growth/reviewInbox';
import { useGrowthSettings } from '@/lib/growth/settings';
import type { ReplyTemplate, ReviewTag } from '@/lib/growth/types';
import { useReviewInbox } from '@/lib/growth/useReviewInbox';
import { cn } from '@/lib/utils';
import { InfoTip } from '../capture/InfoTip';
import { Gated, Panel, SectionTitle, useGrowthView } from './GrowthShared';

export function GrowthReplies() {
  const view = useGrowthView();
  const everyApp = view.apps.filter((entry) => entry.id);
  const [scope, setScope] = useState<'app' | 'every'>('app');
  const ids = useMemo(
    () => (scope === 'every' && everyApp.length > 1 ? everyApp.map((entry) => entry.id) : view.app.id ? [view.app.id] : []),
    // The ids are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, everyApp.map((entry) => entry.id).join(','), view.app.id]
  );
  const inbox = useReviewInbox(ids);
  const span = useMemo(() => windowEndingAt(today(), view.rangeDays), [view.rangeDays]);
  const stats = useMemo(() => replyStats(inbox.reviews, inbox.marks, span), [inbox.reviews, inbox.marks, span]);
  const rate = stats.reviews > 0 ? stats.replied / stats.reviews : null;
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const mark of inbox.marks.values()) for (const tag of mark.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return counts;
  }, [inbox.marks]);

  return (
    <div className="space-y-4" data-testid="growth-replies">
      <SectionTitle
        title="Replies"
        hint="How you answer reviews, your reply templates, your tags, and the alerts for new reviews"
        actions={
          everyApp.length > 1 && (
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
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="growth-reply-stats">
        <Panel>
          <p className="text-xs text-muted-foreground">Reviews with a reply</p>
          <p className="mt-1 text-3xl font-semibold leading-none">{rate === null ? 'n/a' : `${Math.round(rate * 100)}%`}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {stats.reviews === 0 ? `No reviews in the last ${view.rangeDays} days` : `${formatExact(stats.replied)} of ${formatExact(stats.reviews)} written in the last ${view.rangeDays} days`}
          </p>
        </Panel>
        <Panel>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            Time to reply
            <InfoTip label="How the time to reply is measured">
              <p>The middle time from a review to your reply, over the replies to reviews of the period. A reply you edited later counts from the edit, since the stores keep only the last change.</p>
            </InfoTip>
          </p>
          <p className="mt-1 text-3xl font-semibold leading-none">{stats.medianHours === null ? 'n/a' : formatHours(stats.medianHours)}</p>
          <p className="mt-2 text-xs text-muted-foreground">{stats.medianHours === null ? 'No replies to time yet' : 'Half your replies came faster than this'}</p>
        </Panel>
        <Panel>
          <p className="text-xs text-muted-foreground">Waiting for a reply</p>
          <p className="mt-1 text-3xl font-semibold leading-none">{formatExact(stats.waiting)}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {stats.oldestWaiting ? `The oldest is from ${formatDay(stats.oldestWaiting, { withYear: true })}. ` : 'Every review has a reply or is done. '}
            {stats.waiting > 0 && (
              <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => view.goTo('reviews', { reviewUnanswered: true })}>
                Open To do
              </button>
            )}
          </p>
        </Panel>
        <Panel>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            Stars changed after your reply
            <InfoTip label="How changed stars are found">
              <p>A reviewer can change their stars at any time. Growth notices when a refresh finds new stars on a review you replied to.</p>
            </InfoTip>
          </p>
          <p className="mt-1 text-3xl font-semibold leading-none">{formatExact(stats.raised)}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {stats.raised === 0 && stats.lowered === 0
              ? 'None seen yet'
              : `${stats.raised === 1 ? '1 review' : `${formatExact(stats.raised)} reviews`} went up${stats.lowered > 0 ? `, ${formatExact(stats.lowered)} went down` : ''}. `}
            {stats.raised + stats.lowered > 0 && (
              <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => view.goTo('reviews')}>
                See them in Reviews
              </button>
            )}
          </p>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TemplatesPanel templates={inbox.templates} />
        <div className="space-y-4">
          <TagsPanel tags={inbox.tags} counts={tagCounts} />
          <AlertsPanel />
        </div>
      </div>
    </div>
  );
}

// --- templates ----------------------------------------------------------------------------

function TemplatesPanel({ templates }: { templates: ReplyTemplate[] }) {
  const sorted = useMemo(() => sortTemplates(templates), [templates]);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const save = async (template: ReplyTemplate) => {
    const exists = templates.some((entry) => entry.id === template.id);
    await writeTemplates(exists ? templates.map((entry) => (entry.id === template.id ? template : entry)) : [...templates, template]);
    setEditing(null);
    setAdding(false);
  };
  return (
    <Panel className="space-y-3" data-testid="growth-templates">
      <SectionTitle
        title="Reply templates"
        hint={
          <span className="inline-flex items-center gap-1">
            Replies you write often, to start from in one click
            <InfoTip label="How templates work">
              <p>Write {'{name}'} for the reviewer&apos;s name and {'{app}'} for your app&apos;s name. Growth fills them in when you use the template.</p>
              <p>A template is the same for every app. Open Templates in a reply box to use one, or to save the reply you wrote.</p>
            </InfoTip>
          </span>
        }
        actions={
          !adding && (
            <Button size="sm" variant="outline" className="h-8" onClick={() => setAdding(true)}>
              <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
              New template
            </Button>
          )
        }
      />
      {adding && <TemplateForm onSave={(template) => void save(template)} onCancel={() => setAdding(false)} />}
      {sorted.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground">No templates yet. Make one here, or save a reply you like from the reply box in Reviews.</p>
      ) : (
        <ul className="divide-y">
          {sorted.map((template) =>
            editing === template.id ? (
              <li key={template.id} className="py-2">
                <TemplateForm template={template} onSave={(next) => void save(next)} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li key={template.id} className="space-y-1 py-2" data-template={template.name}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-medium">{template.name}</p>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {template.uses === 0 ? 'Not used yet' : `Used ${template.uses === 1 ? 'once' : `${formatExact(template.uses)} times`}`}
                  </span>
                </div>
                <p className="line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">{template.body}</p>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setEditing(template.id)}>
                    Edit
                  </Button>
                  {confirmDelete === template.id ? (
                    <>
                      <Button size="sm" variant="destructive" className="h-6 px-2 text-[11px]" onClick={() => void writeTemplates(templates.filter((entry) => entry.id !== template.id))}>
                        Delete the template
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setConfirmDelete(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setConfirmDelete(template.id)}>
                      <Trash2Icon className="mr-1 h-3 w-3" />
                      Delete
                    </Button>
                  )}
                </div>
              </li>
            )
          )}
        </ul>
      )}
    </Panel>
  );
}

function TemplateForm({ template, onSave, onCancel }: { template?: ReplyTemplate; onSave: (template: ReplyTemplate) => void; onCancel: () => void }) {
  const [name, setName] = useState(template?.name ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  return (
    <form
      className="space-y-2 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim()) return;
        onSave({
          id: template?.id ?? `tpl-${Date.now().toString(36)}`,
          name: name.trim() || templateName(body),
          body: body.trim(),
          createdAt: template?.createdAt ?? Date.now(),
          uses: template?.uses ?? 0,
        });
      }}
    >
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name, such as Thanks for the stars" aria-label="Template name" className="h-8 text-xs" maxLength={60} />
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        placeholder="Hi {name}, thank you for trying {app}..."
        aria-label="Template text"
        className="text-sm"
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="h-8 text-xs" disabled={!body.trim()}>
          Save template
        </Button>
      </div>
    </form>
  );
}

// --- tags -------------------------------------------------------------------------------------

function TagsPanel({ tags, counts }: { tags: ReviewTag[]; counts: Map<string, number> }) {
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const add = async (names: string[]) => {
    let next = tags;
    for (const entry of names) next = withTag(next, entry).tags;
    if (next !== tags) await writeTags(next);
  };
  const rename = async (tag: ReviewTag, value: string) => {
    const clean = cleanTagName(value);
    if (!clean || clean === tag.name || tags.some((entry) => entry.id !== tag.id && entry.name.toLowerCase() === clean.toLowerCase())) return;
    await writeTags(tags.map((entry) => (entry.id === tag.id ? { ...entry, name: clean } : entry)));
  };
  return (
    <Panel className="space-y-3" data-testid="growth-tags">
      <SectionTitle title="Tags" hint="Your own labels for reviews, the same for every app. Filter by a tag in Reviews" />
      {tags.length === 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>No tags yet.</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void add(SUGGESTED_TAGS)}>
            Add {SUGGESTED_TAGS.join(', ')}
          </Button>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {tags.map((tag) => (
            <li key={tag.id} className="flex flex-wrap items-center gap-2" data-tag={tag.name}>
              <TagColor tag={tag} onPick={(color) => void writeTags(tags.map((entry) => (entry.id === tag.id ? { ...entry, color } : entry)))} />
              <Input
                defaultValue={tag.name}
                aria-label={`Name of the tag ${tag.name}`}
                className="h-7 w-40 text-xs"
                maxLength={30}
                onBlur={(event) => void rename(tag, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                }}
              />
              <span className="text-[11px] text-muted-foreground">
                {counts.get(tag.id) ? `${formatExact(counts.get(tag.id)!)} review${counts.get(tag.id) === 1 ? '' : 's'}` : 'No reviews yet'}
              </span>
              {confirmDelete === tag.id ? (
                <span className="ml-auto flex items-center gap-1">
                  <Button size="sm" variant="destructive" className="h-6 px-2 text-[11px]" onClick={() => void removeTag(tags, tag.id)}>
                    Delete the tag
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setConfirmDelete(null)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[11px]" onClick={() => setConfirmDelete(tag.id)} aria-label={`Delete the tag ${tag.name}`}>
                  <Trash2Icon className="h-3 w-3" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          void add([name]).then(() => setName(''));
        }}
      >
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="New tag" aria-label="New tag" className="h-8 text-xs" maxLength={30} />
        <Button type="submit" size="sm" variant="outline" className="h-8 text-xs" disabled={!name.trim()}>
          Add tag
        </Button>
      </form>
    </Panel>
  );
}

function TagColor({ tag, onPick }: { tag: ReviewTag; onPick: (color: string) => void }) {
  return (
    <span className="flex items-center gap-0.5" role="group" aria-label={`Colour of the tag ${tag.name}`}>
      {TAG_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-pressed={tag.color === color}
          aria-label={`Colour ${color}`}
          onClick={() => onPick(color)}
          className={cn('h-3.5 w-3.5 rounded-full ring-offset-1 ring-offset-card', tag.color === color && 'ring-2 ring-foreground')}
          style={{ background: tagColor(color) }}
        />
      ))}
    </span>
  );
}

// --- alerts ----------------------------------------------------------------------------------

function AlertsPanel() {
  const view = useGrowthView();
  const [settings, setSettings] = useGrowthSettings();
  const desktop = isTauri();
  const [webhook, setWebhook] = useState(settings.slackWebhook ?? '');
  const [state, setState] = useState<{ busy: boolean; message: string | null; tone: 'ok' | 'error' }>({ busy: false, message: null, tone: 'ok' });
  const level: ReviewAlertLevel = settings.reviewAlerts ?? 'all';
  const saved = (settings.slackWebhook ?? '') === webhook.trim();
  const valid = webhook.trim() === '' || isSlackWebhook(webhook);

  const test = async () => {
    setState({ busy: true, message: null, tone: 'ok' });
    try {
      await postToSlack(webhook, `Growth in Open Screenshot Generator will post new reviews of ${view.app.id ? view.app.name : 'your apps'} here.`);
      setState({ busy: false, message: 'Sent. Look for the message in Slack', tone: 'ok' });
    } catch (error) {
      setState({ busy: false, message: error instanceof Error ? error.message : 'Slack did not take the message', tone: 'error' });
    }
  };

  return (
    <Panel className="space-y-3" data-testid="growth-alerts">
      <SectionTitle
        title="Alerts for new reviews"
        hint="Growth looks for new reviews each time it refreshes your numbers, also while you work in the editor"
      />
      <RadioGroup value={level} onValueChange={(value) => setSettings({ reviewAlerts: value as ReviewAlertLevel })} className="space-y-1.5" aria-label="Which new reviews to tell you about">
        {(
          [
            ['all', 'Every new review'],
            ['low', 'Only 1 and 2 star reviews'],
            ['off', 'No alerts'],
          ] as Array<[ReviewAlertLevel, string]>
        ).map(([value, label]) => (
          <div key={value} className="flex items-center gap-2">
            <RadioGroupItem value={value} id={`growth-alert-${value}`} />
            <Label htmlFor={`growth-alert-${value}`} className="text-xs font-normal">
              {label}
            </Label>
          </div>
        ))}
      </RadioGroup>
      <div className="space-y-1.5 border-t pt-3">
        <Label htmlFor="growth-slack" className="flex items-center gap-1 text-xs">
          <BellIcon className="h-3.5 w-3.5" />
          Also post them to Slack
          <InfoTip label="How to get a Slack webhook">
            <p>In Slack, add the app Incoming Webhooks to your workspace, pick the channel, and copy the Webhook URL it shows. It starts with https://hooks.slack.com/services/.</p>
            <p>Growth posts the stars, the title and the start of each new review. Your keys and your numbers never go to Slack.</p>
          </InfoTip>
        </Label>
        <div className="flex flex-wrap gap-2">
          <Gated reason={desktop ? null : 'Slack alerts work in the desktop app only'}>
            <Input
              id="growth-slack"
              value={webhook}
              onChange={(event) => setWebhook(event.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              className="h-8 min-w-[220px] flex-1 text-xs"
              disabled={!desktop}
              aria-invalid={!valid}
            />
          </Gated>
          <Gated reason={desktop ? (valid ? null : 'Paste a Slack webhook address first') : 'Slack alerts work in the desktop app only'}>
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={saved} onClick={() => setSettings({ slackWebhook: webhook.trim() || undefined })}>
              {saved && webhook.trim() ? <CheckIcon className="mr-1 h-3.5 w-3.5" /> : null}
              {saved ? (webhook.trim() ? 'Saved' : 'Save') : webhook.trim() ? 'Save' : 'Stop posting to Slack'}
            </Button>
          </Gated>
          <Gated reason={desktop ? (webhook.trim() && valid ? null : 'Paste a Slack webhook address first') : 'Slack alerts work in the desktop app only'}>
            <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={state.busy} onClick={() => void test()}>
              {state.busy ? <Loader2Icon className="mr-1 h-3.5 w-3.5 animate-spin" /> : <SendIcon className="mr-1 h-3.5 w-3.5" />}
              Send a test message
            </Button>
          </Gated>
        </div>
        {!valid && <p className="text-xs text-destructive">A Slack webhook address starts with https://hooks.slack.com/services/</p>}
        {state.message && <p className={cn('text-xs', state.tone === 'error' ? 'text-destructive' : 'text-[hsl(var(--growth-good))]')}>{state.message}</p>}
      </div>
    </Panel>
  );
}
