// What the Store compliance view reads, as parse.ts makes it from the
// playbook's files. The JSON's snake_case fields are camelCase here, and every
// field the playbook may leave out is null rather than missing.

/** Which store a rule is about. `web` is a web app or a website, `both` is both stores. */
export type RuleStore = 'apple' | 'google' | 'both' | 'web';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** A store the user ships to. */
export type ShipStore = 'apple' | 'google';

export interface RejectionRule {
  id: string;
  store: RuleStore;
  /** The guideline or policy the store names, as the playbook writes it: "5.1.1(v)", "User Data". */
  guideline: string;
  title: string;
  severity: Severity;
  /** What gives the problem away. */
  detection: string;
  fix: string;
  /** Words in an app's code that point to the problem. */
  signals: string[];
  /** Words in an app's code that show the problem is handled. */
  counterSignals: string[];
  /** When the playbook added the rule, YYYY-MM-DD, if it says. */
  added: string | null;
  /** The framework the rule is about (Flutter, React Native), if only one. */
  framework: string | null;
  /** The command that finds the problem in a project, from detection-recipes.json. */
  recipe: string | null;
  /** The rule in everyday words (plain.ts), when the repository has them for this wording. */
  plain?: PlainRule;
}

export interface PlainRule {
  title: string;
  /** What the reviewer sees and why the app is turned down. */
  problem: string;
  fix: string;
}

export interface PlainDeadline {
  title: string;
  /** Who it applies to and what they have to do. */
  summary: string;
}

export interface Deadline {
  id: string;
  /** Where the law or policy applies: "European Union (EU)", "Google Play (Global)". */
  jurisdiction: string;
  law: string;
  requirement: string;
  /** YYYY-MM-DD, each one when the playbook gives it. */
  effective: string | null;
  grace: string | null;
  mandatory: string | null;
  enforcement: string | null;
  priority: Severity;
  sourceUrl: string | null;
  verifiedOn: string | null;
  sourceNote: string | null;
  /** The deadline in everyday words (plain.ts), when the repository has them for this wording. */
  plain?: PlainDeadline;
}

export interface ChecklistItem {
  /** Stable while the item's words stay the same (hash of section and text). */
  id: string;
  /** Markdown, inline only: bold, links, code. */
  text: string;
  /** The box in everyday words (plain.ts), plain text. */
  plain?: string;
  /** Every app has this check, so it can never be marked as not applying (the checklist's own rule). */
  always?: boolean;
}

export interface ChecklistGroup {
  id: string;
  title: string | null;
  /** The group's name in everyday words (plain.ts). */
  plainTitle?: string;
  /** A group about one store only ("Apple." in the platform section). */
  store: ShipStore | null;
  items: ChecklistItem[];
}

export interface ChecklistSection {
  id: string;
  title: string;
  /** Paragraphs between the heading and the first item. */
  intro: string[];
  /** A section about one store only, so a user shipping to the other can hide it. */
  store: ShipStore | null;
  groups: ChecklistGroup[];
  /** The lines between the heading and the first box or heading, spaces folded: what plain words for the section are checked against. */
  introSource?: string;
  /** The section's title and intro in everyday words (plain.ts), the intro null when it needs none. */
  plain?: { title: string; intro: string | null };
}

export interface Checklist {
  title: string;
  intro: string[];
  sections: ChecklistSection[];
  /** The checks the checklist says can never be marked not applicable, in its words. */
  always: string[];
}

/** A short guide for one kind of app (references/guidelines/by-app-type). */
export interface AppType {
  id: string;
  title: string;
  points: string[];
}

export interface GuideLink {
  /** The repository path, such as docs/APPLE.md. */
  path: string;
  title: string;
  description: string | null;
}

export interface GuideGroup {
  title: string;
  guides: GuideLink[];
}

export interface RulesLibrary {
  rules: RejectionRule[];
  /** The "updated" date of rejection-patterns.json. */
  rulesUpdated: string | null;
  /** The playbook's VERSION file. */
  version: string | null;
  deadlines: Deadline[];
  checklist: Checklist | null;
  appTypes: AppType[];
  guides: GuideGroup[];
  /** The NOTICE file as written: the author, the copyright and the licence. */
  notice: string | null;
  /** The App Review notes template, Markdown. */
  reviewNotes: string | null;
  /** The commit the files are from. Null for a copy read from the branch without GitHub's API. */
  commit: string | null;
}

/** A file kept on this computer. */
export interface StoredFile {
  path: string;
  /** Its git blob hash, which the commit's file list states and the download is checked against. */
  sha: string;
  size: number;
  text: string;
  fetchedAt: number;
}

/** What went wrong at the last check, kept until a check goes through. */
export interface SyncProblem {
  kind: 'offline' | 'limited' | 'broken' | 'failed';
  /** For the user. */
  message: string;
  at: number;
  /** The commit that could not be taken, so the next check does not try it again. */
  commit?: string;
}

/** Which commit the files on this computer are from, and when GitHub was last asked. */
export interface SyncHead {
  commit: string | null;
  /** For the If-None-Match of the next check. */
  etag: string | null;
  /** The last time GitHub answered a check. */
  checkedAt: number | null;
  /** The last time the files changed. */
  changedAt: number | null;
  /** GitHub asked to wait until then (its rate limit's reset time). */
  waitUntil: number | null;
  problem: SyncProblem | null;
}

/** The files a commit has, with their hashes, for the guides read later. */
export interface SyncCatalog {
  commit: string | null;
  files: Record<string, { sha: string; size: number }>;
}

/** What an update brought, for the "New since your last visit" note. */
export interface SyncNews {
  at: number;
  rules: string[];
  deadlines: string[];
  /** Set when the user closed the note. */
  seen: boolean;
}
