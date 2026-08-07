"use client";
// Persistent MCP-server status pill + info dialog (desktop only).
//
// The on/off switch lives in the native Settings menu; this shows the current
// state at a glance while you work (green + port when the local MCP server is
// running, muted "off" otherwise). Clicking opens a dialog with the connection
// URL, collapsible setup instructions per client (Claude Code, Claude Desktop,
// VS Code, Cursor), and the design tools it exposes. Renders nothing on the web.

import React, { useEffect, useState } from 'react';
import { CopyIcon, CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { isTauri } from '@/lib/desktop';
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
import { useT, type TFunction } from '@/i18n';

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

// Small copy-to-clipboard button with a transient check state. `label` is a
// ready-to-show, already-translated title.
function CopyButton({ value, label }: { value: string; label: string }) {
  const { toast } = useToast();
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={label}
      onClick={async () => {
        if (await copyText(value)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } else {
          toast({ title: t('mcp.couldNotCopy'), description: value });
        }
      }}
      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-600" /> : <CopyIcon className="h-3.5 w-3.5" />}
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

// A single example prompt with a copy button. Prompt text itself stays in
// English: it is pasted into an AI client, not UI chrome.
function ExamplePrompt({ text }: { text: string }) {
  const t = useT();
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 p-2">
      <p className="min-w-0 flex-1 text-[11px] leading-snug text-foreground">{text}</p>
      <CopyButton value={text} label={t('mcp.copyPrompt')} />
    </div>
  );
}

// A copyable code block (command or config snippet).
function CodeBlock({ code }: { code: string }) {
  const t = useT();
  return (
    <div className="relative rounded-md border border-border bg-muted/40">
      <pre className="max-w-full overflow-x-auto p-2.5 pr-9 text-[11px] leading-relaxed">
        <code>{code}</code>
      </pre>
      <div className="absolute right-1 top-1">
        <CopyButton value={code} label={t('mcp.copySnippet')} />
      </div>
    </div>
  );
}

// Per-client setup instructions, parameterised by the live server URL. Menu
// paths and file names quote the desktop app's native (English-only) UI, so
// those fragments stay verbatim inside the translated sentences.
function clientGuides(url: string, t: TFunction) {
  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      body: (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">{t('mcp.guideClaudeCodeA')} <code>/mcp</code> {t('mcp.guideClaudeCodeB')}</p>
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
            {t('mcp.guideClaudeDesktopA')} <span className="font-medium text-foreground">{t('mcp.guideClaudeDesktopB')}</span>{t('mcp.guideClaudeDesktopC')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('mcp.guideClaudeDesktopD')} <code>claude_desktop_config.json</code> {t('mcp.guideClaudeDesktopE')}
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
            {t('mcp.guideVscodeA')} <span className="font-medium text-foreground">{t('mcp.guideVscodeB')}</span> {t('mcp.guideVscodeC')}{' '}
            <code>.vscode/mcp.json</code> {t('mcp.guideVscodeD')}
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
            {t('mcp.guideCursorA')} <code>~/.cursor/mcp.json</code> {t('mcp.guideCursorB')} <code>.cursor/mcp.json</code> {t('mcp.guideCursorC')}
          </p>
          <CodeBlock code={JSON.stringify({ mcpServers: { 'open-screenshot-generator': { url } } }, null, 2)} />
        </div>
      ),
    },
  ];
}

export function McpServerStatus({ className }: { className?: string }) {
  const t = useT();
  // Start hidden so the first client render matches the server-rendered HTML
  // (the static export is built without Tauri, so this is absent there). Only
  // after mount do we know we are in the desktop shell and can show the pill —
  // rendering it during hydration would be a mismatch.
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<Status>({ running: false, port: null, url: null });

  useEffect(() => {
    setMounted(true);
    if (!isTauri()) return;
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

  // Nothing to show until mounted (avoids hydration mismatch) or on the web.
  if (!mounted || !isTauri()) return null;

  const { running, port } = status;
  const url = status.url ?? DEFAULT_URL;
  const tools = getMcpToolSummaries();
  const guides = clientGuides(url, t);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          title={t('mcp.pillTitle')}
          className={cn(
            'flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur transition-colors hover:border-primary/50',
            className
          )}
        >
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              running ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/40'
            )}
          />
          <span className="font-semibold tracking-tight">MCP</span>
          {running ? (
            <span className="tabular-nums text-muted-foreground">:{port}</span>
          ) : (
            <span className="text-muted-foreground">{t('mcp.off')}</span>
          )}
        </button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[88vh] w-[92vw] flex-col gap-0 overflow-hidden sm:max-w-[960px]">
        <DialogHeader className="pb-3">
          <DialogTitle className="flex items-center gap-2">
            {t('mcp.dialogTitle')}
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-medium',
                running ? 'bg-green-500/15 text-green-600' : 'bg-muted text-muted-foreground'
              )}
            >
              {running ? t('mcp.running') : t('mcp.offBadge')}
            </span>
          </DialogTitle>
          <DialogDescription>
            {t('mcp.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {!running && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {t('mcp.serverOffNote')}{' '}
              <span className="font-medium">Settings ▸ Run MCP server for external AI tools</span>.
            </p>
          )}

          <div className="grid gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('mcp.serverUrl')}</span>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5">
              <code className="min-w-0 flex-1 truncate text-xs">{url}</code>
              <CopyButton value={url} label={t('mcp.copyUrl')} />
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('mcp.setupClient')}</div>
            <Accordion type="multiple" defaultValue={[...guides.map((g) => g.id), 'examples', 'tools']} className="w-full">
              {guides.map((g) => (
                <AccordionItem key={g.id} value={g.id}>
                  <AccordionTrigger className="text-sm">{g.name}</AccordionTrigger>
                  <AccordionContent>{g.body}</AccordionContent>
                </AccordionItem>
              ))}

              <AccordionItem value="examples">
                <AccordionTrigger className="text-sm">{t('mcp.examplePrompts')}</AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-2">
                    <p className="text-xs text-muted-foreground">
                      {t('mcp.examplePromptsHelp')}
                    </p>
                    {EXAMPLE_PROMPTS.map((text) => (
                      <ExamplePrompt key={text} text={text} />
                    ))}
                    <p className="pt-1 text-xs text-muted-foreground">{t('mcp.orCallTool')}</p>
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
                <AccordionTrigger className="text-sm">{t('mcp.exposedTools', { count: tools.length })}</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
                    {tools.map((tool) => (
                      <div key={tool.name} className="rounded-md border border-border/60 p-2">
                        <code className="text-xs font-semibold text-foreground">{tool.name}</code>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{tool.description}</p>
                        {tool.params.length > 0 && (
                          <p className="mt-1 text-[10px] text-muted-foreground/80">
                            <span className="font-medium">{t('mcp.paramsLabel')}</span> {tool.params.join(', ')}
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
          <p className="text-[11px] text-muted-foreground">
            {t('mcp.footerNote')}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
