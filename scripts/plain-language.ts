// Writes data/plain-language.json in a copy of the App Store Compliance
// Playbook: every rule, deadline and checklist box in everyday words. Store
// compliance shows those words in place of the playbook's own, which are
// written for developers and lawyers (src/lib/storeCompliance/plain.ts).
//
//   npx tsx scripts/plain-language.ts ~/code/app-store-compliance
//
// Run it from this repository, in a clone of the playbook, after pulling the
// playbook's changes; then commit the file there. Every app picks it up the
// next time Store compliance checks GitHub. Only what is new, or reworded
// since its plain words were written, goes to the AI, so a run after a small
// change takes a minute. It uses Claude Code on your own plan, the same way
// the app's one-shot prompts do (no tools, no MCP servers, nothing saved);
// CLAUDE_BIN points at another copy of it.
//
// Shorter words must not mean less. Every plain version is checked against
// its original before it is kept (plain-language-checks.ts): in code, every
// date and every amount with a unit has to be in it with the same unit, and a
// second AI pass lists any condition, exception, limit or group of people it
// lost or changed. That pass has to answer each entry with a list of
// sentences; an answer that is not one is asked for again, and is never taken
// as approval. A version with a problem is written again with the problems
// named, up to three rounds; one that still fails is left out, so the app
// shows the playbook's own words for it. The fingerprint in the file only
// says the playbook has not changed since; this check is what says the plain
// words still mean the same.
//
// Options:
//   --only rules|deadlines|checklist   one kind only
//   --limit <n>                        at most n entries of each kind, to try the prompt
//   --recheck                          check the meaning of every entry in the file again,
//                                      not only new ones, and rewrite those that fail
//   --dry-run                          say what would be written, write nothing
//   --verbose                          print every problem the meaning check finds
//   --model <name>                     a model other than Claude Code's default

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checklistItems, DEADLINES_FILE, parseChecklist, parseDeadlines, parseRules, RULES_FILE } from '../src/lib/storeCompliance/parse';
import { checklistKey, deadlineFingerprint, PLAIN_FILE, PLAIN_TEXT_MAX, PLAIN_TITLE_MAX, ruleFingerprint } from '../src/lib/storeCompliance/plain';
import { lostFacts, readVerdict } from './plain-language-checks';

type Kind = 'rules' | 'deadlines' | 'checklist';
type Entry = Record<string, string>;
interface Job {
  kind: Kind;
  id: string;
  /** The fingerprint the entry is written from; empty for a checklist box, whose key is its fingerprint. */
  from: string;
  original: Record<string, string>;
}

const FIELDS: Record<Kind, string[]> = { rules: ['title', 'problem', 'fix'], deadlines: ['title', 'summary'], checklist: ['text'] };
const BATCH: Record<Kind, number> = { rules: 10, deadlines: 10, checklist: 20 };
const AT_ONCE = 4;
const ROUNDS = 3;

// --- arguments -------------------------------------------------------------------

const args = process.argv.slice(2);
const option = (name: string): string | null => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
};
const playbook = args.find((arg, index) => !arg.startsWith('--') && !['--only', '--limit', '--model'].includes(args[index - 1] ?? ''));
if (!playbook || !existsSync(join(playbook, RULES_FILE))) {
  console.error('Usage: npx tsx scripts/plain-language.ts <a clone of the playbook> [--only rules|deadlines|checklist] [--limit n] [--recheck] [--dry-run] [--model name]');
  process.exit(2);
}
const root = resolve(playbook);
const only = option('--only') as Kind | null;
const limit = Number(option('--limit') ?? Infinity);
const recheck = args.includes('--recheck');
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');
const model = option('--model');

// --- what needs plain words ------------------------------------------------------

const read = (path: string) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null);
const { rules } = parseRules(read(RULES_FILE)!);
const deadlines = parseDeadlines(read(DEADLINES_FILE)!);
const checklistSource = read('docs/PRE-SUBMISSION-CHECKLIST.md');
const boxes = checklistSource ? checklistItems(parseChecklist(checklistSource)) : [];

const existing = (() => {
  const source = read(PLAIN_FILE);
  if (!source) return { rules: {}, deadlines: {}, checklist: {} } as Record<Kind, Record<string, Entry>>;
  const data = JSON.parse(source);
  return { rules: data.rules ?? {}, deadlines: data.deadlines ?? {}, checklist: data.checklist ?? {} } as Record<Kind, Record<string, Entry>>;
})();

const STORE_NAMES: Record<string, string> = { apple: 'App Store', google: 'Google Play', both: 'Both stores', web: 'Websites and web apps' };

const all: Record<Kind, Job[]> = {
  rules: rules.map((rule) => ({
    kind: 'rules',
    id: rule.id,
    from: ruleFingerprint(rule),
    original: { store: STORE_NAMES[rule.store], guideline: rule.guideline, title: rule.title, detection: rule.detection, fix: rule.fix },
  })),
  deadlines: deadlines.map((deadline) => ({
    kind: 'deadlines',
    id: deadline.id,
    from: deadlineFingerprint(deadline),
    original: {
      where: deadline.jurisdiction,
      law: deadline.law,
      requirement: deadline.requirement,
      ...(deadline.grace ? { grace: deadline.grace } : {}),
    },
  })),
  checklist: [...new Map(boxes.map((box) => [checklistKey(box.id), box])).values()].map((box) => ({
    kind: 'checklist',
    id: checklistKey(box.id),
    from: '',
    original: { section: box.section.title, ...(box.group.title ? { group: box.group.title } : {}), text: box.text },
  })),
};

const fresh = (job: Job) => {
  const entry = existing[job.kind][job.id];
  return !!entry && (job.kind === 'checklist' || entry.from === job.from) && FIELDS[job.kind].every((field) => typeof entry[field] === 'string' && entry[field]);
};

const kinds: Kind[] = only ? [only] : ['rules', 'deadlines', 'checklist'];
/** What this run works on: new and reworded entries, and with --recheck the fresh ones too, whose meaning is checked before they are kept. */
const todo = kinds.flatMap((kind) => all[kind].filter((job) => recheck || !fresh(job)).slice(0, limit));
for (const kind of kinds) {
  const waiting = all[kind].filter((job) => !fresh(job)).length;
  const checking = recheck ? Math.min(all[kind].length - waiting, limit) : 0;
  console.log(`${kind}: ${all[kind].length} in the playbook, ${all[kind].length - waiting} already in plain words, ${Math.min(waiting, limit)} to write${checking ? `, ${checking} to check again` : ''}`);
}

// --- the prompts -----------------------------------------------------------------

const WRITE_SYSTEM = `You rewrite parts of the App Store Compliance Playbook in plain English for people who make and publish apps but aren't developers or lawyers: a founder, a designer, a marketer. They read your words in an app that helps them get through App Store and Google Play review, and they act on your words alone.

How to write:
- Everyday words and short sentences. Talk to the reader as "you" and "your app".
- Say what it means for their app and what to do about it.
- Shorter words must not mean less. Keep every requirement, condition, exception and limit: words like when, only, unless, if, at the same time, at least, before, after, every, all. Keep every date, deadline, number and amount, and exactly who and where it applies to. If the original hedges ("proposed", "expected"), keep the hedge.
- Don't add facts, advice, dates or examples the original doesn't have.
- Leave out legal citations, article numbers and regulation numbers: the app shows the law's name separately. Keep a store guideline number when the original's point depends on it.
- A technical name the reader has to pass on to a developer stays, in brackets after the plain words: "Apple's privacy file (PrivacyInfo.xcprivacy)". Explain any other jargon in a few words, or leave it out.
- Sound like a person explaining it across a desk. Contractions are fine.
- Never use em dashes, en dashes, curly quotes, Markdown, emoji or exclamation marks, and never the words ensure, crucial, robust, leverage, seamless, navigate, landscape, delve, utilize, comprehensive or "in order to".
- Write dates as day, month, year: 12 September 2027.
- Titles are in sentence case and don't end with a period.

Reply with one JSON object and nothing else.`;

const KIND_PROMPT: Record<Kind, string> = {
  rules: `Rewrite these rejection rules. For each id, return:
- "title": what gets the app turned down, at most 8 words.
- "problem": one or two sentences, at most 45 words: what the reviewer finds and why the store says no.
- "fix": one or two sentences, at most 45 words: what to change.

Example. The original:
{"id":"ANDROID-QUERY-ALL-PACKAGES","store":"Google Play","title":"QUERY_ALL_PACKAGES without a permitted use case","detection":"QUERY_ALL_PACKAGES declared in AndroidManifest.","fix":"Declare specific packages with a queries element, or qualify for a permitted use case."}
In plain words:
{"ANDROID-QUERY-ALL-PACKAGES":{"title":"App asks to see every app on the phone","problem":"Your app asks Android for a list of every app installed on the phone (QUERY_ALL_PACKAGES). Google only allows that for a few kinds of apps.","fix":"Have your developer ask only for the apps yours needs to see, or show Google that your app is one of the kinds allowed to ask."}}`,
  deadlines: `Rewrite these deadlines: dates when a new law or store rule starts to apply to apps. For each id, return:
- "title": what changes for apps, at most 8 words. Not the law's name.
- "summary": one to three sentences, at most 60 words: who it applies to and what they have to do, with every date the requirement names. The app shows the place, the law's name and the grace period beside your words, so leave those out.

Example. The original:
{"id":"US-IL-BIPA","where":"Illinois (USA State)","law":"Biometric Information Privacy Act (BIPA), 740 ILCS 14","requirement":"Written notice and release before collecting biometric identifiers, public retention schedule, destruction within 3 years, and no sale."}
In plain words:
{"US-IL-BIPA":{"title":"Ask before collecting face or fingerprint data","summary":"If your app collects face scans, fingerprints or similar data, tell people in writing and get their consent first. Publish how long you keep it, delete it within 3 years, and never sell it."}}`,
  checklist: `Rewrite these checklist boxes: checks to make before sending an app for review. For each id, return:
- "text": one or two sentences, at most 40 words: the check in plain words, said as something that's true once it's done, like the original. Keep a store guideline number or a date in brackets when the original has one.

Example. The original:
{"id":"a1b2c3d4","section":"Shared (both stores)","group":"Mobile Security and Best Practices","text":"**Secure Storage:** Sensitive items (session tokens, passwords, keys) are stored securely (iOS Keychain or Android EncryptedSharedPreferences/Keystore) and never in plaintext files, plain SharedPreferences, or unencrypted local databases."}
In plain words:
{"a1b2c3d4":{"text":"Passwords, login tokens and keys are kept in the phone's secure storage (iOS Keychain, Android Keystore), never in plain files or unprotected databases."}}`,
};

function writePrompt(kind: Kind, jobs: Job[], feedback: Map<string, string[]>): string {
  const lines = jobs.map((job) => JSON.stringify({ id: job.id, ...job.original }));
  const notes = jobs.filter((job) => feedback.has(job.id));
  const fix = notes.length
    ? `\n\nAn earlier version of these lost or changed meaning. Fix each problem and keep everything else:\n${notes.map((job) => `- ${job.id}: ${feedback.get(job.id)!.join('; ')}`).join('\n')}`
    : '';
  const shape = FIELDS[kind].map((field) => `"${field}": "..."`).join(', ');
  return `${KIND_PROMPT[kind]}\n\nThe ${kind === 'checklist' ? 'boxes' : kind}, one JSON object a line:\n${lines.join('\n')}${fix}\n\nReply as {"<id>": {${shape}}} with every id above.`;
}

const CHECK_SYSTEM = `You check plain-English versions of App Store Compliance Playbook entries against the originals. People will act on the plain version alone, so it has to mean the same.

For each id, list every way the plain version changes the meaning:
- a requirement, condition, exception or qualifier that is missing or weaker, such as "when offered", "at the same time", "only if", "unless", "at least", "before", "every"
- a date, deadline, number, limit or amount that is missing or different
- who or where it applies to, missing, wider or narrower
- anything the original does not say
Do not list: legal citations, article and regulation numbers left out on purpose, technical names moved into brackets, a store's own name for something, or wording and tone. The app shows a deadline's place, the law's name and its grace period, and a rule's store and guideline, beside the plain words, so do not list those as missing either.

Reply with one JSON object and nothing else: {"<id>": ["what is lost or changed", ...]}, with an empty list for a version that means the same.`;

function checkPrompt(jobs: Job[], entries: Map<string, Entry>): string {
  const lines = jobs.map((job) => JSON.stringify({ id: job.id, original: job.original, plain: entries.get(job.id) }));
  return `The entries, one JSON object a line:\n${lines.join('\n')}\n\nReply as {"<id>": [...]} with every id above.`;
}

// --- checking an answer ----------------------------------------------------------

const BANNED = /\b(ensure[sd]?|ensuring|crucial|robust|leverag\w*|seamless(?:ly)?|navigat\w*|landscape|delve\w*|utili[sz]\w*|comprehensive|in order to)\b/i;
const MARKS = /[–—‘’“”`*#!]|\]\(/;

function styleProblems(kind: Kind, entry: Entry | undefined): string[] {
  if (!entry || typeof entry !== 'object') return ['missing'];
  const out: string[] = [];
  for (const field of FIELDS[kind]) {
    const value = typeof entry[field] === 'string' ? entry[field].trim() : '';
    if (!value) {
      out.push(`"${field}" is empty`);
      continue;
    }
    if (MARKS.test(value)) out.push(`"${field}" has a dash, a curly quote, Markdown or an exclamation mark`);
    const word = BANNED.exec(value);
    if (word) out.push(`"${field}" uses "${word[0]}"`);
    if (field === 'title') {
      if (value.length > Math.min(PLAIN_TITLE_MAX, 80) || value.split(/\s+/).length > 10) out.push('the title is too long');
      if (/\.$/.test(value)) out.push('the title ends with a period');
    } else if (value.length > Math.min(PLAIN_TEXT_MAX, 420)) {
      out.push(`"${field}" is too long`);
    }
  }
  return out;
}

/** The fields a plain version stands in for. The place, the law's name, the grace period and the guideline show beside it. */
const REPLACED: Record<Kind, string[]> = { rules: ['title', 'detection', 'fix'], deadlines: ['requirement'], checklist: ['text'] };

function originalText(job: Job): string {
  return REPLACED[job.kind].map((field) => job.original[field] ?? '').join(' \n ');
}

// --- asking Claude Code ------------------------------------------------------------

function claudeBinary(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const local = join(homedir(), '.local/bin/claude');
  return existsSync(local) ? local : 'claude';
}

function askClaude(system: string, user: string): Promise<string> {
  const work = mkdtempSync(join(tmpdir(), 'plain-language-'));
  writeFileSync(join(work, 'system.md'), system);
  writeFileSync(join(work, 'settings.json'), '{}');
  const flags = [
    '-p', '--output-format', 'json', '--setting-sources', '', '--settings', join(work, 'settings.json'), '--tools', '',
    '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--permission-mode', 'dontAsk',
    '--system-prompt-file', join(work, 'system.md'),
    ...(model ? ['--model', model] : []),
  ];
  // As the app does: the plan Claude Code is signed in with, not a key or a parent session.
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', NO_COLOR: '1' };
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_EFFORT_LEVEL', 'CLAUDE_CODE_ENTRYPOINT']) delete env[name];
  return new Promise((done, fail) => {
    const child = spawn(claudeBinary(), flags, { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', fail);
    child.on('close', (code) => {
      rmSync(work, { recursive: true, force: true });
      try {
        const reply = JSON.parse(out);
        if (reply.is_error || typeof reply.result !== 'string') throw new Error(reply.result || 'no result');
        done(reply.result);
      } catch (error) {
        fail(new Error(`Claude Code stopped (exit ${code}): ${(error as Error).message} ${err.slice(0, 400)}`));
      }
    });
    child.stdin.end(user);
  });
}

function readReply<T>(text: string): Record<string, T> {
  const body = text.replace(/^```[a-z]*\s*|\s*```$/gi, '').trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('the reply has no JSON object');
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * The AI's reading of each version: the problems it names, an empty list when
 * the meaning holds, or null when, asked three times, it never answered that
 * entry with a list of sentences (readVerdict). Null is never an approval.
 */
async function checkMeaning(jobs: Job[], entries: Map<string, Entry>): Promise<Map<string, string[] | null>> {
  const out = new Map<string, string[] | null>();
  let ask = jobs;
  for (let attempt = 1; attempt <= 3 && ask.length > 0; attempt++) {
    let verdicts: Record<string, unknown> = {};
    try {
      const reply: unknown = readReply<unknown>(await askClaude(CHECK_SYSTEM, checkPrompt(ask, entries)));
      if (reply && typeof reply === 'object' && !Array.isArray(reply)) verdicts = reply as Record<string, unknown>;
    } catch (error) {
      console.error(`  meaning check: ${(error as Error).message}`);
    }
    const again: Job[] = [];
    for (const job of ask) {
      const said = readVerdict(verdicts[job.id]);
      if (said) out.set(job.id, said);
      else again.push(job);
    }
    if (verbose && again.length > 0) console.log(`  meaning check, attempt ${attempt}: no readable answer for ${again.map((job) => job.id).join(', ')}`);
    ask = again;
  }
  for (const job of ask) out.set(job.id, null);
  return out;
}

/** One batch: write what has no version yet, check every version's meaning, write again what fails. */
async function produce(kind: Kind, jobs: Job[]): Promise<{ kept: Map<string, Entry>; left: Map<string, string[]> }> {
  const kept = new Map<string, Entry>();
  // With --recheck, the version in the file is the first one checked.
  const current = new Map<string, Entry>();
  for (const job of jobs) if (fresh(job)) current.set(job.id, existing[kind][job.id]);
  let feedback = new Map<string, string[]>();
  for (let round = 1; round <= ROUNDS; round++) {
    const toWrite = jobs.filter((job) => !kept.has(job.id) && !current.has(job.id));
    if (toWrite.length > 0) {
      try {
        const reply = readReply<Entry>(await askClaude(WRITE_SYSTEM, writePrompt(kind, toWrite, feedback)));
        for (const job of toWrite) {
          const problems = styleProblems(kind, reply[job.id]);
          if (problems.length === 0) current.set(job.id, Object.fromEntries(FIELDS[kind].map((field) => [field, reply[job.id][field].replace(/\s+/g, ' ').trim()])));
          else feedback.set(job.id, problems);
        }
      } catch (error) {
        console.error(`  ${kind}: ${(error as Error).message}`);
      }
    }
    const toCheck = jobs.filter((job) => !kept.has(job.id) && current.has(job.id));
    if (toCheck.length === 0) continue;
    const verdicts = await checkMeaning(toCheck, current);
    feedback = new Map();
    for (const job of toCheck) {
      const said = verdicts.get(job.id) ?? null;
      const problems = [...lostFacts(originalText(job), Object.values(current.get(job.id)!).join(' \n ')), ...(said ?? ['the meaning check gave no readable answer for this entry'])];
      if (verbose && problems.length > 0) console.log(`  ${kind} ${job.id}, round ${round}: ${problems.join('; ')}`);
      if (problems.length === 0) {
        kept.set(job.id, current.get(job.id)!);
      } else {
        feedback.set(job.id, problems);
        current.delete(job.id);
      }
    }
  }
  const left = new Map(jobs.filter((job) => !kept.has(job.id)).map((job) => [job.id, feedback.get(job.id) ?? ['no answer']]));
  return { kept, left };
}

// --- run -----------------------------------------------------------------------------

async function main() {
  const batches: Array<{ kind: Kind; jobs: Job[] }> = [];
  for (const kind of kinds) {
    const jobs = todo.filter((job) => job.kind === kind);
    for (let index = 0; index < jobs.length; index += BATCH[kind]) batches.push({ kind, jobs: jobs.slice(index, index + BATCH[kind]) });
  }
  const results: Record<Kind, Map<string, Entry>> = { rules: new Map(), deadlines: new Map(), checklist: new Map() };
  const worked = new Set(todo.map((job) => `${job.kind}:${job.id}`));
  const left: string[] = [];
  let next = 0;
  let finished = 0;
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, batches.length) }, async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        const outcome = await produce(batch.kind, batch.jobs);
        for (const [id, entry] of outcome.kept) results[batch.kind].set(id, entry);
        for (const [id, problems] of outcome.left) left.push(`  ${batch.kind} ${id}: left in the playbook's words (${problems.join('; ')})`);
        console.log(`  ${++finished} of ${batches.length} batches done`);
      }
    })
  );
  for (const line of left) console.error(line);

  // The file in the playbook's order. An entry this run worked on is kept
  // only if it passed the meaning check; one it did not touch stays as it was.
  const file: Record<string, unknown> = {
    version: 1,
    about:
      'The rules, deadlines and checklist boxes of this playbook in everyday words, for people who are not developers or lawyers. Written with scripts/plain-language.ts of Open Screenshot Generator, and each one checked against its original for meaning. "from" is a fingerprint of the original an entry was written from: when the original changes, apps show the original until this file is written again.',
  };
  let total = 0;
  for (const kind of ['rules', 'deadlines', 'checklist'] as Kind[]) {
    const section: Record<string, Entry> = {};
    for (const job of all[kind]) {
      const entry = results[kind].get(job.id) ?? (!worked.has(`${kind}:${job.id}`) && fresh(job) ? existing[kind][job.id] : null);
      if (!entry) continue;
      section[job.id] = kind === 'checklist' ? { text: entry.text } : { from: job.from, ...Object.fromEntries(FIELDS[kind].map((field) => [field, entry[field]])) };
      total++;
    }
    file[kind] = section;
  }
  const target = join(root, PLAIN_FILE);
  console.log(`${left.length} left in the playbook's words`);
  if (dryRun) {
    console.log(JSON.stringify(file, null, 2));
    return;
  }
  writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`Wrote ${target}: ${total} entries in plain words`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
