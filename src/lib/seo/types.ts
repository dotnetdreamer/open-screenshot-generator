// The SEO view's data: the sites it checks, one check of a site (a run), and
// what a run found. The checks themselves live in ./checks, copied from the
// claude-seo fork; this folder fetches pages, joins the page results into
// one picture of the site, scores it and keeps it.

import type { ContentQuality, LlmsVerdict, MetadataSiteResult, PageCheckResult, RobotsAudit, Severity } from './checks';

export type { Severity } from './checks';

/** A site the user checks: one they typed in, or the Website view's site for a project. */
export interface SeoSite {
  /** `web:<projectId>` for a Website view site, `url:<home address>` for one typed in. */
  id: string;
  /** The home page, ending in a slash. Empty for a Website view site that is not online yet. */
  url: string;
  name: string;
  source: 'website' | 'address';
  projectId?: string;
  addedAt: number;
}

/** claude-seo's seven areas (skills/seo-audit/SKILL.md, "Scoring Weights"). */
export type CheckArea = 'technical' | 'content' | 'onpage' | 'schema' | 'speed' | 'ai' | 'images';

export const AREA_WEIGHTS: Record<CheckArea, number> = {
  technical: 22,
  content: 23,
  onpage: 20,
  schema: 10,
  speed: 10,
  ai: 10,
  images: 5,
};

/** One page as the check read it. */
export interface PageReport {
  /** The address the check asked for. */
  url: string;
  /** Where it ended up after redirects. */
  finalUrl: string;
  /** Every address in between, the first one included, when there were redirects. */
  redirects: string[];
  status: number | null;
  /** Why the page could not be read, in words for the screen. */
  problem?: string;
  /** A label for the page: its path, or "Home page, German" for a Website view page. */
  label: string;
  /** The page checks, when the page was HTML. */
  checks?: PageCheckResult;
  /** The copy check of the page's visible words. */
  copy?: ContentQuality;
  /** The start of the page's visible words, for the AI when it writes a new title or description. */
  excerpt?: string;
  /** Whether robots.txt lets Google read the page. */
  googleAllowed: boolean;
  /** Whether the page came from the sitemap, a link or the start address. */
  foundBy: 'start' | 'sitemap' | 'link' | 'draft';
}

/** A finding the run reports, with the pages it was found on. */
export interface SiteFinding {
  id: string;
  severity: Severity;
  area: CheckArea;
  pages: Array<{ url: string; label: string; evidence: string; count?: number }>;
}

export interface SiteScore {
  overall: number;
  /** Each area's score, or null when nothing in that area was measured (speed before PageSpeed ran). */
  areas: Record<CheckArea, number | null>;
}

export interface SiteRun {
  id: string;
  siteId: string;
  startedAt: number;
  finishedAt: number;
  /** "live" fetched the site; "draft" read the Website view's pages before they were published. */
  mode: 'live' | 'draft';
  /**
   * The site's address when it was checked. A Website view site can move
   * to another address and keep its results, but a check of the old one
   * never says where the site is now (state.ts, liveRunOf). Older runs
   * don't have it.
   */
  site?: string;
  /** The site's root, e.g. "https://name.github.io/app/". */
  root: string;
  pages: PageReport[];
  /** Pages the site has that this run left out, over the page limit. */
  leftOut: number;
  robots: RobotsAudit;
  robotsText: string | null;
  llms: LlmsVerdict;
  llmsText: string | null;
  /**
   * `unknown`: no sitemap found, and a place one could be wasn't read
   * (run.ts, findSitemaps), so nothing is known. `unreadable`: none of the
   * site's could be read, and one place answered with a file that
   * claude-seo can't read as a sitemap, said in words.
   */
  sitemap: { url: string | null; pages: number; problem?: string; unknown?: boolean; unreadable?: { url: string; reason: string } };
  rendered: { status: 'pass' | 'warn' | 'fail' | 'info'; words: number; shell: boolean } | null;
  metadata: MetadataSiteResult;
  findings: SiteFinding[];
  score: SiteScore;
  /**
   * Addresses a browser couldn't read because the site keeps its answers from
   * other sites. They count as neither missing nor broken. Live checks only.
   */
  unread?: string[];
  /** What the run read instead of the address as typed, in words for the screen. */
  note?: string;
  /**
   * Each AI crawler and agent against the pages this run read: whether it may
   * read the site's home page, and the pages robots.txt keeps it from. Null
   * when robots.txt couldn't be read. Runs before this field have only
   * `robots.agents`, which looks at "/" alone.
   */
  aiAccess?: AgentPages[] | null;
}

export interface AgentPages {
  token: string;
  homeAllowed: boolean;
  /** Labels of the pages read that robots.txt keeps this agent from. */
  blocked: string[];
}

export interface RunProgress {
  phase: 'start' | 'robots' | 'pages' | 'extras' | 'done';
  done: number;
  total: number;
  current?: string;
}
