// Starting points for a film: a shape, a camera, a backdrop and words that
// go together. Picking one is the first step of a new film; everything it
// sets can be changed afterwards. The previews are short loops made from a
// made-up app (public/director/templates/), so a template shows what it does
// before there's a recording.

import { withBasePath } from '@/lib/basePath';
import type { DirectorStyle, FilmFormat, WordsStyle } from './types';

export interface FilmTemplate {
  id: string;
  name: string;
  /** When to pick it, in a few words. */
  when: string;
  format: FilmFormat;
  style: DirectorStyle;
  /** A BACKDROPS id, or 'brand' for the project's own colours. */
  backdrop: string;
  /** The app's name as the title at the start. */
  title: boolean;
  /** Words at the end. */
  end: string;
  captions: boolean;
  taps: boolean;
  /** Only offered when the project has colours to use. */
  needsColors?: boolean;
  /** How the words look. Unset is Soft. */
  words?: WordsStyle;
  /** The app's icon at the top while it plays. */
  logo?: boolean;
  /** Ends on a card with the icon, the name and the store badges: white, or over the film's own backdrop. */
  card?: { light: boolean };
}

export const FILM_TEMPLATES: FilmTemplate[] = [
  {
    // After the launch films phone makers and apps put out: black, close and
    // steep on the screen, fast pull-backs, big warm words, a white end card.
    id: 'cinematic',
    name: 'Cinematic',
    when: 'Dramatic close-ups and big words on black, like a launch film',
    format: 'vertical',
    style: 'cinematic',
    backdrop: 'noir',
    title: true,
    end: '',
    captions: true,
    taps: false,
    words: 'headline',
    card: { light: true },
  },
  {
    // After bright app ads: violet discs on a pale room, bold captions with
    // a highlighted word, the icon at the top, the badges at the end.
    id: 'pop',
    name: 'Pop promo',
    when: 'Bright colors, bold captions and your icon, for ads',
    format: 'vertical',
    style: 'bold',
    backdrop: 'bloom',
    title: true,
    end: 'Download it free',
    captions: true,
    taps: true,
    words: 'punchy',
    logo: true,
    card: { light: false },
  },
  {
    id: 'launch',
    name: 'Launch',
    when: 'A tall video for Reels, TikTok and Shorts',
    format: 'vertical',
    style: 'lively',
    backdrop: 'aurora',
    title: true,
    end: 'Out now',
    captions: true,
    taps: true,
  },
  {
    id: 'feature-tour',
    name: 'Feature tour',
    when: 'Calm close-ups on each feature, for your website',
    format: 'portrait',
    style: 'calm',
    backdrop: 'studio',
    title: true,
    end: 'Try it free',
    captions: true,
    taps: true,
  },
  {
    id: 'social-ad',
    name: 'Social ad',
    when: 'Quick, big moves in a square, for any feed',
    format: 'square',
    style: 'bold',
    backdrop: 'sunrise',
    title: true,
    end: 'Get it today',
    captions: true,
    taps: true,
  },
  {
    id: 'website-hero',
    name: 'Website hero',
    when: 'Wide, with your words beside the phone',
    format: 'landscape',
    style: 'calm',
    backdrop: 'midnight',
    title: true,
    end: '',
    captions: false,
    taps: false,
  },
  {
    id: 'just-the-phone',
    name: 'Just the phone',
    when: 'No words, only your app on a phone',
    format: 'vertical',
    style: 'calm',
    backdrop: 'mint',
    title: false,
    end: '',
    captions: false,
    taps: true,
  },
  {
    id: 'your-colors',
    name: 'Your colors',
    when: "Made from your project's colors",
    format: 'vertical',
    style: 'lively',
    backdrop: 'brand',
    title: true,
    end: 'Download it free',
    captions: true,
    taps: true,
    needsColors: true,
  },
];

export function templateById(id: string | undefined): FilmTemplate | null {
  return FILM_TEMPLATES.find((template) => template.id === id) ?? null;
}

/** The template's preview loop and still, under public/. */
export function templatePreview(template: FilmTemplate): { video: string; poster: string } {
  return { video: withBasePath(`/director/templates/${template.id}.mp4`), poster: withBasePath(`/director/templates/${template.id}.webp`) };
}
