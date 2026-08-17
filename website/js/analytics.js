/* Interaction tracking for the marketing site.
 *
 * The gtag.js loader in each page's <head> only ever sends a pageview. That
 * tells us a page was read but not whether it did its job, so every marketing
 * page looked identical in GA4: some sessions, no outcome. This adds the few
 * coarse signals that close that loop, above all "someone left this page for
 * the editor", which is the only conversion the site actually has.
 *
 * Deliberately dependency free and framework free: 16 of the 18 pages load no
 * other script, and none of them should start.
 *
 * The editor lives on editor.openscrgen.app, a subdomain of the same root
 * domain, so GA4 keeps the session and the original acquisition source across
 * the hop on its own (cookie_domain defaults to 'auto', which writes the _ga
 * cookie at openscrgen.app, and GA auto-excludes its own domain as a
 * referrer). No cross-domain linker is needed or wanted here. What was missing
 * was never the session stitching, only the event that marks the hop.
 *
 * Same privacy line the editor holds in src/lib/analytics.ts: coarse,
 * non-identifying interaction signals only. Never URLs a user typed, never
 * anything they uploaded.
 */
(function () {
  'use strict';

  var EDITOR_HOST = 'editor.openscrgen.app';

  function gtagSafe(event, params) {
    try {
      if (typeof window.gtag === 'function') window.gtag('event', event, params);
    } catch (err) {
      /* Analytics must never break a real click. */
    }
  }

  /* Which page the click came from. Pathname only, so query strings a user may
   * have arrived with (?ref=, utm_*, anything hand-typed) are never sent on. */
  function sourcePage() {
    var p = window.location.pathname.replace(/\/$/, '');
    return p === '' ? '/' : p;
  }

  /* Where on the page the clicked control sits. Gives GA4 a breakdown of which
   * placement earns the click, so the CTAs that do nothing can be cut rather
   * than guessed at. */
  function ctaLocation(el) {
    if (el.closest('.site-header')) return 'header';
    if (el.closest('.site-footer')) return 'footer';
    if (el.closest('.hero, .page-hero')) return 'hero';
    if (el.closest('.cta')) return 'closing_cta';
    if (el.closest('.note-box')) return 'note_box';
    if (el.closest('.tpl-grid, .tpl-card')) return 'template_card';
    if (el.closest('.related-grid')) return 'related_links';
    return 'body';
  }

  /* One delegated listener rather than a listener per link. The template
   * gallery alone has ~196 editor links, and they are the reason this is
   * delegated: binding each one would cost more than everything else here. */
  document.addEventListener(
    'click',
    function (ev) {
      var link = ev.target && ev.target.closest && ev.target.closest('a[href]');
      if (!link) return;

      var url;
      try {
        url = new URL(link.href, window.location.href);
      } catch (err) {
        return;
      }

      if (url.hostname === EDITOR_HOST) {
        var params = {
          source_page: sourcePage(),
          cta_location: ctaLocation(link),
        };
        /* Template deep links carry ?template=<id>. The id is ours, from the
         * public catalog, so it identifies a design and not a person. */
        var template = url.searchParams.get('template');
        if (template) params.template = template;
        gtagSafe('editor_open', params);
        return;
      }

      if (url.hostname && url.hostname !== window.location.hostname) {
        gtagSafe('outbound_click', {
          source_page: sourcePage(),
          destination: url.hostname,
          cta_location: ctaLocation(link),
        });
      }
    },
    true
  );

  /* Which FAQ questions people actually open. This is the cheapest read we get
   * on search intent: an answer opened often on a page that ranks poorly is a
   * heading that deserves to be its own section, or its own page. */
  document.addEventListener(
    'toggle',
    function (ev) {
      var el = ev.target;
      if (!el || el.tagName !== 'DETAILS' || !el.open) return;
      var summary = el.querySelector('summary');
      if (!summary) return;
      gtagSafe('faq_open', {
        source_page: sourcePage(),
        question: summary.textContent.trim().slice(0, 100),
      });
    },
    true
  );
})();
