/**
 * Helper to get the timestamp from the entry.
 *
 * @param time The time field from the entry.
 * @returns The ISO string timestamp.
 */
export function getTimestamp(time: unknown): string {
  try {
    if (time instanceof Date) {
      return time.toISOString();
    }
    if (typeof time === 'string') {
      return new Date(time).toISOString();
    }
    return new Date().toISOString();
  } catch (_error) {
    // If time is invalid, default to now
    return new Date().toISOString();
  }
}

export const levels = new Map<number, string>([
  [10, 'trace'],
  [20, 'debug'],
  [30, 'info'],
  [40, 'warn'],
  [50, 'error'],
  [60, 'fatal']
]);

// Keys that are manually constructed in the msg object and should be skipped
// in the generic copy loop
export const IGNORED_KEYS: Record<string, boolean> = {
  msg: true,
  time: true,
  v: true,
  level: true,
  pid: true
};
