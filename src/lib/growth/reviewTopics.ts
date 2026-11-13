// What reviews are about, without sending them anywhere.
//
// A handful of topics that decide what a developer does next (crashes go to
// the bug tracker, price complaints to the paywall, praise to the listing
// copy), matched on word stems in the languages most reviews arrive in. It is
// deliberately a coarse net: the insight it feeds says "6 low ratings this week
// mention crashes" and links to them, and a person reads the reviews.

import type { StoreReview } from './types';
import { addDays, normalizeDay, type DayWindow } from './dates';

export type ReviewTopic =
  | 'crash'
  | 'bug'
  | 'ads'
  | 'price'
  | 'login'
  | 'data'
  | 'speed'
  | 'design'
  | 'request'
  | 'praise';

export const REVIEW_TOPIC_LABELS: Record<ReviewTopic, string> = {
  crash: 'Crashes',
  bug: 'Bugs',
  ads: 'Ads',
  price: 'Price and subscriptions',
  login: 'Sign in',
  data: 'Lost data and sync',
  speed: 'Speed and battery',
  design: 'Design',
  request: 'Feature requests',
  praise: 'Praise',
};

const PATTERNS: Record<ReviewTopic, RegExp> = {
  crash: /\b(crash\w*|freez\w*|force[- ]?clos\w*|won'?t open|keeps closing|absturz|stürzt|plant(e|age)|se cierra|crashea|trava|fecha sozinho)|クラッシュ|落ちる|闪退|崩溃/iu,
  bug: /\b(bug\w*|broken|glitch\w*|error\w*|doesn'?t work|not working|stopped working|fehler|funktioniert nicht|no funciona|não funciona|ne (marche|fonctionne) pas)|不具合|バグ|错误/iu,
  ads: /\b(ads?|advert\w*|commercials?|werbung|publicit\w*|pubs?|anuncios?|propaganda|anúncios?)\b|広告|广告/iu,
  price: /\b(pric\w*|expensive|subscri\w*|paywall|pay(ing)?|money|refund\w*|charg\w*|trial|abo\w*|teuer|kosten|cher|caro|suscripci\w*|assinatura)|課金|订阅|收费/iu,
  login: /\b(log ?in|sign ?in|password|account|anmeld\w*|konto|connexion|compte|cuenta|iniciar sesi\w*|conta)\b|ログイン|登录/iu,
  data: /\b(sync\w*|lost (my|all)|backup|icloud|deleted|synchron\w*|perdu|perd[ií]|sincroniz\w*)/iu,
  speed: /\b(slow\w*|lag\w*|battery|drain\w*|takes forever|langsam|akku|lent|batterie|lento|bater[ií]a)/iu,
  design: /\b(design|interface|ui|ugly|beautiful|layout|dark mode|font)\b/iu,
  request: /\b(wish|would be (nice|great)|please add|feature request|missing|suggestion|wünsch\w*|j'aimerais|ojal[aá]|falta)/iu,
  praise: /\b(love|great|amazing|awesome|best|perfect|excellent|super|genial|génial|incroyable|me encanta|excelente|amo|ótimo)\b|最高|好用/iu,
};

export function topicsOf(review: Pick<StoreReview, 'title' | 'body' | 'rating'>): ReviewTopic[] {
  const text = `${review.title} ${review.body}`;
  const topics = (Object.keys(PATTERNS) as ReviewTopic[]).filter((topic) => PATTERNS[topic].test(text));
  // Praise in a one star review is almost always sarcasm or "I loved it until".
  return review.rating <= 2 ? topics.filter((topic) => topic !== 'praise') : topics;
}

export function reviewDay(review: StoreReview): string {
  return normalizeDay(review.createdDate) ?? review.createdDate.slice(0, 10);
}

export function reviewsIn(reviews: StoreReview[], window: DayWindow): StoreReview[] {
  return reviews.filter((review) => {
    const day = reviewDay(review);
    return day >= window.from && day <= window.to;
  });
}

export interface TopicCount {
  topic: ReviewTopic;
  count: number;
  /** How many of those were rated one or two stars. */
  low: number;
}

export function topicCounts(reviews: StoreReview[]): TopicCount[] {
  const counts = new Map<ReviewTopic, TopicCount>();
  for (const review of reviews) {
    for (const topic of topicsOf(review)) {
      const entry = counts.get(topic) ?? { topic, count: 0, low: 0 };
      entry.count += 1;
      if (review.rating <= 2) entry.low += 1;
      counts.set(topic, entry);
    }
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

/** Reviews per star, index 0 is one star. */
export function ratingHistogram(reviews: StoreReview[]): number[] {
  const histogram = [0, 0, 0, 0, 0];
  for (const review of reviews) {
    const star = Math.min(5, Math.max(1, Math.round(review.rating)));
    histogram[star - 1] += 1;
  }
  return histogram;
}

export function averageRating(reviews: StoreReview[]): number | null {
  if (reviews.length === 0) return null;
  return reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
}

/** Low ratings with no reply yet, oldest first, since those have waited longest. */
export function unansweredLow(reviews: StoreReview[], maxRating = 2): StoreReview[] {
  return reviews
    .filter((review) => review.rating <= maxRating && !review.response)
    .sort((a, b) => a.createdDate.localeCompare(b.createdDate));
}

/** The reviews of the last `days` days ending at `latest`. */
export function recentReviews(reviews: StoreReview[], latest: string, days: number): StoreReview[] {
  return reviewsIn(reviews, { from: addDays(latest, -(days - 1)), to: latest });
}
