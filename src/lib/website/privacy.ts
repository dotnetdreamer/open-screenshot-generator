// The privacy policy: the questions the Website view asks about what the app
// collects, and the policy written from the answers.
//
// The policy is made of fixed sentences, chosen by the answers, and never
// written by the AI. A policy has to say exactly what the app does, and a
// model asked to write one can add promises nobody made ("we encrypt
// everything", "we never use third parties"). The AI can change the answers
// when the developer tells it something in the chat. The developer can add a
// paragraph of their own (privacyExtra); the AI may only suggest one, which
// goes in when the developer presses the button under it (content.ts). The
// sentences themselves stay these. They are written in English and go
// through the same translation as the rest of the site.
//
// A sentence says only what an answer said. The policy describes what the
// app does with each kind of data and makes no promise beyond the answers:
// no "only for", no "never", no "not to find out who you are". How soon data
// is deleted is a question of its own, and without an answer the policy names
// no time. Who gets data comes from the services the developer names, which
// the view says the policy lists as the only ones.
//
// It is a starting point, not legal advice, and the view says so.

import type { DataUse, PrivacyAnswers, SiteFacts } from './types';

export type PolicyBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'link'; text: string; href: string };

export interface PolicySection {
  id: string;
  heading: string;
  blocks: PolicyBlock[];
}

/** One question, as the view asks it. */
export interface PrivacyQuestion {
  use: DataUse;
  label: string;
  /** When to tick it, in a few words. */
  hint: string;
  /**
   * Examples for the services box. Every use has one: the policy names the
   * services as the only companies that get data, so each kind of data has
   * to be able to name its own (a maps service, a push service).
   */
  services: string;
}

/** The questions, in the order the view shows them. */
export const PRIVACY_QUESTIONS: PrivacyQuestion[] = [
  { use: 'account', label: 'Accounts', hint: 'People sign in or make an account', services: 'Sign in with Apple, Firebase Authentication' },
  { use: 'analytics', label: 'Usage numbers', hint: 'The app counts how people use it', services: 'Firebase Analytics, TelemetryDeck' },
  { use: 'crashes', label: 'Crash reports', hint: 'The app sends a report when it crashes', services: 'Firebase Crashlytics, Sentry' },
  { use: 'ads', label: 'Ads', hint: 'The app shows ads', services: 'Google AdMob, Unity Ads' },
  { use: 'purchases', label: 'Purchases', hint: 'People buy things or subscribe through the App Store or Google Play', services: 'RevenueCat' },
  { use: 'location', label: 'Location', hint: "The app uses where people are", services: 'Google Maps, Mapbox' },
  { use: 'media', label: 'Photos, camera or microphone', hint: 'The app uses photos, the camera or the microphone', services: 'Cloudinary, Firebase Storage' },
  { use: 'contacts', label: 'Contacts', hint: "The app reads people's contacts", services: 'Firebase, Supabase' },
  { use: 'health', label: 'Health and fitness', hint: 'The app reads or saves health or fitness data', services: 'Firebase, Supabase' },
  { use: 'content', label: 'Things people make', hint: 'People write, post or upload things in the app', services: 'Firebase, Supabase' },
  { use: 'sync', label: 'Sync and backup', hint: "The app saves people's data online", services: 'iCloud, Firebase, Supabase' },
  { use: 'notifications', label: 'Notifications', hint: 'The app sends push notifications', services: 'Firebase Cloud Messaging, OneSignal' },
];

const ALL_USES = new Set<DataUse>(PRIVACY_QUESTIONS.map((question) => question.use));

export function isDataUse(value: unknown): value is DataUse {
  return typeof value === 'string' && ALL_USES.has(value as DataUse);
}

export function todayString(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function defaultPrivacy(now = new Date()): PrivacyAnswers {
  return { answered: false, uses: [], services: {}, personalizedAds: false, children: false, deleteWithinMonth: false, updated: todayString(now) };
}

/** The answers with anything impossible taken out, in the order the questions come. */
export function cleanPrivacy(answers: PrivacyAnswers): PrivacyAnswers {
  const uses = PRIVACY_QUESTIONS.map((question) => question.use).filter((use) => answers.uses.includes(use));
  const services: PrivacyAnswers['services'] = {};
  for (const use of uses) {
    const named = answers.services[use]?.trim();
    if (named) services[use] = named.slice(0, 200);
  }
  return {
    ...answers,
    uses,
    services,
    // An app for children may not show ads chosen from what a child does.
    personalizedAds: uses.includes('ads') && !answers.children && answers.personalizedAds,
    deleteWithinMonth: uses.length > 0 && answers.deleteWithinMonth === true,
  };
}

/** Each service named once, split at commas: "Firebase, Sentry" is two. */
export function serviceNames(answers: PrivacyAnswers): string[] {
  const seen = new Map<string, string>();
  for (const use of answers.uses) {
    for (const part of (answers.services[use] ?? '').split(/[,;\n]/)) {
      const name = part.trim();
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
  }
  return [...seen.values()];
}

const SUMMARY: Record<DataUse, (answers: PrivacyAnswers) => string> = {
  account: () => 'Your account details, so you can sign in',
  analytics: () => 'How the app is used, so we can make it better',
  crashes: () => 'Crash reports, so we can fix problems',
  ads: (answers) => (answers.personalizedAds ? 'Information for ads that match your interests' : 'Information the ad service needs to show ads'),
  purchases: () => 'A record of what you buy, so the app can unlock it',
  location: () => 'Your location, for the features that use it',
  media: () => 'The photos, camera or microphone you allow',
  contacts: () => 'The contacts you allow',
  health: () => 'The health and fitness data you allow',
  content: () => 'What you write, post or upload',
  sync: () => 'Your data, to back it up and keep it the same on all your devices',
  notifications: () => 'A token that lets the app send you notifications',
};

const HEADINGS: Record<DataUse, string> = {
  account: 'Your account',
  analytics: 'How the app is used',
  crashes: 'Crash reports',
  ads: 'Ads',
  purchases: 'Purchases',
  location: 'Your location',
  media: 'Photos, camera and microphone',
  contacts: 'Your contacts',
  health: 'Health and fitness data',
  content: 'What you make in the app',
  sync: 'Sync and backup',
  notifications: 'Notifications',
};

function useParagraphs(use: DataUse, app: string, answers: PrivacyAnswers): string[] {
  const settings = "You can change this at any time in your device's settings.";
  switch (use) {
    case 'account':
      return [`When you make an account, ${app} keeps your account details, such as your name and email address, so you can sign in and use your account on other devices.`];
    case 'analytics':
      return [`${app} counts how the app is used, such as which screens are opened and for how long, so we can see what to make better.`];
    case 'crashes':
      return [`If ${app} crashes or something goes wrong, it sends a report with what happened and details about your device, such as its model and system version, so we can find and fix the problem.`];
    case 'ads':
      return answers.personalizedAds
        ? [`${app} shows ads. The ad service may use your device's advertising identifier and how you use apps to show ads that match your interests. You can turn this off in your device's settings.`]
        : [`${app} shows ads. They aren't chosen from what you do in other apps, but the ad service still collects some information about your device to show the ads and count them.`];
    case 'purchases':
      return ['Purchases and subscriptions go through the App Store or Google Play. We never see your payment details. We get a record of what you bought, so the app can unlock it on your devices.'];
    case 'location':
      return [`${app} uses your location for the features that need it, once you allow it. ${settings}`];
    case 'media':
      return [`${app} asks before it uses your photos, your camera or your microphone, for the features that need them. ${settings}`];
    case 'contacts':
      return [`${app} asks before it reads your contacts, for the features that need them. ${settings}`];
    case 'health':
      return [`${app} asks before it reads or saves health and fitness data, for the features that need it. ${settings}`];
    case 'content':
      return [`What you write, post or upload in ${app} is kept so the app can show it to you, and to other people when you choose to share it.`];
    case 'sync':
      return [`${app} saves your data online, so it's backed up and the same on all your devices.`];
    case 'notifications':
      return [`If you allow notifications, ${app} keeps a token from Apple or Google that lets it send them to your device. You can turn notifications off at any time in your device's settings.`];
  }
}

function serviceLine(use: DataUse, services: string): string {
  if (use === 'ads') return `The ads come from ${services}, which handles your data under its own privacy policy.`;
  if (use === 'sync') return `Your data is stored with ${services}.`;
  if (use === 'account') return `Sign in is handled by ${services}.`;
  return `We use ${services} for this.`;
}

/** Paragraphs from text the developer typed: blank lines split them. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export const GITHUB_PRIVACY_URL = 'https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement';

/** The policy, section by section, in English. */
export function buildPolicy(input: { facts: SiteFacts; privacy: PrivacyAnswers; extra?: string }): PolicySection[] {
  const answers = cleanPrivacy(input.privacy);
  const app = input.facts.appName.trim() || 'This app';
  const developer = input.facts.developer.trim();
  const email = input.facts.supportEmail.trim();
  const writeTo = email ? `write to ${email}` : 'write to us';
  const collects = answers.uses.length > 0;
  const sections: PolicySection[] = [];

  sections.push({
    id: 'about',
    heading: 'About this policy',
    blocks: [
      {
        kind: 'p',
        text: developer
          ? `${app} is made by ${developer}. This policy explains what ${app} collects, why, and the choices you have.`
          : `This policy explains what ${app} collects, why, and the choices you have.`,
      },
    ],
  });

  sections.push({
    id: 'summary',
    heading: 'The short version',
    blocks: collects
      ? [
          { kind: 'p', text: `This is what ${app} collects:` },
          { kind: 'ul', items: answers.uses.map((use) => SUMMARY[use](answers)) },
          // Ads picked from what people do can count as selling data under
          // laws such as the CCPA, so the policy promises it only without them.
          ...(answers.personalizedAds ? [] : [{ kind: 'p' as const, text: "We don't sell your personal data." }]),
        ]
      : [{ kind: 'p', text: `${app} doesn't collect any personal data. What you do in the app stays on your device.` }],
  });

  for (const use of answers.uses) {
    const blocks: PolicyBlock[] = useParagraphs(use, app, answers).map((text) => ({ kind: 'p', text }));
    const services = answers.services[use]?.trim();
    if (services) blocks.push({ kind: 'p', text: serviceLine(use, services) });
    sections.push({ id: use, heading: HEADINGS[use], blocks });
  }

  const extra = paragraphs(input.extra ?? '');
  if (extra.length > 0) {
    sections.push({ id: 'more', heading: 'More details', blocks: extra.map((text) => ({ kind: 'p', text })) });
  }

  if (collects) {
    const names = serviceNames(answers);
    sections.push({
      id: 'sharing',
      heading: 'Who else sees your data',
      blocks:
        names.length > 0
          ? [
              { kind: 'p', text: `We use these services to run ${app}. Each one handles your data under its own privacy policy:` },
              { kind: 'ul', items: names },
              { kind: 'p', text: "Apart from these, we don't share your data with other companies, unless the law requires it." },
            ]
          : [{ kind: 'p', text: "We don't share your data with other companies, unless the law requires it." }],
    });
    sections.push({
      id: 'keeping',
      heading: 'How long we keep your data',
      blocks: [
        {
          kind: 'p',
          text: `We keep your data for as long as we need it for the reasons above. ${
            answers.uses.includes('account') ? 'When you delete your account, or ask us to delete your data, we delete it' : 'When you ask us to delete your data, we delete it'
          }${answers.deleteWithinMonth ? ' within one month' : ''}.`,
        },
      ],
    });
  }

  sections.push({
    id: 'choices',
    heading: 'Your choices',
    blocks: collects
      ? [
          { kind: 'p', text: `You can ask us for a copy of your data, ask us to correct it or ask us to delete it, at any time. To do that, ${writeTo}.` },
          { kind: 'p', text: 'Depending on where you live, laws such as the GDPR in Europe and the CCPA in California give you these rights.' },
        ]
      : [{ kind: 'p', text: `${app} collects no personal data, so there's nothing for us to share, correct or delete. If you have a question, ${writeTo}.` }],
  });

  sections.push({
    id: 'children',
    heading: 'Children',
    blocks: [
      {
        kind: 'p',
        text: answers.children
          ? `${app} is made for children, and it shows no ads chosen from a child's interests. If you're a parent and want us to delete your child's data, ${writeTo}.`
          : `${app} isn't made for children under 13, and we don't knowingly collect data from them. If you think a child has given us personal data, ${writeTo}.`,
      },
    ],
  });

  sections.push({
    id: 'website',
    heading: 'This website',
    blocks: [
      { kind: 'p', text: 'This website uses no cookies and no tracking. It is hosted by GitHub Pages, which may keep your IP address in its logs for security.' },
      { kind: 'link', text: "GitHub's privacy statement", href: GITHUB_PRIVACY_URL },
    ],
  });

  sections.push({
    id: 'changes',
    heading: 'Changes to this policy',
    blocks: [{ kind: 'p', text: "If we change this policy, we'll update this page and the date at the top." }],
  });

  const who = [developer, input.facts.location.trim()].filter(Boolean).join(', ');
  sections.push({
    id: 'contact',
    heading: 'Contact',
    blocks: [
      { kind: 'p', text: email ? `Questions about privacy? Write to ${email}.` : 'Questions about privacy? Write to us.' },
      ...(who ? [{ kind: 'p' as const, text: who }] : []),
    ],
  });

  return sections;
}

/** Every sentence of the policy, for translation. */
export function policyStrings(sections: PolicySection[]): string[] {
  const out: string[] = [];
  for (const section of sections) {
    out.push(section.heading);
    for (const block of section.blocks) {
      if (block.kind === 'p') out.push(block.text);
      else if (block.kind === 'ul') out.push(...block.items);
      else out.push(block.text);
    }
  }
  return out;
}

/** What the developer still has to answer before the policy can go out. */
export function privacyProblems(facts: SiteFacts, answers: PrivacyAnswers): string[] {
  const problems: string[] = [];
  if (!answers.answered) problems.push('Answer the privacy questions');
  if (!facts.supportEmail.trim()) problems.push('Add a support email');
  return problems;
}
