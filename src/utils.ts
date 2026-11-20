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
  } catch {
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
  const level = rec.level as number | string | undefined;
  const resolvedLevel =
    typeof level === 'number' && levels.has(level) ? levels.get(level) : level;

  const msg: Record<string, unknown> = {
    '@timestamp': getTimestamp(rec.time),
    message: rec.msg,
    tags,
    source,
    level: resolvedLevel ?? rec.level,
    pid
  };

  if (typeof type === 'string') msg.type = type;

  const keys = Object.keys(rec);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (!IGNORED_KEYS[key]) msg[key] = rec[key];
  }

  return msg;
}
