// The SEO view's side of Ask AI's Google setup (growth/setup/assistant.ts,
// startSeoSetup): what the assistant reads about SEO's Google setup, and the
// three saves it may make. Nothing here touches Growth's Google Play key.

import { configureSeoSetup, type SeoSetupFacts } from '@/lib/growth/setup/assistant';
import { parseServiceAccount } from '@/lib/publish/googlePlay';
import { activeServiceAccount, getSeoGoogle, growthGoogleKey, setSeoGoogle } from './googleSettings';
import { getSeoState } from './state';

function growthKeyFacts(): SeoSetupFacts['growthKey'] {
  const json = growthGoogleKey();
  if (!json) return null;
  try {
    const account = parseServiceAccount(json) as { client_email: string; project_id?: string };
    return { email: account.client_email, projectId: account.project_id ?? null };
  } catch {
    return null;
  }
}

export function seoSetupFacts(): SeoSetupFacts {
  const state = getSeoState();
  const site = state.sites.find((entry) => entry.id === state.activeId) ?? null;
  const key = activeServiceAccount();
  return {
    siteUrl: site?.url || null,
    key: key ? { email: key.email, from: key.from, projectId: key.projectId } : null,
    growthKey: growthKeyFacts(),
    apiKey: Boolean(getSeoGoogle().apiKey),
  };
}

/** Called when the SEO view opens. */
export function registerSeoSetup(): void {
  configureSeoSetup({
    facts: seoSetupFacts,
    saveKey: (json) => setSeoGoogle({ key: json, useGrowthKey: false }),
    useGrowthKey: () => setSeoGoogle({ useGrowthKey: true }),
    saveApiKey: (value) => setSeoGoogle({ apiKey: value.trim() }),
  });
}
