// Two small guards on what crosses from a model into the editor: a screenshot
// sent as base64 has to be the whole file, and text cut for the IPC bridge
// must never keep half an emoji.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { imageBytesComplete } from '@/lib/mcp/desktopMcpServer';
import { clipText } from '@/lib/clipText';

const cut = (bytes: Uint8Array, keep: number) => bytes.slice(0, keep);
const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : part)));

test('a screenshot cut short is not taken for a whole one', () => {
  // A real PNG from the template catalog, then the same file cut in half: the
  // browser would still draw the top of it without an error.
  const png = new Uint8Array(fs.readFileSync(path.join(process.cwd(), 'public/data/projects/amoura-dating-as265366403.png')));
  assert.equal(imageBytesComplete(png), true);
  assert.equal(imageBytesComplete(cut(png, Math.floor(png.length / 2))), false);
  assert.equal(imageBytesComplete(cut(png, png.length - 4)), false, 'without its CRC the IEND chunk is cut too');

  const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0], new Array(64).fill(7), [0xff, 0xd9]);
  assert.equal(imageBytesComplete(jpeg), true);
  assert.equal(imageBytesComplete(bytes([...jpeg], [0, 0, 0])), true, 'padding after the end marker is fine');
  assert.equal(imageBytesComplete(cut(jpeg, 40)), false);

  const gif = bytes('GIF89a', new Array(32).fill(1), [0x3b]);
  assert.equal(imageBytesComplete(gif), true);
  assert.equal(imageBytesComplete(cut(gif, 20)), false);

  const payload = new Array(20).fill(9);
  const webp = bytes('RIFF', [4 + payload.length, 0, 0, 0], 'WEBP', payload);
  assert.equal(imageBytesComplete(webp), true);
  assert.equal(imageBytesComplete(cut(webp, 18)), false);

  // Formats it cannot judge are left to the decoder.
  assert.equal(imageBytesComplete(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')), true);
});

test('cut text never keeps half an emoji', () => {
  const text = 'Plan every trip with your crew 🚀 today';
  const at = text.indexOf('🚀');
  // Cutting right after the rocket's first half drops the whole rocket.
  assert.equal(clipText(text, at + 1), `${text.slice(0, at)}…`);
  assert.equal(clipText(text, at + 2), `${text.slice(0, at + 2)}…`);
  assert.equal(clipText('short', 10), 'short');
  assert.equal(clipText('abcdef', 3, '...'), 'abc...');
  for (let max = 0; max <= text.length; max++) {
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(clipText(text, max)), `a lone high surrogate at ${max}`);
  }
});
