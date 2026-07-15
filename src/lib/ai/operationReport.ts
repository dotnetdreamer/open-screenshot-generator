/**
 * Renders an Operation (see operationLog.ts) as a single self-contained HTML
 * document: inline CSS, screenshots embedded as the data URLs they already are,
 * no external requests. This is what the "Download HTML report" button saves,
 * so a failed run can be shared or filed as one portable file.
 */

import {
  formatDuration,
  MODE_LABEL,
  operationDurationMs,
  STATUS_LABEL,
  type Operation,
  type TimelineEntry,
} from './operationLog';

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clockTime(t: number): string {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function relTime(t: number, startedAt: number): string {
  const delta = t - startedAt;
  return `+${(delta / 1000).toFixed(2)}s`;
}

const DIRECTION_ARROW: Record<string, string> = {
  'app-to-provider': 'App to provider',
  'provider-to-app': 'Provider to app',
  internal: 'Internal',
};

function entryHtml(entry: TimelineEntry, startedAt: number): string {
  const time = `<span class="t" title="${esc(clockTime(entry.t))}">${esc(relTime(entry.t, startedAt))}</span>`;
  const tag = `<span class="tag tag-${entry.kind}">${esc(entry.kind)}</span>`;
  const dir = entry.direction
    ? `<span class="dir">${esc(DIRECTION_ARROW[entry.direction] ?? entry.direction)}</span>`
    : '';
  const code = entry.code ? `<span class="code">${esc(entry.code)}</span>` : '';
  const label = `<span class="label">${esc(entry.label)}</span>`;

  let body = '';
  if (entry.kind === 'screenshot' && entry.image) {
    body = `<div class="shot"><img src="${esc(entry.image)}" alt="${esc(entry.label)}" loading="lazy" /></div>`;
  } else if (entry.detail) {
    body = `<pre class="detail">${esc(entry.detail)}</pre>`;
  }

  return `<li class="entry entry-${entry.kind}">
    <div class="head">${time} ${tag} ${dir} ${code} ${label}</div>
    ${body}
  </li>`;
}

export function renderOperationReportHtml(op: Operation): string {
  const entries = [...op.entries].sort((a, b) => a.t - b.t);
  const duration = formatDuration(operationDurationMs(op));
  const started = new Date(op.startedAt);
  const shots = entries.filter((e) => e.kind === 'screenshot').length;

  const meta: Array<[string, string]> = [
    ['Provider', `${op.providerLabel} (${op.provider})`],
    ['Mode', MODE_LABEL[op.mode]],
    ...(op.model ? ([['Model', op.model]] as Array<[string, string]>) : []),
    ['Status', STATUS_LABEL[op.status]],
    ['Started', started.toLocaleString()],
    ['Duration', duration],
    ['Screenshots attached', String(op.screenshotCount)],
    ['Screenshots captured', String(shots)],
  ];

  const metaRows = meta
    .map(([k, v]) => `<div class="mrow"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join('');

  const errorBlock =
    op.status === 'error' && op.errorMessage
      ? `<div class="error-banner"><strong>${esc(op.errorCode ?? 'error')}</strong> ${esc(op.errorMessage)}</div>`
      : '';

  const instructionBlock = op.instruction.trim()
    ? `<section class="card"><h2>Instruction</h2><pre class="detail">${esc(op.instruction)}</pre></section>`
    : '';

  const timeline = entries.map((e) => entryHtml(e, op.startedAt)).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Operation report · ${esc(op.providerLabel)} · ${esc(STATUS_LABEL[op.status])}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px 80px;
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1e; background: #f6f7f9;
  }
  .wrap { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; margin: 0 0 10px; }
  .sub { color: #6b7280; margin: 0 0 24px; font-size: 13px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px 20px; margin-bottom: 18px; }
  dl.meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; margin: 0; }
  .mrow { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; border-bottom: 1px dashed #eef0f3; }
  .mrow dt { color: #6b7280; margin: 0; }
  .mrow dd { margin: 0; font-weight: 600; text-align: right; }
  .error-banner { background: #fef2f2; border: 1px solid #f6c9c9; color: #9b1c1c; padding: 10px 14px; border-radius: 10px; margin-bottom: 18px; }
  .error-banner strong { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin-right: 8px; }
  ol.timeline { list-style: none; margin: 0; padding: 0; }
  .entry { background: #fff; border: 1px solid #e5e7eb; border-left-width: 4px; border-radius: 10px; padding: 10px 14px; margin-bottom: 10px; }
  .entry-error { border-left-color: #dc2626; }
  .entry-screenshot { border-left-color: #7c3aed; }
  .entry-message { border-left-color: #2563eb; }
  .entry-stage { border-left-color: #059669; }
  .entry-note { border-left-color: #9ca3af; }
  .head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .t { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #9ca3af; min-width: 56px; }
  .tag { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; padding: 1px 7px; border-radius: 999px; background: #eef2ff; color: #4338ca; }
  .tag-error { background: #fee2e2; color: #b91c1c; }
  .tag-screenshot { background: #f3e8ff; color: #7c3aed; }
  .tag-stage { background: #d1fae5; color: #047857; }
  .tag-note { background: #f3f4f6; color: #4b5563; }
  .dir { font-size: 11px; color: #6b7280; background: #f3f4f6; padding: 1px 7px; border-radius: 6px; }
  .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #b45309; background: #fffbeb; padding: 1px 6px; border-radius: 6px; }
  .label { font-weight: 600; }
  pre.detail { margin: 10px 0 0; padding: 10px 12px; background: #0f172a; color: #e2e8f0; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; max-height: 420px; overflow-y: auto; }
  .shot { margin-top: 10px; }
  .shot img { max-width: 100%; border: 1px solid #e5e7eb; border-radius: 8px; display: block; }
  footer { color: #9ca3af; font-size: 12px; text-align: center; margin-top: 28px; }
  @media (prefers-color-scheme: dark) {
    body { color: #e5e7eb; background: #0b0d12; }
    .card, .entry { background: #14171f; border-color: #262b36; }
    h2, .sub, .mrow dt { color: #9ca3af; }
    .mrow { border-bottom-color: #1f242e; }
    .error-banner { background: #2a1416; border-color: #5b2626; color: #fca5a5; }
    .dir, .tag-note { background: #1f242e; color: #cbd5e1; }
    .code { background: #2a2410; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Operation report</h1>
    <p class="sub">${esc(op.providerLabel)} · ${esc(MODE_LABEL[op.mode])} · ${esc(STATUS_LABEL[op.status])}</p>
    ${errorBlock}
    <section class="card"><dl class="meta">${metaRows}</dl></section>
    ${instructionBlock}
    <section class="card">
      <h2>Timeline (${entries.length} events)</h2>
      <ol class="timeline">${timeline || '<li class="entry entry-note"><div class="head"><span class="label">No events were recorded.</span></div></li>'}</ol>
    </section>
    <footer>Generated by Open Screenshot Generator · ${esc(op.id)}</footer>
  </div>
</body>
</html>`;
}
