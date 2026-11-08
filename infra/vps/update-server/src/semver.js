// Version strings and their order.
//
// A version is three numbers and an optional prerelease after a hyphen, with
// no build metadata. Ordering is semver precedence: 1.0.7-beta.2 comes before
// 1.0.7-beta.10, and every prerelease of 1.0.7 comes before 1.0.7 itself.

/** A version as the API accepts it, in a URL or in a body. */
export const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Far longer than any real version, and short enough to be a folder name on any filesystem. */
const MAX_VERSION_LENGTH = 128;

/** Whether `value` is a version this server accepts. */
export function isVersion(value) {
  return typeof value === 'string' && value.length <= MAX_VERSION_LENGTH && VERSION_RE.test(value);
}

/** Two runs of digits compared as numbers, however long they are. */
function compareNumbers(a, b) {
  const x = a.replace(/^0+(?=\d)/, '');
  const y = b.replace(/^0+(?=\d)/, '');
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

function split(version) {
  const dash = version.indexOf('-');
  return {
    core: (dash === -1 ? version : version.slice(0, dash)).split('.'),
    prerelease: dash === -1 ? [] : version.slice(dash + 1).split('.'),
  };
}

/**
 * Negative when `a` comes before `b`, positive when it comes after, zero when
 * they are the same release. Both must already pass isVersion.
 */
export function compareVersions(a, b) {
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i += 1) {
    const order = compareNumbers(x.core[i], y.core[i]);
    if (order !== 0) return order;
  }

  // A prerelease comes before the release it leads up to.
  if (!x.prerelease.length && !y.prerelease.length) return 0;
  if (!x.prerelease.length) return 1;
  if (!y.prerelease.length) return -1;

  const length = Math.max(x.prerelease.length, y.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const p = x.prerelease[i];
    const q = y.prerelease[i];
    // Equal so far, so the one with fewer identifiers comes first.
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pNumeric = /^\d+$/.test(p);
    const qNumeric = /^\d+$/.test(q);
    if (pNumeric && qNumeric) {
      const order = compareNumbers(p, q);
      if (order !== 0) return order;
    } else if (pNumeric !== qNumeric) {
      // A numeric identifier comes before an alphanumeric one.
      return pNumeric ? -1 : 1;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return 0;
}
