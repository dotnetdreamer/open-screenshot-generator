// The Agent panel's Markdown: what it renders, and what it must never render.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentMarkdown } from '@/components/open-screenshot-generator/agent/AgentMarkdown';

const render = (text: string) => renderToStaticMarkup(createElement(AgentMarkdown, { text }));

test('the common Markdown in a reply renders', () => {
  const html = render('## Done\n\nI made the **headline** bigger and used `apply_template`.\n\n- one\n- two\n\n1. first\n2. second');
  assert.match(html, /<p class="font-semibold">Done<\/p>/);
  assert.match(html, /<strong>headline<\/strong>/);
  assert.match(html, /<code[^>]*>apply_template<\/code>/);
  assert.match(html, /<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol[^>]*><li>first<\/li><li>second<\/li><\/ol>/);
});

test('underscores inside a word stay part of it', () => {
  const html = render('Called set_localized_texts and apply_template, then _this_ was emphasised.');
  assert.match(html, /set_localized_texts/);
  assert.match(html, /apply_template/);
  assert.match(html, /<em>this<\/em>/);
});

test('nothing the model writes becomes markup', () => {
  const html = render('<img src=x onerror=alert(1)> [click](javascript:alert(1)) [ok](https://openscrgen.app)');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /href="https:\/\/openscrgen.app"/);
});

test('an unterminated code fence ends at the end of the reply', () => {
  const html = render('Before\n```\nconst a = 1;\nno closing fence');
  assert.match(html, /<pre[^>]*><code>const a = 1;\nno closing fence<\/code><\/pre>/);
});
