// What Uptime keeps, as the desktop app's Rust side hands it over
// (src-tauri/src/uptime/model.rs and mod.rs). The checks, the schedule and
// the history all live there; the page only shows them and sends changes.

export type MonitorKind = 'http' | 'port' | 'ping' | 'dns' | 'store';

/** One check: up, down, failed and being checked again, failed while this computer had no network, or couldn't tell either way. */
export type BeatStatus = 'up' | 'down' | 'pending' | 'offline' | 'unclear';

/** Where a monitor stands now. */
export type MonitorState = 'unknown' | 'up' | 'down' | 'pending' | 'paused';

export type JsonOp = 'eq' | 'ne' | 'contains' | 'lt' | 'gt';
export type DnsType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'CAA';
export type StoreName = 'apple' | 'google';

export interface Header {
  name: string;
  value: string;
}

export interface Monitor {
  id: string;
  name: string;
  kind: MonitorKind;
  /** Seconds between checks. */
  interval: number;
  /** Seconds a check may take. */
  timeout: number;
  /** Failed checks in a row that count as "checking again" before the monitor is down. */
  retries: number;
  retryInterval: number;
  paused: boolean;
  /** When a pause ends by itself, ms since 1970. */
  pausedUntil: number | null;
  /** Alert places this monitor leaves out. */
  skipAlerts: string[];
  /** Checks slower than this are marked slow. 0 is off. */
  slowMs: number;
  created: number;
  url: string;
  method: string;
  headers: Header[];
  body: string;
  /** Status codes that count as up, such as "200-299". */
  accept: string;
  redirects: number;
  ignoreTls: boolean;
  /** Alert this many days before the certificate runs out. 0 is off. */
  certDays: number;
  keyword: string;
  keywordAbsent: boolean;
  keywordCase: boolean;
  jsonPath: string;
  jsonOp: JsonOp;
  jsonExpected: string;
  host: string;
  port: number;
  dnsType: DnsType;
  dnsServer: string;
  dnsExpect: string;
  store: StoreName;
  appId: string;
  country: string;
  /** Google Play only: up with a Pre-register button or none, for an app open for pre-registration. Off, only Install or a price counts. */
  listedOk: boolean;
  /** The name is one Uptime made, so it may follow the monitor to a new target. Null in a monitor saved before this was kept. */
  autoName?: boolean | null;
}

export interface Beat {
  /** When the check started, ms since 1970. */
  t: number;
  s: BeatStatus;
  ms?: number;
  code?: number;
  /** Why it failed, as a code: timeout, dns, refused, reset, unreachable, tls, status, redirects, keyword, keyword_found, json, json_invalid, dns_empty, dns_mismatch, store_missing, error. */
  why?: string;
  /** Why it failed, in words. */
  msg?: string;
  slow?: boolean;
}

export interface Cert {
  expires: number;
  issued: number;
  issuer: string;
  subject: string;
}

/** What the last answer said beyond up or down. */
export interface Detail {
  at: number;
  ip?: string;
  finalUrl?: string;
  cert?: Cert;
  server?: string;
  bytes?: number;
  answers?: string[];
  found?: string;
  version?: string;
  appName?: string;
  /** What Google Play offers: Install, a price, or Pre-register. */
  offer?: string;
  /** The network library's own error text. */
  tech?: string;
}

export interface Summary {
  id: string;
  state: MonitorState;
  since: number | null;
  last: Beat | null;
  /** The last checks, oldest first. */
  recent: Beat[];
  /** When the next check starts. */
  next: number | null;
  running: boolean;
  fails: number;
  uptime24: number | null;
  uptime7: number | null;
  uptime30: number | null;
  avg24: number | null;
  detail: Detail;
  downSince: number | null;
  downMsg: string;
  version: string | null;
  /** Moves on whenever this monitor's history changes (an outage, a pause, a clear). */
  revision: number;
  /** Goes up with every change to the monitor's state: of two summaries, the higher is the newer. */
  stamp: number;
}

export type TargetKind = 'slack' | 'discord' | 'telegram' | 'ntfy' | 'webhook';

/** A place alerts go besides this computer's notifications. */
export interface Target {
  id: string;
  kind: TargetKind;
  name: string;
  url: string;
  token: string;
  chat: string;
  topic: string;
  enabled: boolean;
  down: boolean;
  up: boolean;
  cert: boolean;
  news: boolean;
}

export interface Settings {
  desktop: boolean;
  sound: boolean;
  badge: boolean;
  /** Minutes between reminders while a monitor stays down. 0 never reminds. */
  remind: number;
  targets: Target[];
  /** Settings::rev: moves on with each save; a save made from an older one is refused. */
  rev?: number;
}

export interface Delivery {
  at: number;
  target: string;
  name: string;
  ok: boolean;
  note: string;
  title: string;
}

export interface UptimeView {
  /** Engine::stamps when this view was made: of two views, the higher has the newer list. */
  stamp?: number;
  /** The page's own: the stamp of the view or check that last set `offlineSince`. */
  offlineStamp?: number;
  /** The page's own: checks of monitors no view has shown yet (`mergeView`). */
  early?: Summary[];
  loaded: boolean;
  monitors: Monitor[];
  summaries: Summary[];
  settings: Settings;
  offlineSince: number | null;
  deliveries: Delivery[];
  /** Who shows this computer's notifications: Rust (native), the page (page), or nobody (none). */
  notifications: 'native' | 'page' | 'none';
  now: number;
}

/** An hour's totals: ms seen up and down, checks, and response times. */
export interface Bucket {
  t: number;
  up: number;
  down: number;
  n: number;
  fails: number;
  sum: number;
  cnt: number;
  min: number;
  max: number;
  /** The stretches of the hour that were seen, as [start, end, down] in ms from the start of the hour. */
  spans?: Array<[number, number, number]>;
  /** Where the latest time seen in the hour ends, in ms from its start. Missing when not known. */
  until?: number;
}

export type EventKind = 'down' | 'up' | 'paused' | 'resumed' | 'cert' | 'version' | 'added' | 'changed';

export interface UptimeEvent {
  /** The monitor's id. */
  id: string;
  t: number;
  kind: EventKind;
  msg?: string;
  why?: string;
  /** For "up": ms from the first failed check to the check that passed. */
  dur?: number;
  /** For "up": of `dur`, the ms the app was open and checking. */
  seen?: number;
  code?: number;
}

export interface TestResult {
  ok: boolean;
  ms?: number | null;
  code?: number | null;
  why: string;
  msg: string;
  detail: Detail;
  /** The check couldn't tell up from down, so the monitor wouldn't count it either way. */
  inconclusive?: boolean;
}

export interface UptimeAlert {
  id: string;
  name: string;
  kind: 'down' | 'up' | 'cert' | 'news' | 'reminder' | 'test';
  title: string;
  body: string;
  target: string;
  at: number;
  downFor?: number;
  why?: string;
}

export interface BeatPayload {
  id: string;
  beat: Beat;
  summary: Summary;
  offlineSince: number | null;
}

/**
 * A new monitor before the user fills it in. Matches Monitor::default in
 * model.rs, except that its name starts as one Uptime makes (`autoName`).
 */
export function newMonitor(kind: MonitorKind = 'http'): Monitor {
  return {
    id: '',
    name: '',
    kind,
    interval: 60,
    timeout: 10,
    retries: 1,
    retryInterval: 20,
    paused: false,
    pausedUntil: null,
    skipAlerts: [],
    slowMs: 0,
    created: 0,
    url: '',
    method: 'GET',
    headers: [],
    body: '',
    accept: '200-299',
    redirects: 10,
    ignoreTls: false,
    certDays: 14,
    keyword: '',
    keywordAbsent: false,
    keywordCase: false,
    jsonPath: '',
    jsonOp: 'eq',
    jsonExpected: '',
    host: '',
    port: 443,
    dnsType: 'A',
    dnsServer: '',
    dnsExpect: '',
    store: 'apple',
    appId: '',
    country: 'us',
    listedOk: false,
    autoName: true,
  };
}

export function newTarget(kind: TargetKind): Target {
  return { id: '', kind, name: '', url: kind === 'ntfy' ? 'https://ntfy.sh' : '', token: '', chat: '', topic: '', enabled: true, down: true, up: true, cert: true, news: true };
}

export const DEFAULT_SETTINGS: Settings = { desktop: true, sound: true, badge: true, remind: 0, targets: [] };
