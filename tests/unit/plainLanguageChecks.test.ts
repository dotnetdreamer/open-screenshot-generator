// scripts/plain-language-checks.ts: what the plain-words generator checks in
// code before it keeps a version, and how it reads the AI's verdict. The
// cases are the ones an audit found slipping through: "4%", "EUR 100",
// "48 hours" kept as "48 years", and a verdict of [null, {...}].

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountsOf, datesOf, lostFacts, readVerdict } from '../../scripts/plain-language-checks';

test('amounts: a number with its unit, the unit written any of its ways', () => {
  const amounts = (text: string) => amountsOf(text).map((amount) => `${amount.number} ${amount.unit}`);
  assert.deepEqual(amounts('A fine of 4% of turnover'), ['4 percent']);
  assert.deepEqual(amounts('up to EUR 100 a day'), ['100 euro']);
  assert.deepEqual(amounts('within 48 hours'), ['48 hour']);
  assert.deepEqual(amounts('17.5 million pounds or 4 percent'), ['17.5 million', '4 percent']);
  assert.deepEqual(amounts('€100, $4.99 and £5'), ['100 euro', '4.99 dollar', '5 pound']);
  assert.deepEqual(amounts('50,000 users and a 24-hour window'), ['50000 user', '24 hour']);
  assert.deepEqual(amounts('Article 50(2), 16 CFR Part 312, API level 36'), [], 'citations and versions have no unit');
  assert.deepEqual(amounts('children and 16-year-olds'), [], 'an age is not a length of time');
});

test('lost facts: every amount has to stay, with the same unit', () => {
  assert.deepEqual(lostFacts('Remove it within 48 hours.', 'Remove it within 48 years.'), ['the amount 48 hour is missing or has another unit']);
  assert.deepEqual(lostFacts('Remove it within 48 hours.', 'Take it down in 48-hour time.'), []);
  assert.deepEqual(lostFacts('A fine of 4%.', 'A fine of 4 percent.'), []);
  assert.deepEqual(lostFacts('A fine of 4%.', 'A fine of 40%.'), ['the amount 4 percent is missing or has another unit']);
  assert.deepEqual(lostFacts('A fee of EUR 100.', 'A fee of 100 euros.'), []);
  assert.deepEqual(lostFacts('A fee of EUR 100.', 'A fee of €100.'), []);
  assert.deepEqual(lostFacts('A fee of EUR 100.', 'A fee of 100.'), ['the amount 100 euro is missing or has another unit']);
  assert.deepEqual(lostFacts('A fee of EUR 100.', 'A fee of USD 100.'), ['the amount 100 euro is missing or has another unit']);
  assert.deepEqual(lostFacts('More than 50,000 users.', 'More than 50000 users.'), []);
});

test('lost facts: every date has to stay, however it is written', () => {
  assert.deepEqual(datesOf('From 2027-09-12, and by 1 October 2026, or in March 2027.').sort(), ['1 October 2026', '12 September 2027', 'March 2027']);
  assert.deepEqual(lostFacts('Contracts must comply by 12 September 2027.', 'Contracts must comply by 12 September 2027.'), []);
  assert.deepEqual(lostFacts('Applies from 2027-09-12.', 'Applies from 12 September 2027.'), []);
  assert.deepEqual(lostFacts('Due in September 2027.', 'Due on 12 September 2027.'), [], 'a day of the month keeps the month');
  assert.deepEqual(lostFacts('Contracts must comply by 12 September 2027.', 'Older contracts must comply.'), ['the date 12 September 2027 is missing']);
});

test('verdicts: only a list of sentences counts, and anything else is no answer', () => {
  assert.deepEqual(readVerdict([]), [], 'an empty list: the meaning holds');
  assert.deepEqual(readVerdict(['Drops "when offered".']), ['Drops "when offered".']);
  assert.equal(readVerdict([null, { issue: 'The condition was omitted.' }]), null, 'the audit case: not an approval');
  assert.equal(readVerdict(['A problem', 5]), null);
  assert.equal(readVerdict(['']), null);
  assert.equal(readVerdict('ok'), null);
  assert.equal(readVerdict(undefined), null, 'an entry the answer left out');
  assert.equal(readVerdict({}), null);
});
