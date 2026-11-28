// What the user pasted into "Add a monitor", read as a monitor: a web
// address, an App Store or Google Play link, a server with a port, an IP
// address or a plain domain name. The form fills itself from the answer and
// the user can still change every field.

import { newMonitor, type Monitor, type MonitorKind } from './types';

export interface Detected {
  kind: MonitorKind;
  /** The fields to fill in. */
  fields: Partial<Monitor>;
  /** A name to suggest. */
  name: string;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)*$/i;

export function isIp(text: string): boolean {
  return IPV4.test(text) || (text.includes(':') && /^[0-9a-f:.]+$/i.test(text));
}

export function isHostName(text: string): boolean {
  return HOSTNAME.test(text) || isIp(text);
}

/** A short name from a web address: the host without www., and the path when there is one. */
export function nameFromUrl(text: string): string {
  try {
    const url = new URL(text);
    const host = url.hostname.replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '');
    return path ? `${host}${path}` : host;
  } catch {
    return text;
  }
}

function storeLink(url: URL): Detected | null {
  if (url.hostname === 'apps.apple.com' || url.hostname === 'itunes.apple.com') {
    const id = url.pathname.match(/\/id(\d{3,12})/)?.[1] ?? url.searchParams.get('id');
    if (!id || !/^\d+$/.test(id)) return null;
    const country = url.pathname.match(/^\/([a-z]{2})\//i)?.[1]?.toLowerCase() ?? 'us';
    const slug = url.pathname.match(/\/app\/([^/]+)\/id\d+/)?.[1];
    const name = slug ? decodeURIComponent(slug).replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'App Store listing';
    return { kind: 'store', fields: { store: 'apple', appId: id, country }, name };
  }
  if (url.hostname === 'play.google.com') {
    const id = url.searchParams.get('id');
    if (!id) return null;
    const country = (url.searchParams.get('gl') ?? 'us').toLowerCase();
    return { kind: 'store', fields: { store: 'google', appId: id, country: /^[a-z]{2}$/.test(country) ? country : 'us' }, name: id };
  }
  return null;
}

/** Reads what was pasted. Null when it isn't any kind of address. */
export function detect(input: string): Detected | null {
  const text = input.trim();
  if (!text) return null;

  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      return storeLink(url) ?? { kind: 'http', fields: { url: text }, name: nameFromUrl(text) };
    } catch {
      return null;
    }
  }

  // [2001:db8::1]:8080, host:port.
  const bracketed = text.match(/^\[([0-9a-f:.]+)\]:(\d{1,5})$/i);
  if (bracketed) {
    const port = Number(bracketed[2]);
    if (port >= 1 && port <= 65535) return { kind: 'port', fields: { host: bracketed[1], port }, name: `${bracketed[1]} port ${port}` };
  }
  const hostPort = text.match(/^([^:\s/]+):(\d{1,5})$/);
  if (hostPort && isHostName(hostPort[1])) {
    const port = Number(hostPort[2]);
    if (port >= 1 && port <= 65535) {
      // A web port reads as a website, the way the user would open it.
      if (port === 80 || port === 443 || port === 8080 || port === 8443) {
        const scheme = port === 443 || port === 8443 ? 'https' : 'http';
        const url = port === 80 || port === 443 ? `${scheme}://${hostPort[1]}` : `${scheme}://${hostPort[1]}:${port}`;
        return { kind: 'http', fields: { url }, name: nameFromUrl(url) };
      }
      return { kind: 'port', fields: { host: hostPort[1], port }, name: `${hostPort[1]} port ${port}` };
    }
  }

  if (isIp(text)) return { kind: 'ping', fields: { host: text }, name: text };

  // A plain domain: most people mean the website on it.
  if (isHostName(text) && text.includes('.')) {
    const url = `https://${text.toLowerCase()}`;
    return { kind: 'http', fields: { url }, name: nameFromUrl(url) };
  }
  // A path without a scheme, such as example.com/health.
  if (/^[a-z0-9.-]+\.[a-z]{2,}\/\S*$/i.test(text)) {
    const url = `https://${text}`;
    return { kind: 'http', fields: { url }, name: nameFromUrl(url) };
  }
  return null;
}

/** A monitor filled from a paste, keeping the rest of `base`. */
export function applyDetected(base: Monitor, detected: Detected): Monitor {
  const next: Monitor = { ...base, ...detected.fields, kind: detected.kind };
  if (!base.name.trim()) next.name = detected.name;
  return next;
}

export function monitorFromInput(input: string): Monitor | null {
  const detected = detect(input);
  return detected ? applyDetected(newMonitor(detected.kind), detected) : null;
}
