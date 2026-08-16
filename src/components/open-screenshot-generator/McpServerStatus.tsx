"use client";
// Persistent MCP-server status pill + info dialog.
//
// Two transports behind one piece of UI:
//
//   Desktop — Rust hosts the server on 127.0.0.1 and the on/off switch lives in
//   the native Settings menu. The pill mirrors that state (green + port when
//   running) and the dialog hands out the local URL.
//
//   Web — the tab cannot listen on a port, so it connects out to the relay in
//   infra/vps/mcp-relay and the dialog's own Connect button is the switch. The
//   URL carries a random code that identifies this tab. Needs
//   NEXT_PUBLIC_MCP_RELAY_URL; without it the web build renders nothing at all.
//
// Either way the dialog is the same: connection URL, per-client setup snippets
// (Claude Code, Claude Desktop, VS Code, Cursor), example prompts and the tools.

import React, { useEffect, useRef, useState } from 'react';
import { CopyIcon, CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { isTauri } from '@/lib/desktop';
import {
  MCP_RELAY_URL,
  getRelayCode,
  relayClientUrl,
  relayConfigured,
  relayEnabled,
  resetRelayCode,
  setRelayEnabled,
  startRelayMcpBridge,
  type RelayState,
} from '@/lib/mcp/relayBridge';
import type { McpDesignApi } from '@/lib/mcp/desktopMcpServer';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Separator } from '@/components/ui/separator';
import {
  getMcpStatus,
  listenMcpStatus,
  getMcpToolSummaries,
  type McpServerStatus as Status,
} from '@/lib/mcp/desktopMcpServer';

const DEFAULT_URL = 'http://127.0.0.1:8722/mcp';

async function copyText(text: string): Promise<boolean> {
  // WebView2 (and every browser we target) is Chromium, so the async Clipboard
  // API is available; the click gives us the required user gesture.
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Small copy-to-clipboard button with a transient check state.
function CopyButton({ value, label }: { value: string; label: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${label}`}
      onClick={async () => {
        if (await copyText(value)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } else {
          toast({ title: 'Could not copy', description: value });
        }
      }}
      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-600 dark:text-green-400" /> : <CopyIcon className="h-3.5 w-3.5" />}
    </button>
  );
}

// Natural-language prompts the user can paste into their AI client to exercise
// the tools end to end.
const EXAMPLE_PROMPTS: string[] = [
  'Find an App Store template with 3 device frames, start a project from it called "Habit Tracker", and rewrite the headlines for a habit tracking app.',
  'Create a new 1290×2796 artboard called "Onboarding" with a purple-to-blue gradient background.',
  'On the active artboard, add a bold white headline "Plan your week" near the top, then a rounded rectangle card below it.',
  'Add a 3D iPhone tilted to the left on the active artboard, then put an App Store badge under it.',
  'Show me my recent projects, open the newest one and describe what is on each artboard.',
  'Browse the elements library for wave shapes and add one across the bottom of the artboard in #1D4ED8.',
  'Build one finished screenshot, then duplicate it four times and change only the headline and the mockup on each copy.',
  'Upload this app icon once, then place it on every artboard 200px above the headline.',
  'Give the headline a soft drop shadow, tighten its letter spacing, and tell me the real height of the text.',
  'Export every artboard at full size into a folder and give me the file paths.',
];

// A single example prompt with a copy button.
function ExamplePrompt({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 p-2">
      <p className="min-w-0 flex-1 text-[11px] leading-snug text-foreground">{text}</p>
      <CopyButton value={text} label="prompt" />
    </div>
  );
}

// A copyable code block (command or config snippet).
function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative rounded-md border border-border bg-muted/40">
      <pre className="max-w-full overflow-x-auto p-2.5 pr-9 text-[11px] leading-relaxed">
        <code>{code}</code>
      </pre>
      <div className="absolute right-1 top-1">
        <CopyButton value={code} label="snippet" />
      </div>
    </div>
  );
}

// Per-client setup instructions, parameterised by the live server URL.
function clientGuides(url: string) {
  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      body: (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">Run this in a terminal, then use <code>/mcp</code> in a session:</p>
          <CodeBlock code={`claude mcp add --transport http open-screenshot-generator ${url}`} />
        </div>
      ),
    },
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      body: (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">
            Settings → Connectors → <span className="font-medium text-foreground">Add custom connector</span>, then paste the URL above.
          </p>
          <p className="text-xs text-muted-foreground">
            Or add it to <code>claude_desktop_config.json</code> via a stdio bridge, then restart Claude:
          </p>
          <CodeBlock
            code={JSON.stringify(
              { mcpServers: { 'open-screenshot-generator': { command: 'npx', args: ['mcp-remote', url] } } },
              null,
              2
            )}
          />
        </div>
      ),
    },
    {
      id: 'vscode',
      name: 'VS Code (Copilot)',
      body: (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">
            Command Palette → <span className="font-medium text-foreground">MCP: Add Server</span> → HTTP → paste the URL, or create{' '}
            <code>.vscode/mcp.json</code> in your workspace:
          </p>
          <CodeBlock
            code={JSON.stringify({ servers: { 'open-screenshot-generator': { type: 'http', url } } }, null, 2)}
          />
        </div>
      ),
    },
    {
      id: 'cursor',
      name: 'Cursor',
      body: (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">
            Add to <code>~/.cursor/mcp.json</code> (global) or <code>.cursor/mcp.json</code> (project):
          </p>
          <CodeBlock code={JSON.stringify({ mcpServers: { 'open-screenshot-generator': { url } } }, null, 2)} />
        </div>
      ),
    },
  ];
}

export function McpServerStatus({
  className,
  getApi,
}: {
  className?: string;
  /** The live design tools. Web only: the desktop bridge is wired up in the
   *  layout, but on the web this component owns the connection. */
  getApi?: () => McpDesignApi | null;
}) {
  // Start hidden so the first client render matches the server-rendered HTML
  // (the static export is built without Tauri, and localStorage is unreadable
  // during SSR). Only after mount do we know which shell we are in — rendering
  // either variant during hydration would be a mismatch.
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<Status>({ running: false, port: null, url: null });
  const [relayState, setRelayState] = useState<RelayState>('off');
  const [code, setCode] = useState('');
  const [connect, setConnect] = useState(false);

  // Read per render rather than captured: a new inline getApi prop on every
  // parent render must not tear down and re-open the event stream.
  const apiRef = useRef(getApi);
  apiRef.current = getApi;

  useEffect(() => {
    setMounted(true);
    if (!isTauri()) {
      // Web: restore the link and whether it was left switched on.
      if (relayConfigured()) {
        setCode(getRelayCode());
        setConnect(relayEnabled());
      }
      return;
    }
    let disposed = false;
    let unlisten: () => void = () => {};
    (async () => {
      const initial = await getMcpStatus();
      if (!disposed) setStatus(initial);
      unlisten = await listenMcpStatus((s) => {
        if (!disposed) setStatus(s);
      });
      if (disposed) unlisten();
    })();
    return () => {
      disposed = true;
      unlisten();
    };
  }, []);

  // Web: hold the connection open for as long as the switch is on.
  useEffect(() => {
    if (!connect || !code || isTauri() || !relayConfigured()) return;
    return startRelayMcpBridge({
      getApi: () => apiRef.current?.() ?? null,
      code,
      onState: setRelayState,
    });
  }, [connect, code]);

  const desktop = mounted && isTauri();
  const web = mounted && !isTauri() && relayConfigured();

  // Nothing until mounted (hydration), and nothing on a web build with no relay
  // configured — that build has no way to serve MCP at all.
  if (!desktop && !web) return null;

  const running = desktop ? status.running : relayState === 'connected';
  const url = desktop ? status.url ?? DEFAULT_URL : relayClientUrl(code || '…');
  const tools = getMcpToolSummaries();
  const guides = clientGuides(url);
  const connecting = web && connect && relayState !== 'connected';
  const pillLabel = desktop
    ? running
      ? `:${status.port}`
      : 'off'
    : relayState === 'connected'
      ? 'on'
      : connecting
        ? 'connecting'
        : 'off';

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          title="MCP server, click for connection details and tools"
          className={cn(
            'flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur transition-colors hover:border-primary/50',
            className
          )}
        >
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              running ? 'bg-green-500 animate-pulse' : connecting ? 'bg-amber-500 animate-pulse' : 'bg-muted-foreground/40'
            )}
          />
          <span className="font-semibold tracking-tight">MCP</span>
          <span className={cn('text-muted-foreground', desktop && running && 'tabular-nums')}>{pillLabel}</span>
        </button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[88vh] w-[92vw] flex-col gap-0 overflow-hidden sm:max-w-[960px]">
        <DialogHeader className="pb-3">
          <DialogTitle className="flex items-center gap-2">
            MCP server
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-medium',
                running
                  ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                  : connecting
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    : 'bg-muted text-muted-foreground'
              )}
            >
              {running ? (desktop ? 'Running' : 'Connected') : connecting ? 'Connecting' : 'Off'}
            </span>
          </DialogTitle>
          <DialogDescription>
            Let external AI tools drive Open Screenshot Generator. Add the server to a client below, then ask it to design.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {desktop && !running && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              The server is currently off. Turn it on from the menu bar:{' '}
              <span className="font-medium">Settings ▸ Run MCP server for external AI tools</span>.
            </p>
          )}

          {web && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
              <Button
                size="sm"
                variant={connect ? 'outline' : 'default'}
                onClick={() => {
                  const next = !connect;
                  setRelayEnabled(next);
                  setConnect(next);
                  if (!next) setRelayState('off');
                  else setCode(getRelayCode());
                }}
              >
                {connect ? 'Disconnect' : 'Connect'}
              </Button>
              <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
                {relayState === 'error'
                  ? 'Could not reach the connection service. It may be down; this retries on its own.'
                  : running
                    ? 'Your AI client can drive this tab. Keep it open, and keep it visible while it works: a background tab is slowed down by the browser.'
                    : 'Your design tools run in this tab. Connecting gives your AI client a link to reach them.'}
              </p>
            </div>
          )}

          <div className="grid gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {desktop ? 'Server URL' : 'Your private link'}
            </span>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5">
              <code className="min-w-0 flex-1 truncate text-xs">{url}</code>
              <CopyButton value={url} label="URL" />
            </div>
            {web && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                The code in this link is what lets your AI client find this tab, so treat it like a password and paste it
                only into your own client config. It works only while this tab is open.{' '}
                <button
                  type="button"
                  className="font-medium text-foreground underline underline-offset-2"
                  onClick={() => {
                    resetRelayCode();
                    setCode(getRelayCode());
                    toast({ title: 'New link', description: 'The old link stopped working. Paste the new one into your client.' });
                  }}
                >
                  Get a new link
                </button>{' '}
                if it ever gets out.
              </p>
            )}
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Set up your client</div>
            <Accordion type="multiple" defaultValue={[...guides.map((g) => g.id), 'examples', 'tools']} className="w-full">
              {guides.map((g) => (
                <AccordionItem key={g.id} value={g.id}>
                  <AccordionTrigger className="text-sm">{g.name}</AccordionTrigger>
                  <AccordionContent>{g.body}</AccordionContent>
                </AccordionItem>
              ))}

              <AccordionItem value="examples">
                <AccordionTrigger className="text-sm">Example prompts</AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-2">
                    <p className="text-xs text-muted-foreground">
                      Once connected, paste any of these into your AI client (copy on the right):
                    </p>
                    {EXAMPLE_PROMPTS.map((text) => (
                      <ExamplePrompt key={text} text={text} />
                    ))}
                    <p className="pt-1 text-xs text-muted-foreground">Or have it call a tool directly, e.g.:</p>
                    <CodeBlock
                      code={JSON.stringify(
                        { tool: 'add_element', arguments: { type: 'text', content: 'Plan your week', x: 120, y: 220, fontSize: 96, color: '#FFFFFF' } },
                        null,
                        2
                      )}
                    />
                    <CodeBlock
                      code={JSON.stringify(
                        { tool: 'add_element', arguments: { libraryId: 'device3d:iphone-tilted-left-black', x: 340, y: 700 } },
                        null,
                        2
                      )}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="tools">
                <AccordionTrigger className="text-sm">Exposed tools ({tools.length})</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
                    {tools.map((tool) => (
                      <div key={tool.name} className="rounded-md border border-border/60 p-2">
                        <code className="text-xs font-semibold text-foreground">{tool.name}</code>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{tool.description}</p>
                        {tool.params.length > 0 && (
                          <p className="mt-1 text-[10px] text-muted-foreground/80">
                            <span className="font-medium">params:</span> {tool.params.join(', ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          <Separator />
          {desktop ? (
            <p className="text-[11px] text-muted-foreground">
              Served locally over MCP Streamable HTTP (127.0.0.1). Toggle it any time from the Settings menu.
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Your AI client reaches this tab through {MCP_RELAY_URL.replace(/^https?:\/\//, '')}, which passes the
              messages along and stores nothing. Every tool runs here in your browser. Exports come back as images rather
              than files on disk, since a web page cannot write to your folders; the desktop app can.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
