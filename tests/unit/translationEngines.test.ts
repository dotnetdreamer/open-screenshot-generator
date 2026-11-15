// Translation through the user's own AI first: Claude Code, then Codex, then
// the AI panel, and our server only when none of those is set up. Run against
// a stand-in for the desktop app (helpers/translationDesktop.ts), which must
// load before anything reads the server address.

import {
  aiCalls,
  answers,
  askedFor,
  callsTo,
  cliReady,
  reply,
  resetDesktop,
  serverCalls,
  targetOf,
  useAiPanel,
  wait,
} from './helpers/translationDesktop';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArtboardState, TextElementProps } from '@/types/artboard';
import {
  AGENT_PROMPTS_AT_ONCE,
  beginAgentLook,
  detectAgentWriters,
  noteClaudeDetection,
  runAgentPrompt,
} from '@/lib/ai/agentPrompt';
import { readTranslations } from '@/lib/ai/translateStrings';
import { availableEngines, resolveEngines } from '@/lib/i18n/engines';
import {
  inPlaceTexts,
  translateIntoLocale,
  translateIntoLocales,
  translateTextsWith,
  writeInPlace,
} from '@/lib/i18n/translate';

const LANGUAGES = ['de-DE', 'fr-FR', 'ja', 'es-ES', 'it'];

/** Two artboards, four text elements, three distinct strings ("Get started" is on both). */
function project(locales: string[] = LANGUAGES): ArtboardState[] {
  const localization = { baseLocale: 'en-US', locales: locales.map((code) => ({ code })) };
  const text = (id: string, content: string) => ({
    id,
    type: 'text',
    content,
    x: 0,
    y: 0,
    width: 400,
    height: 120,
    fontSize: 30,
    color: '#000000',
    fontFamily: 'Inter',
  });
  return [
    {
      id: 'board-1',
      name: 'One',
      elements: [text('t1', 'Track every habit'), text('t2', 'Get started')],
      localization,
    },
    {
      id: 'board-2',
      name: 'Two',
      elements: [text('t3', 'Never break a streak'), text('t4', 'Get started')],
      localization,
    },
  ] as unknown as ArtboardState[];
}

async function setUp(claude: boolean, codex: boolean): Promise<void> {
  resetDesktop();
  cliReady(claude, codex);
  await detectAgentWriters({ refresh: true });
}

/** Answers every prompt to `cmd` after `ms`, and records how many were in flight at most. */
function answerSlowly(cmd: string, ms: number, answer: (args: Record<string, any>) => string = reply) {
  const seen = { inFlight: 0, most: 0, calls: 0 };
  answers[cmd] = async (args) => {
    seen.calls++;
    seen.inFlight++;
    seen.most = Math.max(seen.most, seen.inFlight);
    await wait(ms);
    seen.inFlight--;
    return answer(args);
  };
  return seen;
}

test('the user\'s own CLIs come first, and our server only serves a user with no AI at all', async () => {
  await setUp(true, true);
  assert.deepEqual(await resolveEngines(), ['claude', 'codex']);
  await setUp(false, true);
  assert.deepEqual(await resolveEngines(), ['codex']);
  await setUp(false, false);
  assert.deepEqual(await resolveEngines(), ['libre']);
});

test('a user whose own AI fails is told why, and our server is never asked instead', async () => {
  await setUp(true, false);
  answers.abs_claude_prompt = async () => {
    throw new Error("Claude Code could not answer: You've hit your usage limit");
  };
  await assert.rejects(translateIntoLocale(project(['de-DE']), 'de-DE', { only: 'empty' }), /usage limit/);
  assert.equal(serverCalls.length, 0);
});

test('Claude Code translates five languages three at a time, and the base text never changes', async () => {
  await setUp(true, false);
  const seen = answerSlowly('abs_claude_prompt', 30);
  const boards = project();
  const result = await translateIntoLocales(boards, LANGUAGES, { only: 'empty' });

  assert.equal(seen.calls, 5, 'one prompt per language: every string of a language fits one chunk');
  assert.equal(seen.most, AGENT_PROMPTS_AT_ONCE, 'languages run side by side, never more than Rust takes');
  assert.equal(serverCalls.length, 0, 'our server is never asked');
  assert.equal(result.engine, 'claude');
  for (const entry of result.locales) {
    assert.deepEqual(
      { locale: entry.locale, translated: entry.translated, failed: entry.failed, engine: entry.engine },
      { locale: entry.locale, translated: 4, failed: 0, engine: 'claude' }
    );
  }
  // Each prompt carries the distinct strings once.
  for (const call of callsTo('abs_claude_prompt')) {
    assert.deepEqual(
      askedFor(call.args.prompt).map((item) => item.text),
      ['Track every habit', 'Get started', 'Never break a streak']
    );
  }
  const [one, two] = result.artboards;
  assert.equal(one.elements[0].type === 'text' && one.elements[0].content, 'Track every habit');
  assert.equal(two.localized?.['ja']?.t4?.content, '[ja] Get started');
  assert.equal(one.localized?.['de-DE']?.t1?.origin, 'auto');
  assert.ok(one.localized?.['de-DE']?.t1?.sourceHash, 'a staleness hash comes with every string');
  assert.equal(boards[0].localized, undefined, 'the input document is not changed in place');
});

test('when Claude Code fails, Codex translates what it left, at low effort', async () => {
  await setUp(true, true);
  answers.abs_claude_prompt = async () => {
    throw new Error("Claude Code could not answer: You've hit your usage limit");
  };
  const codex = answerSlowly('abs_codex_prompt', 5);
  const result = await translateIntoLocales(project(), LANGUAGES, { only: 'empty' });

  assert.equal(result.engine, 'codex');
  assert.equal(codex.calls, 5);
  for (const entry of result.locales) {
    assert.equal(entry.translated, 4);
    assert.equal(entry.error, undefined, 'a language the next engine finished carries no error');
  }
  assert.ok(callsTo('abs_claude_prompt').length <= AGENT_PROMPTS_AT_ONCE, 'a failing engine gets no new chunks');
  assert.ok(callsTo('abs_codex_prompt').every((call) => call.args.effort === 'low'));
  assert.equal(serverCalls.filter((call) => call.path === '/translate').length, 0);
});

test('a string the model skipped is asked for once more, on its own', async () => {
  await setUp(true, false);
  const asked: string[][] = [];
  answers.abs_claude_prompt = async (args) => {
    const ids = askedFor(args.prompt).map((item) => item.id);
    asked.push(ids);
    return reply(args, ids.length > 1 ? ['s2'] : []);
  };
  const result = await translateIntoLocale(project(['de-DE']), 'de-DE', { only: 'empty' });

  assert.deepEqual(asked, [['s1', 's2', 's3'], ['s2']]);
  assert.equal(result.translated, 4);
  assert.equal(result.failed, 0);
  assert.equal(result.artboards[1].localized?.['de-DE']?.t4?.content, '[de-DE] Get started');
});

test('our server only translates when no AI of the user\'s own is set up', async () => {
  await setUp(false, false);
  const result = await translateIntoLocale(project(['de-DE']), 'de-DE', { only: 'empty' });
  assert.equal(result.engine, 'libre');
  assert.equal(result.translated, 4);
  assert.equal(result.artboards[0].localized?.['de-DE']?.t1?.content, '{de} Track every habit');
  assert.ok(serverCalls.some((call) => call.path === '/translate'));
  assert.equal(callsTo('abs_claude_prompt').length, 0);
});

test('a language our server lacks is a setup problem, unless an AI can take it', async () => {
  await setUp(false, false);
  await assert.rejects(
    translateIntoLocale(project(['hr']), 'hr', { only: 'empty' }),
    /Machine translation does not cover Hrvatski/
  );

  await setUp(true, false);
  answers.abs_claude_prompt = async (args) => reply(args);
  const result = await translateIntoLocale(project(['hr']), 'hr', { only: 'empty' });
  assert.equal(result.translated, 4);
  assert.equal(result.artboards[0].localized?.['hr']?.t1?.content, '[hr] Track every habit');
});

test('en-US to en-GB is nothing to our server, and real work for a model', async () => {
  await setUp(false, false);
  const skipped = await translateIntoLocale(project(['en-GB']), 'en-GB', { only: 'empty' });
  assert.deepEqual([skipped.translated, skipped.skipped], [0, 4]);
  assert.equal(serverCalls.filter((call) => call.path === '/translate').length, 0);

  await setUp(true, false);
  answers.abs_claude_prompt = async (args) => reply(args);
  const written = await translateIntoLocale(project(['en-GB']), 'en-GB', { only: 'empty' });
  assert.equal(written.translated, 4);
});

test('one language failing everywhere throws its reason; several report it per language', async () => {
  await setUp(true, false);
  answers.abs_claude_prompt = async () => {
    throw new Error('Claude Code took longer than 3 minutes to answer. Try again');
  };
  await assert.rejects(
    translateIntoLocale(project(['de-DE']), 'de-DE', { engines: ['claude'], only: 'empty' }),
    /longer than 3 minutes/
  );
  const several = await translateIntoLocales(project(), ['de-DE', 'fr-FR'], { engines: ['claude'], only: 'empty' });
  assert.deepEqual(
    several.locales.map((entry) => [entry.translated, entry.failed, /3 minutes/.test(entry.error ?? '')]),
    [
      [0, 4, true],
      [0, 4, true],
    ]
  );
  assert.equal(several.artboards[0].localized, undefined);
});

test('a prompt refused because every slot is taken waits and asks again', async () => {
  await setUp(true, false);
  let refused = 0;
  answers.abs_claude_prompt = async (args) => {
    if (refused++ === 0) throw new Error('Claude Code is still answering. Try again when it has finished');
    return reply(args);
  };
  const result = await translateIntoLocale(project(['de-DE']), 'de-DE', { only: 'empty' });
  assert.equal(result.translated, 4);
  assert.equal(callsTo('abs_claude_prompt').length, 2);
});

test('prompts from one window queue for the CLI\'s three slots', async () => {
  await setUp(true, false);
  const seen = answerSlowly('abs_claude_prompt', 20, () => 'ok');
  const answersBack = await Promise.all(
    Array.from({ length: 7 }, () => runAgentPrompt({ agent: 'claude', system: 's', user: 'u' }))
  );
  assert.deepEqual(answersBack, Array(7).fill('ok'));
  assert.equal(seen.most, AGENT_PROMPTS_AT_ONCE);
});

test('cancelling keeps what came back and stops the prompts still running', async () => {
  await setUp(true, false);
  answers.abs_claude_prompt_stop = () => null;
  const controller = new AbortController();
  answers.abs_claude_prompt = async (args) => {
    // German answers at once; every other language is still thinking when
    // the user presses Cancel.
    if (targetOf(args.system) === 'de-DE') return reply(args);
    await wait(200);
    return reply(args);
  };
  const run = translateIntoLocales(project(), LANGUAGES, { only: 'empty', signal: controller.signal });
  await wait(30);
  controller.abort();
  const result = await run;
  const german = result.locales.find((entry) => entry.locale === 'de-DE')!;
  assert.equal(german.translated, 4);
  assert.equal(result.locales.filter((entry) => entry.translated > 0).length, 1);
  assert.ok(callsTo('abs_claude_prompt_stop').length >= 1, 'Cancel kills the CLI of each prompt still running');
  assert.equal(result.artboards[0].localized?.['de-DE']?.t1?.content, '[de-DE] Track every habit');
});

test('loose strings keep their order, repeats are asked for once, blanks stay as they are', async () => {
  await setUp(true, false);
  answers.abs_claude_prompt = async (args) => reply(args);
  const result = await translateTextsWith(
    ['Hello', '', 'World', 'Hello'],
    { model: 'German (Deutsch, de-DE)', machine: 'de' },
    undefined,
    { engines: ['claude'] }
  );
  assert.deepEqual(result.texts, ['[de-DE] Hello', '', '[de-DE] World', '[de-DE] Hello']);
  assert.equal(askedFor(callsTo('abs_claude_prompt')[0].args.prompt).length, 2);
  assert.match(callsTo('abs_claude_prompt')[0].args.system, /Work out which language each string is written in/);
});

test('the word joiner Claude Code puts before an @ never reaches the copy', () => {
  const wanted = new Set(['s1', 's2']);
  assert.deepEqual(readTranslations('{"s1": "Folge ⁠@osg", "s2": "Hallo"}', wanted), {
    s1: 'Folge @osg',
    s2: 'Hallo',
  });
});

test('with no CLI, the AI panel translates three languages at a time, and our server is never asked', async () => {
  await setUp(false, false);
  useAiPanel();
  assert.deepEqual(await resolveEngines(), ['ai']);
  const result = await translateIntoLocales(project(), LANGUAGES, { only: 'empty' });
  assert.equal(result.engine, 'ai');
  assert.deepEqual(
    result.locales.map((entry) => [entry.locale, entry.translated, entry.engine]),
    LANGUAGES.map((locale) => [locale, 4, 'ai'])
  );
  assert.equal(aiCalls.count, 5, 'one request per language');
  assert.equal(aiCalls.most, 3, 'an API key takes three at once');
  assert.equal(result.artboards[1].localized?.['ja']?.t3?.content, '<ja> Never break a streak');
  assert.equal(serverCalls.length, 0);
});

test('a CLI comes before the AI panel, and the AI panel finishes what a failing CLI left', async () => {
  await setUp(true, false);
  useAiPanel();
  assert.deepEqual(await resolveEngines(), ['claude', 'ai']);
  answers.abs_claude_prompt = async () => {
    throw new Error('Claude Code is not signed in. Run claude in a terminal to sign in, then try again');
  };
  const result = await translateIntoLocale(project(['de-DE']), 'de-DE', { only: 'empty' });
  assert.deepEqual([result.translated, result.failed, result.engine, result.error], [4, 0, 'ai', undefined]);
  assert.equal(serverCalls.length, 0);
});

test('a sign-in the Agent panel saw counts for translation at once, and an older look never undoes it', async () => {
  await setUp(false, false);
  assert.deepEqual(await resolveEngines(), ['libre']);
  const older = beginAgentLook();
  const newer = beginAgentLook();
  noteClaudeDetection({ found: true, loggedIn: true, subscriptionType: 'max' }, newer);
  assert.deepEqual(availableEngines(), ['claude']);
  // The look that began first, answering last, says nothing current.
  noteClaudeDetection({ found: true, loggedIn: false }, older);
  assert.deepEqual(availableEngines(), ['claude']);
});

test('of two looks begun in the same millisecond, the one begun second wins, whichever answers last', async () => {
  await setUp(false, false);
  let answerFirst = () => {};
  const firstHeld = new Promise<void>((resolve) => {
    answerFirst = resolve;
  });
  let asked = 0;
  answers.abs_claude_detect = async () => {
    asked += 1;
    if (asked === 1) {
      await firstHeld;
      return { found: true, loggedIn: false };
    }
    return { found: true, loggedIn: true, subscriptionType: 'max' };
  };
  const realNow = Date.now;
  const frozen = realNow();
  Date.now = () => frozen;
  let first: Promise<unknown>;
  let second: Promise<unknown>;
  try {
    first = detectAgentWriters({ refresh: true });
    second = detectAgentWriters({ refresh: true });
  } finally {
    Date.now = realNow;
  }
  await second;
  assert.deepEqual(availableEngines(), ['claude']);
  answerFirst();
  await first;
  assert.deepEqual(availableEngines(), ['claude'], 'the signed-out answer from the first look changes nothing');
});

test('a prompt aborted before it was sent is never sent', async () => {
  await setUp(true, false);
  answers.abs_claude_prompt = async (args) => reply(args);
  answers.abs_claude_prompt_stop = () => null;
  const controller = new AbortController();
  const asked = runAgentPrompt({ agent: 'claude', system: 's', user: 'u', signal: controller.signal });
  controller.abort();
  await assert.rejects(asked, { name: 'AbortError' });
  assert.equal(callsTo('abs_claude_prompt').length, 0);

  // The same while it waits for one of the three slots.
  answers.abs_claude_prompt = async () => {
    await wait(50);
    return 'ok';
  };
  const busy = Array.from({ length: AGENT_PROMPTS_AT_ONCE }, () => runAgentPrompt({ agent: 'claude', system: 's', user: 'u' }));
  const waiting = new AbortController();
  const queued = runAgentPrompt({ agent: 'claude', system: 's', user: 'u', signal: waiting.signal });
  waiting.abort();
  await assert.rejects(queued, { name: 'AbortError' });
  assert.deepEqual(await Promise.all(busy), Array(AGENT_PROMPTS_AT_ONCE).fill('ok'));
  assert.equal(callsTo('abs_claude_prompt').length, AGENT_PROMPTS_AT_ONCE);
});

// Opening a project re-mints an id that repeats across artboards
// (ensureUniqueElementIds). These two are the guard behind that.
test('the Translate dialog writes each artboard\'s own text back, even where element ids repeat', () => {
  const text = (id: string, content: string) =>
    ({ id, type: 'text', content, x: 0, y: 0, width: 400, height: 120, fontSize: 30, color: '#000', fontFamily: 'Inter' }) as unknown as TextElementProps;
  const boards = [
    { id: 'board-1', name: 'One', elements: [text('t1', 'Track every habit')] },
    { id: 'board-2', name: 'Two', elements: [text('t1', 'Never break a streak'), text('t2', 'Get started')] },
  ] as unknown as ArtboardState[];
  const scope = new Set(['board-1', 'board-2']);
  const texts = inPlaceTexts(boards, scope);
  assert.deepEqual(
    texts.map((entry) => `${entry.artboardId}/${entry.elementId}`),
    ['board-1/t1', 'board-2/t1', 'board-2/t2']
  );

  const done = writeInPlace(boards, texts, ['Jede Gewohnheit', 'Keine Serie reißt', null], {
    artboardIds: scope,
    language: 'de',
    fontFamily: 'Roboto',
  });
  const contents = done.artboards.map((board) => board.elements.map((el) => (el as TextElementProps).content));
  assert.deepEqual(contents, [['Jede Gewohnheit'], ['Keine Serie reißt', 'Get started']]);
  assert.equal(done.written, 2);
  assert.deepEqual(done.artboards.map((board) => board.language), ['de', undefined], 'a board with text left over names no language');
  assert.equal((done.artboards[0].elements[0] as TextElementProps).fontFamily, 'Roboto');

  // Text edited while the AI was writing keeps the edit.
  const edited = boards.map((board) =>
    board.id === 'board-1' ? { ...board, elements: [text('t1', 'Track every habit, daily')] } : board
  );
  const kept = writeInPlace(edited, texts, ['Jede Gewohnheit', 'Keine Serie reißt', 'Los geht es'], {
    artboardIds: scope,
    language: 'de',
  });
  assert.equal((kept.artboards[0].elements[0] as TextElementProps).content, 'Track every habit, daily');
  assert.equal(kept.written, 2);
});

test('a run looks for Claude Code again once the look that found nothing is a minute old', async () => {
  await setUp(false, false);
  assert.deepEqual(await resolveEngines(), ['libre']);
  // Signed in from a terminal: no part of the app has looked since.
  cliReady(true, false);
  assert.deepEqual(await resolveEngines(), ['libre'], 'a look less than a minute old is trusted');
  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  try {
    assert.deepEqual(await resolveEngines(), ['claude']);
  } finally {
    Date.now = realNow;
  }
});

test('a run aimed at one element on one artboard leaves the same id on another artboard alone', async () => {
  await setUp(true, false);
  answers.abs_claude_prompt = async (args) => reply(args);
  const localization = { baseLocale: 'en-US', locales: [{ code: 'de-DE' }] };
  const text = (id: string, content: string) =>
    ({ id, type: 'text', content, x: 0, y: 0, width: 400, height: 120, fontSize: 30, color: '#000', fontFamily: 'Inter' }) as unknown as TextElementProps;
  const boards = [
    { id: 'board-1', name: 'One', elements: [text('t1', 'Track every habit')], localization },
    {
      id: 'board-2',
      name: 'Two',
      elements: [text('t1', 'Never break a streak')],
      localization,
      // Typed by a person, which a run that includes manual copy may overwrite.
      localized: { 'de-DE': { t1: { content: 'Keine Serie reißt ab', origin: 'manual' } } },
    },
  ] as unknown as ArtboardState[];
  const scoped = await translateIntoLocale(boards, 'de-DE', {
    only: 'all',
    includeManual: true,
    elementIds: ['t1'],
    artboardIds: ['board-1'],
  });
  assert.equal(scoped.translated, 1);
  assert.equal(scoped.artboards[0].localized?.['de-DE']?.t1?.content, '[de-DE] Track every habit');
  assert.equal(scoped.artboards[1].localized?.['de-DE']?.t1?.content, 'Keine Serie reißt ab');

  // Without the artboard, the id alone reaches both, which is why the
  // Properties panel's button names its artboard.
  const unscoped = await translateIntoLocale(boards, 'de-DE', { only: 'all', includeManual: true, elementIds: ['t1'] });
  assert.equal(unscoped.translated, 2);
});
