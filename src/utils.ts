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

/**
 * Formats a raw log record into a Logstash-compatible object.
 *
 * @param rec The raw parsed JSON or object entry.
 * @param tags The tags to attach to the log.
 * @param source The source server and app name.
 * @param pid The process ID.
 * @param type Optional log type.
 * @returns The formatted log message.
 */
export function formatMessage(
  rec: Record<string, unknown>,
  tags: string[],
  source: string,
  pid: number,
  type?: string
): Record<string, unknown> {
  let level = rec.level;
  if (typeof level === 'number' && levels.has(level)) {
    level = levels.get(level);
  }

  const msg: Record<string, unknown> = {
    '@timestamp': getTimestamp(rec.time),
    message: rec.msg,
    tags,
    source,
    level,
    pid
  };

  if (typeof type === 'string') msg.type = type;

  const keys = Object.keys(rec);
  for (let i = 0; i < keys.length; i += 1) {
    if (!IGNORED_KEYS[keys[i]]) msg[keys[i]] = rec[keys[i]];
  }

  return msg;
}
