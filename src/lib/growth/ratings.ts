// The star rating to show for an app, from its stored ratings.
//
// The App Store's public lookup says how many ratings each country has, so
// the countries are averaged by their counts. Google's report files give an
// average with no count: the whole app's under `ZZ`, and each country's, so a
// Google Play app shows the whole app's average and no count.

import { UNKNOWN_TERRITORY } from './territories';
import type { TerritoryRating } from './types';

export interface RatingSummary {
  average: number | null;
  /** How many ratings, or null when the store does not say. */
  count: number | null;
  /** Countries with a rating. */
  countries: number;
}

export function ratingSummary(ratings: TerritoryRating[]): RatingSummary {
  const byCountry = ratings.filter((rating) => rating.territory !== UNKNOWN_TERRITORY);
  const counted = byCountry.filter((rating) => rating.count > 0);
  const total = counted.reduce((sum, rating) => sum + rating.count, 0);
  if (total > 0) {
    return {
      average: counted.reduce((sum, rating) => sum + rating.average * rating.count, 0) / total,
      count: total,
      countries: counted.length,
    };
  }
  const overall = ratings.find((rating) => rating.territory === UNKNOWN_TERRITORY);
  if (overall) return { average: overall.average, count: overall.count > 0 ? overall.count : null, countries: byCountry.length };
  if (byCountry.length > 0) {
    return { average: byCountry.reduce((sum, rating) => sum + rating.average, 0) / byCountry.length, count: null, countries: byCountry.length };
  }
  return { average: null, count: null, countries: 0 };
}
