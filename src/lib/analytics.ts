// Google Analytics (GA4) event tracking for the editor.
//
// One GA4 property (G-8LQTR1SPDK) serves both the marketing site and this
// editor; GA splits the traffic by hostname (openscrgen.app vs
// editor.openscrgen.app) so a single measurement id is all we need.
//
// We only ever send coarse, non-identifying interaction signals: which
// template was picked, which device format was chosen, and that an export
// happened. We never send project content, screenshots, file names, or
// anything a user loads. Their designs still never leave the machine, which
// keeps the "runs in your browser, nothing leaves your machine" promise intact.
//
// gtag.js itself is injected by <Analytics /> (see src/components/Analytics.tsx).

export const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_ID || 'G-8LQTR1SPDK';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

// GA is skipped on localhost (dev traffic would pollute the reports) and in the
// Tauri desktop shell (offline-friendly, stricter CSP, and desktop users opted
// out of the cloud on purpose). Everywhere else, gtag has to have loaded first.
function analyticsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (!GA_MEASUREMENT_ID) return false;
  if ('__TAURI_INTERNALS__' in window) return false;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '') return false;
  return typeof window.gtag === 'function';
}

// Fire a GA4 event. Silently no-ops when analytics is disabled or gtag has not
// loaded yet, so call sites never need to guard.
export function track(event: string, params: Record<string, unknown> = {}): void {
  if (!analyticsEnabled()) return;
  try {
    window.gtag?.('event', event, params);
  } catch {
    // Never let an analytics failure break a real user action.
  }
}

// ---- Named events -------------------------------------------------------
// Thin wrappers so call sites stay readable and event names/params stay
// consistent across the app.

export function trackTemplateSelected(params: {
  templateId?: string;
  templateName?: string;
  category?: string;
}): void {
  track('template_selected', {
    template_id: params.templateId,
    template_name: params.templateName,
    category: params.category,
  });
}

export function trackDeviceFormatSelected(params: {
  format: string;
  formatLabel?: string;
}): void {
  track('device_format_selected', {
    format: params.format,
    format_label: params.formatLabel,
  });
}

export function trackExportPng(params: {
  mode: 'as_is' | 'app_store' | 'quick';
  formats?: string[];
  artboardCount: number;
  fileCount: number;
}): void {
  track('export_png', {
    mode: params.mode,
    formats: params.formats?.join(',') || 'none',
    artboard_count: params.artboardCount,
    file_count: params.fileCount,
  });
}

export function trackExportVideo(params: {
  fps: number;
  durationSeconds: number;
  sizeMode: string;
  rawRecordingOnly: boolean;
}): void {
  track('export_video', {
    fps: params.fps,
    duration_seconds: params.durationSeconds,
    size_mode: params.sizeMode,
    raw_recording_only: params.rawRecordingOnly,
  });
}

export function trackExportJson(): void {
  track('export_json');
}
