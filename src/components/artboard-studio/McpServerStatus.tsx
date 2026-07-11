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
      {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-600" /> : <CopyIcon className="h-3.5 w-3.5" />}
    </button>
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
          <CodeBlock code={`claude mcp add --transport http artboard-studio ${url}`} />
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
              { mcpServers: { 'artboard-studio': { command: 'npx', args: ['mcp-remote', url] } } },
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
            code={JSON.stringify({ servers: { 'artboard-studio': { type: 'http', url } } }, null, 2)}
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
          <CodeBlock code={JSON.stringify({ mcpServers: { 'artboard-studio': { url } } }, null, 2)} />
        </div>
      ),
    },
  ];
}

export function McpServerStatus({ className }: { className?: string }) {
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
  const guides = clientGuides(url);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          title="MCP server — click for connection details and tools"
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
            <span className="text-muted-foreground">off</span>
          )}
        </button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden sm:max-w-[540px]">
        <DialogHeader className="pb-3">
          <DialogTitle className="flex items-center gap-2">
            MCP server
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-medium',
                running ? 'bg-green-500/15 text-green-600' : 'bg-muted text-muted-foreground'
              )}
            >
              {running ? 'Running' : 'Off'}
            </span>
          </DialogTitle>
          <DialogDescription>
            Let external AI tools drive Artboard Studio. Add the server to a client below, then ask it to design.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {!running && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              The server is currently off. Turn it on from the menu bar:{' '}
              <span className="font-medium">Settings ▸ Run MCP server for external AI tools</span>.
            </p>
          )}

          <div className="grid gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Server URL</span>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5">
              <code className="min-w-0 flex-1 truncate text-xs">{url}</code>
              <CopyButton value={url} label="URL" />
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Set up your client</div>
            <Accordion type="single" collapsible defaultValue="claude-code" className="w-full">
              {guides.map((g) => (
                <AccordionItem key={g.id} value={g.id}>
                  <AccordionTrigger className="text-sm">{g.name}</AccordionTrigger>
                  <AccordionContent>{g.body}</AccordionContent>
                </AccordionItem>
              ))}
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
          <p className="text-[11px] text-muted-foreground">
            Served locally over MCP Streamable HTTP (127.0.0.1). Toggle it any time from the Settings menu.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
