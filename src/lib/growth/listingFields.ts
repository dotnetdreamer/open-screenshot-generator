// Which text fields a store page has, what each is called and how long it may
// be, per store.
//
// A Google Play listing is kept in the same shape as an App Store one
// (ListingLocale), with three of its fields in use: the title in `name`, the
// short description in `subtitle` and the full description in `description`.
// Everything that shows, checks or writes a field asks here, so a Google Play
// page never offers keywords and never says "subtitle".

import { storeOf, type GrowthStore } from './stores';
import { LISTING_FIELDS, LISTING_FIELD_LABELS, LISTING_LIMITS, type ListingField } from './types';

const PLAY_FIELDS: ListingField[] = ['name', 'subtitle', 'description'];

/** Google Play's limits, from Play Console's store listing form. */
const PLAY_LIMITS: Partial<Record<ListingField, number>> = { name: 30, subtitle: 80, description: 4000 };

const PLAY_LABELS: Partial<Record<ListingField, string>> = {
  name: 'Title',
  subtitle: 'Short description',
  description: 'Full description',
};

function storeFor(appIdOrStore: string): GrowthStore {
  return appIdOrStore === 'appstore' || appIdOrStore === 'playstore' ? appIdOrStore : storeOf(appIdOrStore);
}

/** The fields a store page has, in the order its form shows them. Takes an app id or a store. */
export function listingFieldsFor(appIdOrStore: string): ListingField[] {
  return storeFor(appIdOrStore) === 'playstore' ? PLAY_FIELDS : LISTING_FIELDS;
}

export function listingLimit(appIdOrStore: string, field: ListingField): number {
  return storeFor(appIdOrStore) === 'playstore' ? PLAY_LIMITS[field] ?? 0 : LISTING_LIMITS[field];
}

export function listingFieldLabel(appIdOrStore: string, field: ListingField): string {
  return storeFor(appIdOrStore) === 'playstore' ? PLAY_LABELS[field] ?? LISTING_FIELD_LABELS[field] : LISTING_FIELD_LABELS[field];
}

/** Every field's limit, for a prompt that names them. */
export function listingLimits(appIdOrStore: string): Array<{ field: ListingField; label: string; limit: number }> {
  return listingFieldsFor(appIdOrStore).map((field) => ({
    field,
    label: listingFieldLabel(appIdOrStore, field),
    limit: listingLimit(appIdOrStore, field),
  }));
}
