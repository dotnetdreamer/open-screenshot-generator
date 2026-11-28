// Monitors worth adding, from what the app already knows about the user's
// apps: the site the Website view published (its home, support and privacy
// pages, the two Apple and Google ask every app for), the store links on
// that site, and the apps connected in Growth. Nothing here goes online.

import { listSiteDrafts } from '@/lib/website/store';
import { readMeta } from '@/lib/growth/db';
import { getStoreCredentials } from '@/lib/publish/credentials';
import { detect, applyDetected } from './detect';
import { newMonitor, type Monitor } from './types';

export interface Suggestion {
  key: string;
  title: string;
  /** Why this one is worth watching. */
  hint: string;
  monitor: Monitor;
}

/** The same thing watched twice reads as one: same kind and same address. */
export function targetKey(monitor: Pick<Monitor, 'kind' | 'url' | 'host' | 'port' | 'dnsType' | 'store' | 'appId' | 'country'>): string {
  switch (monitor.kind) {
    case 'http':
      return `http:${monitor.url.trim().replace(/\/+$/, '').toLowerCase()}`;
    case 'port':
      return `port:${monitor.host.toLowerCase()}:${monitor.port}`;
    case 'ping':
      return `ping:${monitor.host.toLowerCase()}`;
    case 'dns':
      return `dns:${monitor.dnsType}:${monitor.host.toLowerCase()}`;
    case 'store':
      return `store:${monitor.store}:${monitor.appId}:${monitor.country}`;
  }
}

function web(name: string, url: string): Monitor {
  return { ...newMonitor('http'), name, url };
}

/** Everything worth suggesting that isn't watched already. */
export async function findSuggestions(existing: Monitor[]): Promise<Suggestion[]> {
  const watched = new Set(existing.map(targetKey));
  const found: Suggestion[] = [];
  const add = (suggestion: Suggestion) => {
    const key = targetKey(suggestion.monitor);
    if (watched.has(key) || found.some((other) => targetKey(other.monitor) === key)) return;
    found.push({ ...suggestion, key });
  };

  try {
    for (const draft of await listSiteDrafts()) {
      const name = draft.facts.appName.trim() || 'Your app';
      const site = draft.publish?.url;
      if (site) {
        // The page folders render.ts's pageDir gives the base language.
        const root = site.replace(/\/?$/, '/');
        add({ key: '', title: `${name} website`, hint: 'The site you published from Website', monitor: web(`${name} website`, root) });
        add({ key: '', title: `${name} support page`, hint: 'Apple and Google check that this page opens', monitor: web(`${name} support page`, `${root}support/`) });
        add({ key: '', title: `${name} privacy policy`, hint: 'A privacy policy that doesn\'t open can get an app rejected', monitor: web(`${name} privacy policy`, `${root}privacy/`) });
      }
      for (const link of [draft.facts.appStoreUrl, draft.facts.playStoreUrl]) {
        const detected = link ? detect(link) : null;
        if (detected?.kind !== 'store') continue;
        const monitor = applyDetected({ ...newMonitor('store'), name: `${name} on ${detected.fields.store === 'google' ? 'Google Play' : 'the App Store'}` }, detected);
        add({ key: '', title: monitor.name, hint: 'Know at once if the app stops being on sale', monitor });
      }
    }
  } catch (error) {
    console.error('Uptime could not read the Website drafts', error);
  }

  try {
    const credentials = getStoreCredentials();
    const key = credentials.appstore;
    // Growth's cached app list (metaKeys in growth/sync.ts writes it under this name).
    const apps = key ? ((await readMeta<Array<{ id: string; name: string }>>(`apps:list:${key.issuerId}:${key.keyId}`)) ?? []) : [];
    for (const app of apps) {
      if (!/^\d+$/.test(app.id)) continue;
      add({
        key: '',
        title: `${app.name} on the App Store`,
        hint: 'From Growth. Know at once if the app stops being on sale',
        monitor: { ...newMonitor('store'), name: `${app.name} on the App Store`, store: 'apple', appId: app.id, country: 'us' },
      });
    }
    const packageName = credentials.playstore?.packageName.trim();
    if (packageName) {
      add({
        key: '',
        title: `${packageName} on Google Play`,
        hint: 'From Growth. Know at once if the app stops being on sale',
        monitor: { ...newMonitor('store'), name: `${packageName} on Google Play`, store: 'google', appId: packageName, country: 'us' },
      });
    }
  } catch (error) {
    console.error('Uptime could not read the Growth apps', error);
  }
  return found.slice(0, 8);
}
