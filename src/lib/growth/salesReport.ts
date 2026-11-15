// Sales and Trends, the daily SALES SUMMARY report.
//
// One row per (product, country, currency, price, ...) per day. The column
// that says what a row counts is the Product Type Identifier, from Apple's
// reference "Product type identifiers":
//
//   1 1F 1T F1 1E 1EP 1EU 1-B F1-B   a first-time download or purchase
//   3 3F 3T F3                       a redownload
//   7 7F 7T F7                       an update
//   IA1 IA9 IAY FI1 and -M variants  an in-app purchase
//   IA3                              a restored purchase, which is not a sale
//
// App rows carry the app's Apple ID in "Apple Identifier". In-app purchase
// rows carry the PURCHASE's id there and the parent app's SKU in "Parent
// Identifier", so they can only be attributed through a SKU to app map. The
// apps endpoint lists every app's SKU, and app rows teach the map too.
//
// Units are negative for refunds, and "Developer Proceeds" is per unit in
// "Currency of Proceeds", so proceeds are units times that, summed per currency.

import { normalizeDay } from './dates';
import { columnIndex, numberCell, parseDelimited } from './delimited';
import { addCounts, bucket, feedDayFor, round2, type FeedBatch } from './records';
import { territoryCode } from './territories';

const FIRST = new Set(['1', '1F', '1T', 'F1', '1E', '1EP', '1EU', '1-B', 'F1-B']);
const REDOWNLOAD = new Set(['3', '3F', '3T', 'F3']);
const UPDATE = new Set(['7', '7F', '7T', 'F7']);

export type SalesRowKind = 'download' | 'redownload' | 'update' | 'iap' | 'ignored';

export function salesRowKind(productType: string): SalesRowKind {
  const code = productType.trim().toUpperCase();
  if (FIRST.has(code)) return 'download';
  if (REDOWNLOAD.has(code)) return 'redownload';
  if (UPDATE.has(code)) return 'update';
  if (code === 'IA3') return 'ignored';
  if (code.startsWith('IA') || code.startsWith('FI')) return 'iap';
  return 'ignored';
}

export interface SalesParseResult {
  /** Per app id, the days this report covers. */
  byApp: Map<string, FeedBatch>;
  /** SKU to app id, as learned from the app rows in this report. */
  skus: Record<string, string>;
  /** In-app purchase rows whose parent SKU no app claimed. Counted, never guessed at. */
  unattributed: number;
}

/**
 * Parse one Sales and Trends SUMMARY report. `knownSkus` is the SKU to app id
 * map from the apps endpoint and earlier reports, used for in-app purchases.
 */
export function parseSalesReport(text: string, knownSkus: Record<string, string> = {}): SalesParseResult {
  const { header, rows } = parseDelimited(text);
  const col = {
    sku: columnIndex(header, 'SKU'),
    productType: columnIndex(header, 'Product Type Identifier'),
    units: columnIndex(header, 'Units'),
    proceeds: columnIndex(header, 'Developer Proceeds'),
    begin: columnIndex(header, 'Begin Date'),
    country: columnIndex(header, 'Country Code'),
    currency: columnIndex(header, 'Currency of Proceeds'),
    appleId: columnIndex(header, 'Apple Identifier'),
    parent: columnIndex(header, 'Parent Identifier'),
  };
  const byApp = new Map<string, FeedBatch>();
  const skus: Record<string, string> = {};
  if (col.productType < 0 || col.units < 0 || col.appleId < 0) {
    return { byApp, skus, unattributed: 0 };
  }

  // App rows first, so a purchase whose parent app also downloaded that day is
  // attributed even when its row comes earlier in the file.
  for (const row of rows) {
    const kind = salesRowKind(row[col.productType] ?? '');
    if (kind === 'download' || kind === 'redownload' || kind === 'update') {
      const sku = (row[col.sku] ?? '').trim();
      const appleId = (row[col.appleId] ?? '').trim();
      if (sku && appleId) skus[sku] = appleId;
    }
  }
  const skuMap = { ...knownSkus, ...skus };

  let unattributed = 0;
  for (const row of rows) {
    const kind = salesRowKind(row[col.productType] ?? '');
    if (kind === 'ignored') continue;

    const appId =
      kind === 'iap'
        ? skuMap[(row[col.parent] ?? '').trim()]
        : (row[col.appleId] ?? '').trim();
    if (!appId) {
      if (kind === 'iap') unattributed += 1;
      continue;
    }

    const date = normalizeDay(row[col.begin]);
    if (!date) continue;
    const units = numberCell(row[col.units]);
    const perUnit = col.proceeds >= 0 ? numberCell(row[col.proceeds]) : 0;
    const currency = col.currency >= 0 ? (row[col.currency] ?? '').trim().toUpperCase() : '';
    const territory = territoryCode(col.country >= 0 ? row[col.country] : '');

    let batch = byApp.get(appId);
    if (!batch) {
      batch = new Map();
      byApp.set(appId, batch);
    }
    const counts = bucket(feedDayFor(batch, date).territories, territory);
    if (kind === 'download') addCounts(counts, { units });
    else if (kind === 'redownload') addCounts(counts, { reunits: units });
    else if (kind === 'update') addCounts(counts, { updates: units });
    else addCounts(counts, { iapUnits: units });

    const amount = round2(units * perUnit);
    if (currency && amount !== 0) addCounts(counts, { proceeds: { [currency]: amount } });
  }

  return { byApp, skus, unattributed };
}
