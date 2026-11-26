// `osg verify` counts screenshots the way each store does: per folder and per
// store slot, not per pixel size. Play takes a portrait and a landscape phone
// shot as one set, keeps at most 8 of them, and wants one feature graphic; an
// Apple display type holds a device's sizes either way up and keeps at most 10.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditSets, type FileReport } from '../../cli/src/commands/verify';
import { rulesetFor, screenshotSlot } from '../../cli/src/verify/rules';

const play = rulesetFor('play');
const apple = rulesetFor('appstore');

function rows(sizes: Array<[number, number]>, folder = 'en-US'): FileReport[] {
  return sizes.map(([width, height], index) => ({
    file: `${folder}/${String(index + 1).padStart(2, '0')}.png`,
    kind: 'png',
    width,
    height,
    duration: null,
    bytes: 1000,
    level: 'ok',
    findings: [],
  }));
}

const failures = (files: FileReport[], ruleset = play) =>
  auditSets(files, ruleset).flatMap((set) => set.findings.filter((finding) => finding.level === 'fail').map((finding) => finding.message));

test('a portrait and a landscape phone shot are one Play set of two', () => {
  assert.deepEqual(failures(rows([[1080, 1920], [1920, 1080]])), []);
  assert.deepEqual(failures(rows([[1080, 2400], [2400, 1080]])), []);
  const [set] = auditSets(rows([[1080, 1920], [1920, 1080]]), play);
  assert.equal(set.label, 'en-US Phone screenshots (1080x1920, 1920x1080)');
  assert.equal(set.files, 2);
});

test('Play wants 2 to 8 phone shots, whichever way up', () => {
  assert.deepEqual(failures(rows([[1080, 1920]])), [
    'en-US Phone screenshots (1080x1920) has 1 image and Google Play needs at least 2 to publish',
  ]);
  const nine: Array<[number, number]> = [...Array(5).fill([1080, 1920]), ...Array(4).fill([1920, 1080])];
  assert.deepEqual(failures(rows(nine)), [
    'en-US Phone screenshots (1080x1920, 1920x1080) has 9 images and Google Play keeps at most 8',
  ]);
  assert.deepEqual(failures(rows(nine.slice(1))), []);
});

test('a feature graphic, a TV shot and a Wear OS shot each stand alone', () => {
  assert.deepEqual(failures(rows([[1080, 1920], [1080, 1920], [1024, 500]])), []);
  assert.deepEqual(failures(rows([[3840, 2160], [454, 454]])), []);
  assert.deepEqual(failures(rows([[1024, 500], [1024, 500]])), [
    'en-US Feature graphic (1024x500) has 2 images and Google Play keeps at most 1',
  ]);
  assert.deepEqual(screenshotSlot(1024, 500, play), { id: 'featureGraphic', label: 'Feature graphic', min: 1, max: 1 });
  assert.deepEqual(screenshotSlot(1920, 1080, play), { id: 'phoneScreenshots', label: 'Phone screenshots', min: 2, max: 8 });
  assert.equal(screenshotSlot(2560, 1600, play)?.min, 1);
});

test('each folder is its own set, as each language is', () => {
  const files = [...rows([[1080, 1920], [1920, 1080]], 'en-US'), ...rows([[1080, 1920]], 'de-DE')];
  assert.deepEqual(failures(files), ['de-DE Phone screenshots (1080x1920) has 1 image and Google Play needs at least 2 to publish']);
});

test('an Apple display type is one set across its sizes and both ways up, and keeps at most 10', () => {
  assert.equal(auditSets(rows([[1320, 2868], [2868, 1320]]), apple).length, 1);
  const eleven: Array<[number, number]> = [...Array(6).fill([1320, 2868]), ...Array(5).fill([1290, 2796])];
  assert.deepEqual(failures(rows(eleven), apple), [
    'en-US iPhone with Dynamic Island (large display) (1290x2796, 1320x2868) has 11 screenshots and App Store keeps at most 10',
  ]);
  // A size the App Store takes no set for is still counted at its own size, and fails on its own.
  assert.equal(screenshotSlot(1000, 1000, apple), null);
  assert.deepEqual(auditSets(rows([[1000, 1000]]), apple).map((set) => set.label), ['en-US 1000x1000']);
});
