"use client";

// Ask AI, the screen Growth opens on. One conversation does two jobs: it sets
// Growth up, driving the browser beside it on App Store Connect, Google Cloud
// and Play Console while the user signs in and says yes to each change, and
// it answers questions about the numbers once an app is connected.
//
// The conversation and the browser outlive this screen (assistant.ts,
// browser.ts), and GrowthWorkspace hands the assistant what Growth knows and
// can do, so the screen only draws them.

import React, { useEffect, useRef, useState } from 'react';
import {
  AppleIcon,
  BotIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleIcon,
  ExternalLinkIcon,
  FileKeyIcon,
  KeyRoundIcon,
  LayersIcon,
  LogInIcon,
  MonitorSmartphoneIcon,
  PlayIcon,
  ShieldCheckIcon,
  SquarePenIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openExternal } from '@/lib/desktop';
import { finishWaiting, newConversation, sendMessage, useAssistant } from '@/lib/growth/setup/assistant';
import { setGrowthSettings, useGrowthSettings } from '@/lib/growth/settings';
import type { GrowthStore } from '@/lib/growth/stores';
import { cn } from '@/lib/utils';
import { GrowthBrowserPane, useBrowser } from './GrowthBrowserPane';
import { AiLogo, AiPicker, type AiChoice } from './AiPicker';
import { AssistantAvatar, AssistantComposer, AssistantMessages, useKeyFileDrop, useKeyFilePicker } from './GrowthAssistantChat';
import { Gated, useGrowthView } from './GrowthShared';

const DESKTOP_URL = 'https://openscrgen.app';

const STARTERS = [
  'Did my new screenshots work?',
  'Why did downloads change over the last two weeks?',
  'Which language should I translate the screenshots into next?',
  'What are people complaining about in their reviews?',
  'Where do most of my downloads come from?',
];

/** What the user keeps in their hands while the assistant works. */
const TRUST: Array<{ icon: React.ComponentType<{ className?: string }>; text: string }> = [
  { icon: LogInIcon, text: 'You sign in yourself' },
  { icon: ShieldCheckIcon, text: 'Nothing changes without your yes' },
  { icon: KeyRoundIcon, text: 'Keys stay on this computer' },
];

const STORE_CHOICES: Array<{ stores: GrowthStore[]; label: string; icon: React.ComponentType<{ className?: string }>; message: string }> = [
  { stores: ['appstore'], label: 'App Store', icon: AppleIcon, message: 'My app is on the App Store. Help me connect it.' },
  { stores: ['playstore'], label: 'Google Play', icon: PlayIcon, message: 'My app is on Google Play. Help me connect it.' },
  {
    stores: ['appstore', 'playstore'],
    label: 'Both',
    icon: LayersIcon,
    message: 'My app is on the App Store and Google Play. Help me connect both.',
  },
];

function useWide(): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

interface Task {
  store: GrowthStore;
  label: string;
  done: boolean;
  detail: string | null;
  problem: string | null;
  ask: string;
}

function useTasks(): { tasks: Task[]; stores: GrowthStore[] } {
  const view = useGrowthView();
  const [settings] = useGrowthSettings();
  const apple = view.credentials;
  const play = view.playCredentials;
  const status = view.data.status;
  const onApple = view.store === 'appstore' && !!view.app.id;
  const onPlay = view.store === 'playstore' && !!view.app.id;
  const trouble = (state: string) => state === 'forbidden' || state === 'error' || state === 'needs-setup';
  const tasks: Task[] = [
    {
      store: 'appstore',
      label: 'API key',
      done: !!apple && !view.assistant.appleAppsError,
      detail: apple ? `Key ID ${apple.keyId}` : null,
      problem: apple ? view.assistant.appleAppsError : null,
      ask: 'Help me make an App Store Connect API key',
    },
    {
      store: 'appstore',
      label: 'Vendor number',
      done: !!settings.vendorNumber && !(onApple && trouble(status.sales.state)),
      detail: settings.vendorNumber ?? null,
      problem: settings.vendorNumber && onApple && trouble(status.sales.state) ? status.sales.message ?? null : null,
      ask: 'Help me find my vendor number',
    },
    {
      store: 'playstore',
      label: 'Service account key',
      done: !!play && !(onPlay && status.listing.state === 'forbidden'),
      detail: play ? play.packageName : null,
      problem: play && onPlay && status.listing.state === 'forbidden' ? status.listing.message ?? null : null,
      ask: 'Help me make a Google Play service account key',
    },
    {
      store: 'playstore',
      label: 'Report files',
      done: !!settings.playReportsUri && !(onPlay && trouble(status.analytics.state)),
      detail: settings.playReportsUri ?? null,
      problem: settings.playReportsUri && onPlay && trouble(status.analytics.state) ? status.analytics.message ?? null : null,
      ask: 'Help me add the Google Play report files',
    },
  ];
  const stores = settings.setupStores?.length ? settings.setupStores : (['appstore', 'playstore'] as GrowthStore[]);
  return { tasks, stores };
}

const STORE_LABEL: Record<GrowthStore, string> = { appstore: 'App Store', playstore: 'Google Play' };
const STORE_ICON: Record<GrowthStore, React.ComponentType<{ className?: string }>> = { appstore: AppleIcon, playstore: PlayIcon };

/** What is connected and what is left, with each part one click from the assistant. */
function SetupProgress({ onAsk }: { onAsk: (text: string) => void }) {
  const view = useGrowthView();
  const { tasks, stores } = useTasks();
  const [open, setOpen] = useState(false);
  const wanted = tasks.filter((task) => stores.includes(task.store));
  const done = wanted.filter((task) => task.done).length;
  const allDone = done === wanted.length;
  const other: GrowthStore | null = stores.length === 1 ? (stores[0] === 'appstore' ? 'playstore' : 'appstore') : null;

  if (allDone && !open) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs" data-testid="growth-setup-progress">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-[hsl(var(--growth-good))]/15 text-[hsl(var(--growth-good))]">
          <CheckIcon className="h-3 w-3" />
        </span>
        <span className="min-w-0 flex-1 truncate">
          {stores.map((store) => STORE_LABEL[store]).join(' and ')} {stores.length > 1 ? 'are' : 'is'} connected
        </span>
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(true)}>
          Show
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-3.5" data-testid="growth-setup-progress">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold">{allDone ? 'Your stores are connected' : 'Connect your stores'}</p>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {done} of {wanted.length} done
        </span>
        {allDone && (
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>
            Hide
          </button>
        )}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--growth-assistant))] to-[hsl(var(--growth-series))] transition-[width] duration-500"
          style={{ width: `${wanted.length ? Math.max(4, (done / wanted.length) * 100) : 0}%` }}
        />
      </div>
      <div className={cn('mt-3 grid gap-2', stores.length > 1 && 'sm:grid-cols-2')}>
        {stores.map((store) => {
          const Icon = STORE_ICON[store];
          return (
            <div key={store} className="rounded-lg bg-muted/50 p-2.5">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
                <Icon className="h-3.5 w-3.5" />
                {STORE_LABEL[store]}
              </p>
              <ul className="space-y-0.5">
                {tasks
                  .filter((task) => task.store === store)
                  .map((task) => (
                    <li key={task.label}>
                      <button
                        type="button"
                        disabled={task.done}
                        onClick={() => onAsk(task.ask)}
                        title={task.problem ?? (task.done ? task.detail ?? undefined : task.ask)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors',
                          !task.done && 'hover:bg-background'
                        )}
                      >
                        {task.done ? (
                          <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[hsl(var(--growth-good))] text-white">
                            <CheckIcon className="h-2.5 w-2.5" />
                          </span>
                        ) : task.problem ? (
                          <CircleAlertIcon className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <CircleIcon className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                        )}
                        <span className={cn('min-w-0 flex-1', task.done && 'text-muted-foreground')}>{task.label}</span>
                        {!task.done && <span className="shrink-0 text-[11px] text-[hsl(var(--growth-assistant))]">{task.problem ? 'Fix' : 'Set up'}</span>}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          );
        })}
      </div>
      {other && view.assistant.reason === null && (
        <button
          type="button"
          className="mt-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            setGrowthSettings({ setupStores: ['appstore', 'playstore'] });
            onAsk(`My app is on ${STORE_LABEL[other]} too. Help me connect it.`);
          }}
        >
          Also on {STORE_LABEL[other]}? Set it up too
        </button>
      )}
    </div>
  );
}

function Welcome({ setUp, onAsk }: { setUp: boolean; onAsk: (text: string) => void }) {
  const view = useGrowthView();
  const reason = view.assistant.reason;
  const desktopOnly = reason === 'Growth works in the desktop app only';

  if (setUp) {
    return (
      <div className="flex flex-col items-center px-2 pt-4 text-center">
        <AssistantAvatar className="h-12 w-12 [&_svg]:h-6 [&_svg]:w-6" />
        <p className="mt-3 text-base font-semibold">{view.app.id ? `Ask about ${view.app.name}` : 'Ask about your app'}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {view.aiLabel
            ? `${view.aiLabel} answers with your numbers, reviews, store page and timeline`
            : 'The AI answers with your numbers, reviews, store page and timeline'}
        </p>
        {reason && <p className="mt-2 max-w-md text-xs text-muted-foreground">{reason}</p>}
        <div className="mt-4 flex max-w-xl flex-wrap justify-center gap-2">
          {STARTERS.map((starter) => (
            <Gated key={starter} reason={reason}>
              <button
                type="button"
                className="rounded-full border px-3 py-1.5 text-left text-xs transition-colors hover:border-[hsl(var(--growth-assistant))]/50 hover:bg-[hsl(var(--growth-assistant))]/5 disabled:opacity-60"
                onClick={() => onAsk(starter)}
              >
                {starter}
              </button>
            </Gated>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-2 pt-2 text-center" data-testid="growth-assistant-welcome">
      <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[hsl(var(--growth-assistant))] to-[hsl(var(--growth-series))] text-white shadow-lg shadow-[hsl(var(--growth-assistant))]/25">
        <MonitorSmartphoneIcon className="h-7 w-7" />
      </span>
      <p className="mt-4 text-lg font-semibold">Let&apos;s connect your stores</p>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        I&apos;ll open App Store Connect and Google Play right here, find what Growth needs and save it for you.
      </p>
      <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {TRUST.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 text-[hsl(var(--growth-assistant))]" />
            {text}
          </li>
        ))}
      </ul>
      {reason && !desktopOnly && <p className="mt-3 max-w-md rounded-lg bg-muted px-3 py-2 text-xs">{reason}</p>}
      <p className="mt-5 text-xs font-medium text-muted-foreground">Where&apos;s your app?</p>
      <div className="mt-2 grid w-full max-w-md grid-cols-3 gap-2">
        {STORE_CHOICES.map((choice) => {
          const Icon = choice.icon;
          return (
            <Gated key={choice.label} reason={reason}>
              <button
                type="button"
                className="group flex w-full flex-col items-center gap-2 rounded-xl border bg-card px-2 py-3.5 text-sm font-medium transition-all hover:-translate-y-0.5 hover:border-[hsl(var(--growth-assistant))]/50 hover:shadow-md disabled:pointer-events-none disabled:opacity-60"
                onClick={() => {
                  setGrowthSettings({ setupStores: choice.stores });
                  onAsk(choice.message);
                }}
              >
                <span className="grid h-9 w-9 place-items-center rounded-full bg-muted text-foreground transition-colors group-hover:bg-[hsl(var(--growth-assistant))]/15 group-hover:text-[hsl(var(--growth-assistant))]">
                  <Icon className="h-4 w-4" />
                </span>
                {choice.label}
              </button>
            </Gated>
          );
        })}
      </div>
      {desktopOnly ? (
        <div className="mt-5 flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground">{reason}</p>
          <Button size="sm" onClick={() => void openExternal(DESKTOP_URL)}>
            Get the desktop app
            <ExternalLinkIcon className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className="mt-5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          onClick={() => view.goTo('connect')}
        >
          I&apos;d rather set it up myself
        </button>
      )}
    </div>
  );
}

export function GrowthAsk() {
  const view = useGrowthView();
  const chat = useAssistant();
  const browser = useBrowser();
  const wide = useWide();
  const [side, setSide] = useState<'chat' | 'browser'>('chat');
  const picker = useKeyFilePicker();
  const drop = useKeyFileDrop();
  const scroller = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const reason = view.assistant.reason;
  const setUp = !!view.credentials || !!view.playCredentials;
  const [settings] = useGrowthSettings();
  // Automatic shows the AI it lands on; a choice made here stays.
  const aiChoice: AiChoice | null = settings.aiWriter && settings.aiWriter !== 'auto' ? settings.aiWriter : view.aiInUse;
  const desktopOnly = reason === 'Growth works in the desktop app only';

  const ask = (text: string) => {
    if (reason) return;
    sendMessage(text);
  };

  // A question handed over from an insight card is asked straight away.
  useEffect(() => {
    if (started.current || !view.tabOptions.question || reason) return;
    started.current = true;
    sendMessage(view.tabOptions.question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the conversation while the user is at its end.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 240) element.scrollTop = element.scrollHeight;
  }, [chat.items, chat.phase]);

  const showBrowser = browser.open;
  const chatShown = wide || !showBrowser || side === 'chat';
  const browserShown = showBrowser && (wide || side === 'browser');
  const runningStep = [...chat.items].reverse().find((item) => item.kind === 'step' && item.state === 'running');
  const waitingItem = [...chat.items].reverse().find(
    (item) => (item.kind === 'waiting' && item.state === 'waiting') || (item.kind === 'key-request' && item.state === 'asking')
  );
  const waitingFor =
    waitingItem?.kind === 'waiting'
      ? waitingItem.text
      : waitingItem?.kind === 'key-request'
        ? waitingItem.fileKind === 'apple'
          ? 'add your .p8 key file'
          : 'add your service account key file'
        : null;
  // What the browser's "your turn" strip offers: Done for a step in the
  // browser, the file picker for a key file.
  const waitAction =
    waitingItem?.kind === 'waiting'
      ? { label: "I'm done", run: () => finishWaiting(waitingItem.id) }
      : waitingItem?.kind === 'key-request'
        ? { label: 'Choose file', run: picker.open }
        : null;
  const waitingKind = waitingItem?.kind ?? null;

  // On a narrow window one side shows at a time: the browser when it is the
  // user's turn there, the chat when a question or a key file waits for them.
  useEffect(() => {
    if (wide) return;
    if (chat.phase === 'waiting') setSide(waitingKind === 'key-request' ? 'chat' : 'browser');
    if (chat.phase === 'approval') setSide('chat');
  }, [wide, chat.phase, waitingKind]);
  const lastUserQuestion = [...chat.items].reverse().find((item) => item.kind === 'user');
  const agentReason =
    view.blocked.app ?? (view.onAskAgent ? null : view.agentUnavailable ?? 'To ask the agent, install Claude Code or Codex and sign in');

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="growth-ask">
      {!wide && showBrowser && (
        <div className="flex gap-1 border-b p-1.5" role="tablist" aria-label="Ask AI sides">
          {(['chat', 'browser'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={side === value}
              onClick={() => setSide(value)}
              className={cn(
                'flex-1 rounded-md py-1.5 text-xs font-medium transition-colors',
                side === value ? 'bg-muted' : 'text-muted-foreground hover:bg-muted/60'
              )}
            >
              {value === 'chat' ? 'Chat' : 'Browser'}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {/* Hidden rather than gone while the browser side shows, so what the
            user was typing, where they had scrolled and the file picker stay. */}
        <section
          className={cn('relative flex min-w-0 flex-1 flex-col', !chatShown && 'hidden')}
          aria-label="Ask AI"
          {...drop.handlers}
        >
          <div className="flex items-center gap-2.5 border-b px-4 py-2.5">
            <AiLogo choice={desktopOnly ? null : aiChoice} tile className="h-7 w-7" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">Ask AI</p>
              {view.aiLabel && !reason ? (
                <p className="truncate text-[11px] text-muted-foreground" data-testid="growth-ask-ai-status">
                  Using {view.aiLabel}
                </p>
              ) : (
                <p className="truncate text-[11px] text-amber-700 dark:text-amber-300" title={reason ?? undefined} data-testid="growth-ask-ai-status">
                  {reason ?? 'Looking for Claude Code and Codex'}
                </p>
              )}
            </div>
            <Gated reason={agentReason}>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!lastUserQuestion}
                onClick={() => lastUserQuestion?.kind === 'user' && view.onAskAgent?.(lastUserQuestion.text)}
                title="Send the question to the agent. The agent can read your numbers and change your screenshots"
                aria-label="Ask the agent"
              >
                <BotIcon className="h-4 w-4" />
              </Button>
            </Gated>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={chat.items.length === 0}
              onClick={newConversation}
              title="Start a new conversation"
              aria-label="New chat"
            >
              <SquarePenIcon className="h-4 w-4" />
            </Button>
          </div>
          {!desktopOnly && (
            <div className="border-b px-4 py-2">
              <div className="mx-auto max-w-2xl">
                <AiPicker
                  value={aiChoice}
                  onPick={(choice) => setGrowthSettings({ aiWriter: choice })}
                  title="The AI for this chat, and for replies, store page text and report summaries in Growth"
                />
              </div>
            </div>
          )}

          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-5">
              {(setUp || chat.items.length > 0) && !desktopOnly && <SetupProgress onAsk={ask} />}
              {chat.items.length === 0 ? (
                <Welcome setUp={setUp} onAsk={ask} />
              ) : (
                <AssistantMessages
                  items={chat.items}
                  phase={chat.phase}
                  running={chat.running}
                  progress={view.assistant.progress}
                  onPickKeyFile={picker.open}
                />
              )}
            </div>
          </div>

          <div className="mx-auto w-full max-w-2xl px-4 pb-4 pt-1">
            <AssistantComposer
              reason={reason}
              running={chat.running}
              placeholder={setUp ? 'Ask about your downloads, reviews or store page' : 'Ask me anything, or tell me what to set up'}
              onPickKeyFile={picker.open}
            />
          </div>

          {drop.over && (
            <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-2xl border-2 border-dashed border-[hsl(var(--growth-assistant))]/60 bg-background/85">
              <p className="flex items-center gap-2 text-sm font-medium">
                <FileKeyIcon className="h-4 w-4 text-[hsl(var(--growth-assistant))]" />
                Drop your key file. It stays on this computer
              </p>
            </div>
          )}
          {picker.element}
        </section>
        {browserShown && (
          <GrowthBrowserPane
            className={cn('animate-in fade-in duration-300', wide ? 'w-[56%] min-w-[440px] max-w-[980px] border-l' : 'flex-1')}
            shown={view.active}
            phase={chat.phase}
            activity={runningStep?.kind === 'step' ? runningStep.text : null}
            waitingFor={waitingFor}
            waitAction={waitAction}
          />
        )}
      </div>
    </div>
  );
}
