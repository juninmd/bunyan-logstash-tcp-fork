import { LogstashStream } from './LogstashStream';
import type { LogstashStreamOptions } from './types';

export type { LogstashStreamOptions };
export { LogstashStream };

/**
 * Creates a new instance of LogstashStream from the options.
 *
 * @param options The configurations options.
 * @returns The bunyan stream that sends data to logstash.
 */
export function createStream(options?: LogstashStreamOptions): LogstashStream {
  return new LogstashStream(options);
}
