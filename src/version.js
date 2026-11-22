/*
 * Version compare for update checks (desktop apps and extensions).
 * "v1.10.0" > "1.9.3"; a pre-release ("1.6.0-beta.1") sorts before its release.
 * No imports: the extension updater uses it in a service worker.
 */

function parse(v) {
  const s = String(v ?? '').trim().replace(/^v/i, '');
  const [main, pre = ''] = s.split('-', 2);
  const nums = main.split('.').map((n) => (/^\d+$/.test(n) ? Number(n) : NaN));
  return { nums, pre, ok: nums.length > 0 && nums.every((n) => Number.isFinite(n)) };
}

/** Negative when a < b, 0 when equal, positive when a > b. Unparseable versions sort lowest. */
export function compareVersions(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x.ok || !y.ok) return (x.ok ? 1 : 0) - (y.ok ? 1 : 0);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** True when `latest` is a newer version than `current`. */
export function isNewer(latest, current) {
  return compareVersions(latest, current) > 0;
}
