// Numbers as the growth screens print them. Shared with the insight text and
// the reports, so a figure reads the same on a card, in a chart tooltip and in
// an exported report.

/** 1,234 below ten thousand, 12.3K and 1.2M above. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trim(value / 1_000_000, abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${trim(value / 1_000, abs >= 100_000 ? 0 : 1)}K`;
  return Math.round(value).toLocaleString('en-US');
}

/** Exact, with separators, for tables and exports. */
export function formatExact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return Math.round(value).toLocaleString('en-US');
}

function trim(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0$/, '');
}

/** A rate as a percentage: 0.0342 is "3.42%", 0.342 is "34.2%". */
export function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  const percent = value * 100;
  const digits = percent < 10 ? 2 : 1;
  return `${percent.toFixed(digits)}%`;
}

export function formatMoney(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return 'n/a';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: Math.abs(amount) >= 1000 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** "4.6" for an average, with one decimal. */
export function formatRating(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(1);
}

/** "3 days ago", "just now", for sync times. */
export function formatAgo(timestamp: number | undefined, now = Date.now()): string {
  if (!timestamp) return 'never';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatExact(count)} ${count === 1 ? one : many}`;
}
