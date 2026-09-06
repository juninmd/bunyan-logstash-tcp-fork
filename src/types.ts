export interface LogstashStreamOptions {
  /** Log level (trace, debug, info, warn, error, fatal). */
  level?: string;
  /** Server name added to log metadata. Defaults to `os.hostname()`. */
  server?: string;
  /** Logstash host address. Defaults to `'127.0.0.1'`. */
  host?: string;
  /** Logstash TCP port. Defaults to `9999`. */
  port?: number;
  /** Application name added to log metadata. Defaults to `process.title`. */
  appName?: string;
  /** Process ID added to log metadata. Defaults to `process.pid`. */
  pid?: number;
  /** Tags to add to the log entry. Defaults to `['bunyan']`. */
  tags?: string[];
  /** Log type field. Optional. */
  type?: string;
  /** Enable SSL/TLS connection. Defaults to `false`. */
  ssl_enable?: boolean;
  /** Path to SSL key file. */
  ssl_key?: string;
  /** Path to SSL certificate file. */
  ssl_cert?: string;
  /** Path(s) to CA certificates. */
  ca?: string | string[];
  /** Passphrase for SSL key. */
  ssl_passphrase?: string;
  /** Size of the circular buffer for offline logs. Defaults to `10`. */
  cbuffer_size?: number;
  /** Maximum number of connection retries. Defaults to `4`. */
  max_connect_retries?: number;
  /** (Deprecated) Interval in ms between retries. Use retry_min instead. Defaults to `100`. */
  retry_interval?: number;
  /** Minimum interval in ms between retries (start of exponential backoff). Defaults to `100`. */
  retry_min?: number;
  /** Maximum interval in ms between retries. Defaults to `10000`. */
  retry_max?: number;
}
