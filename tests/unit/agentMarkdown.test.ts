// The Agent panel's Markdown: what it renders, and what it must never render.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentMarkdown } from '@/components/open-screenshot-generator/agent/AgentMarkdown';

const render = (text: string) => renderToStaticMarkup(createElement(AgentMarkdown, { text }));
/** As the Agent panel renders a chat whose agent can read, or once could read, a code folder. */
const renderLinksAsText = (text: string) => renderToStaticMarkup(createElement(AgentMarkdown, { text, linksAsText: true }));

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

test('a chat that may hold folder contents shows each link as its address, with nothing to click', () => {
  // The address is what could carry the code away, so it is there to read.
  const html = renderLinksAsText('See [the docs](https://x.example/?d=1) first.');
  assert.doesNotMatch(html, /<a[\s>]/);
  assert.doesNotMatch(html, /href=/);
  assert.match(html, /See the docs <span class="text-muted-foreground">https:\/\/x\.example\/\?d=1<\/span> first\./);

  // A link whose text is its address shows the address once.
  const bare = renderLinksAsText('[https://x.example](https://x.example)');
  assert.doesNotMatch(bare, /<a[\s>]/);
  assert.equal(bare.split('https://x.example').length - 1, 1);

  // In a heading and in both kinds of list too, an underscore in the address kept.
  const blocks = renderLinksAsText('## [Guide](https://a.example/g)\n\n- **Note** [b](https://b.example/?d=x_y)\n\n1. [c](http://c.example)');
  assert.doesNotMatch(blocks, /<a[\s>]|href=/);
  for (const url of ['https://a.example/g', 'https://b.example/?d=x_y', 'http://c.example']) {
    assert.ok(blocks.includes(`<span class="text-muted-foreground">${url}</span>`), url);
  }

  // A link that is not to the web shows its text only, as it does without the option.
  const other = renderLinksAsText('[local](/docs/page) and [mail](mailto:a@b.example)');
  assert.doesNotMatch(other, /href=|mailto:|\/docs\/page/);
  assert.match(other, /local and mail/);

  // The same reply in a chat with no folder keeps its link.
  assert.match(render('See [the docs](https://x.example/?d=1) first.'), /<a href="https:\/\/x\.example\/\?d=1"[^>]*>the docs<\/a>/);
});

test('an unterminated code fence ends at the end of the reply', () => {
  const html = render('Before\n```\nconst a = 1;\nno closing fence');
  assert.match(html, /<pre[^>]*><code>const a = 1;\nno closing fence<\/code><\/pre>/);
});
