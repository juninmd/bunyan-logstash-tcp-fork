import CBuffer from 'CBuffer';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';
import safeStringify from 'fast-safe-stringify';

const levels = new Map<number, string>([
  [10, 'trace'],
  [20, 'debug'],
  [30, 'info'],
  [40, 'warn'],
  [50, 'error'],
  [60, 'fatal']
]);

// Keys that are manually constructed in the msg object and should be skipped
// in the generic copy loop
const IGNORED_KEYS: Record<string, boolean> = {
  msg: true,
  time: true,
  v: true,
  level: true,
  pid: true
};

/**
 * Helper to get the timestamp from the entry.
 *
 * @param time The time field from the entry.
 * @returns The ISO string timestamp.
 */
function getTimestamp(time: unknown): string {
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

export interface LogstashStreamOptions {
  /** Log level (trace, debug, info, warn, error, fatal). */
  level?: string;
  /** Server name added to log metadata. */
  server?: string;
  /** Logstash host address. */
  host?: string;
  /** Logstash TCP port. */
  port?: number;
  /** Application name added to log metadata. */
  appName?: string;
  /** Process ID added to log metadata. */
  pid?: number;
  /** Tags to add to the log entry. */
  tags?: string[];
  /** Log type field. */
  type?: string;
  /** Enable SSL/TLS connection. */
  ssl_enable?: boolean;
  /** Path to SSL key file. */
  ssl_key?: string;
  /** Path to SSL certificate file. */
  ssl_cert?: string;
  /** Array of paths to CA certificates. */
  ca?: string[];
  /** Passphrase for SSL key. */
  ssl_passphrase?: string;
  /** Size of the circular buffer for offline logs. */
  cbuffer_size?: number;
  /** Maximum number of connection retries. */
  max_connect_retries?: number;
  /** (Deprecated) Interval in ms between retries. Use retry_min instead. */
  retry_interval?: number;
  /** Minimum interval in ms between retries (start of exponential backoff). */
  retry_min?: number;
  /** Maximum interval in ms between retries. */
  retry_max?: number;
}

/**
 * This class implements the bunyan stream contract with a stream that
 * sends data to logstash.
 */
export class LogstashStream extends EventEmitter {
  /** The name of the stream (typically 'bunyan') */
  public name: string;
  /** The log level */
  public level: string;
  /** The server name */
  public server: string;
  /** Logstash host address */
  public host: string;
  /** Logstash TCP port */
  public port: number;
  /** Application name */
  public application: string;
  /** Process ID */
  public pid: number;
  /** Tags attached to log entries */
  public tags: string[];
  /** Log type field */
  public type?: string;
  /** Pre-computed source identifier (server/application) */
  public source: string;
  /** Whether SSL/TLS is enabled */
  public ssl_enable: boolean;
  /** Path to SSL key */
  public ssl_key: string;
  /** Path to SSL certificate */
  public ssl_cert: string;
  /** Path(s) to CA certificates */
  public ca: string | string[];
  /** SSL key passphrase */
  public ssl_passphrase?: string;
  /** Compiled TLS connection options */
  public tlsOptions?: tls.ConnectionOptions;
  /** Size of the log buffer */
  public cbuffer_size: number;
  /** Circular buffer queue for logs when offline */
  public log_queue: CBuffer<string>;
  /** Whether the stream is currently connected */
  public connected: boolean;
  /** The underlying socket */
  public socket: net.Socket | tls.TLSSocket | null;
  /** Current number of connection retries */
  public retries: number;
  /** Whether it is currently safe to write to the socket */
  public canWriteToExternalSocket: boolean;
  /** Maximum number of allowed retries */
  public max_connect_retries: number;
  /** Deprecated: Base interval for retries */
  public retry_interval: number;
  /** Minimum delay for exponential backoff */
  public retry_min: number;
  /** Maximum delay for exponential backoff */
  public retry_max: number;
  /** Whether the stream is actively trying to connect */
  public connecting: boolean;
  /** Whether the stream has gone permanently silent due to exhausted retries */
  public silent: boolean;

  /**
   * Creates a new instance of LogstashStream from the options.
   *
   * @param options The constructions options.
   */
  constructor(options?: LogstashStreamOptions) {
    super();
    const opts = options || {};

    this.name = 'bunyan';
    this.level = opts.level || 'info';
    this.server = opts.server || os.hostname();
    this.host = opts.host || '127.0.0.1';
    this.port = opts.port || 9999;
    this.application = opts.appName || process.title;
    this.pid = opts.pid || process.pid;
    this.tags = opts.tags || ['bunyan'];
    this.type = opts.type;

    // Pre-compute source to avoid string concatenation on every write
    this.source = `${this.server}/${this.application}`;

    // ssl
    this.ssl_enable = opts.ssl_enable || false;
    this.ssl_key = opts.ssl_key || '';
    this.ssl_cert = opts.ssl_cert || '';
    this.ca = opts.ca || '';
    this.ssl_passphrase = opts.ssl_passphrase || '';

    if (this.ssl_enable) {
      try {
        this.tlsOptions = {
          key: this.ssl_key ? fs.readFileSync(this.ssl_key) : undefined,
          cert: this.ssl_cert ? fs.readFileSync(this.ssl_cert) : undefined,
          passphrase: this.ssl_passphrase ? this.ssl_passphrase : undefined,
          ca: Array.isArray(this.ca)
            ? this.ca.map((filePath) => fs.readFileSync(filePath))
            : this.ca
              ? [fs.readFileSync(this.ca as string)]
              : undefined
        };
      } catch (err: unknown) {
        throw new Error(
          `Failed to load SSL/TLS certificates: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    this.cbuffer_size = opts.cbuffer_size || 10;

    // Connection state
    this.log_queue = new CBuffer(this.cbuffer_size);
    this.connected = false;
    this.socket = null;
    this.retries = -1;
    this.canWriteToExternalSocket = false;

    this.max_connect_retries =
      typeof opts.max_connect_retries === 'number' ? opts.max_connect_retries : 4;
    this.retry_interval = opts.retry_interval || 100;
    this.retry_min = opts.retry_min || this.retry_interval || 100;
    this.retry_max = opts.retry_max || 10000;
    this.connecting = false;
    this.silent = false;

    this.connect();
  }

  /**
   * Writes a log entry to the stream.
   *
   * @param entry The log entry to write (either a JSON string or an object).
   */
  public write(entry: unknown): void {
    if (this.silent) {
      return;
    }

    let rec: Record<string, unknown>;

    if (typeof entry === 'string') {
      try {
        rec = JSON.parse(entry) as Record<string, unknown>;
      } catch (e) {
        this.emit('error', e);
        return;
      }
    } else {
      rec = entry as Record<string, unknown>;
    }

    let level = rec.level;

    if (typeof level === 'number' && levels.has(level)) {
      level = levels.get(level);
    }

    const timestamp = getTimestamp(rec.time);

    const msg: Record<string, unknown> = {
      '@timestamp': timestamp,
      message: rec.msg,
      tags: this.tags,
      source: this.source,
      level,
      pid: this.pid
    };

    if (typeof this.type === 'string') {
      msg.type = this.type;
    }

    // Copy other properties
    const keys = Object.keys(rec);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (!IGNORED_KEYS[key]) {
        msg[key] = rec[key];
      }
    }

    this.send(safeStringify(msg));
  }

  /**
   * Helper to create a TCP connection.
   *
   * @param onConnectCallback Callback called when connection is established.
   */
  private connectTCP(onConnectCallback: () => void): void {
    this.socket = new net.Socket();
    this.socket.connect(this.port, this.host, () => {
      if (this.socket) {
        this.socket.setKeepAlive(true, 60000);
      }
      onConnectCallback();
    });
  }

  /**
   * Helper to create a TLS connection.
   *
   * @param onConnectCallback Callback called when connection is established.
   */
  private connectTLS(onConnectCallback: () => void): void {
    this.socket = tls.connect(this.port, this.host, this.tlsOptions, () => {
      if (this.socket) {
        this.socket.setEncoding('utf-8');
        this.socket.setKeepAlive(true, 60000); // Keep connection alive
      }
      onConnectCallback();
    });
  }

  /**
   * Connects the stream to the remote logstash server specified in the options.
   */
  public connect(): void {
    this.retries += 1;
    this.connecting = true;

    const onConnectCallback = () => {
      this.connecting = false;
      this.announce();
    };

    const onError = (err: Error) => {
      this.connecting = false;
      this.connected = false;
      if (this.socket) {
        this.socket.destroy();
      }
      this.socket = null;
      this.emit('error', err);
    };

    try {
      if (this.ssl_enable) {
        this.connectTLS(onConnectCallback);
      } else {
        this.connectTCP(onConnectCallback);
      }
    } catch (e) {
      this.socket = null;
      this.connecting = false;
      process.nextTick(() => this.emit('error', e));
      return;
    }

    if (!this.socket) return;

    this.socket.unref();
    this.socket.on('error', onError);

    // Explicit connect listener to match old behavior/tests and handle TCP connect event
    this.socket.on('connect', () => {
      this.retries = 0;
      this.canWriteToExternalSocket = true;
      this.emit('connect');
    });

    this.socket.on('timeout', () => {
      if (this.socket && this.socket.readyState !== 'open') {
        this.socket.destroy();
      }
      this.emit('timeout');
    });

    this.socket.on('drain', () => {
      this.canWriteToExternalSocket = true;
      this.flush();
    });

    this.socket.on('close', () => {
      this.connected = false;

      if (this.max_connect_retries < 0 || this.retries < this.max_connect_retries) {
        if (!this.connecting) {
          const delay = Math.min(this.retry_max, this.retry_min * 2 ** this.retries);
          setTimeout(() => {
            this.connect();
          }, delay).unref();
        }
      } else {
        // Stop retrying, clear queue and go silent to prevent memory leaks
        this.log_queue = new CBuffer(this.cbuffer_size);
        this.silent = true;
      }
      this.emit('close');
    });
  }

  /**
   * Announces that the stream is connected. Will flush any messages in the queue.
   */
  public announce(): void {
    this.connected = true;
    this.flush();
  }

  /**
   * Writes the provided string to the external socket.
   * Updates state appropriately based on the write success.
   *
   * @param payload The payload to write.
   * @returns true if the write was completely flushed, false if buffering occurred.
   */
  private writeToSocket(payload: string): boolean {
    if (!this.socket) {
      return false;
    }
    try {
      const result = this.socket.write(payload);
      if (!result) {
        this.canWriteToExternalSocket = false;
      }
      return result;
    } catch (e) {
      this.emit('error', e);
      return false;
    }
  }

  /**
   * Flushes the queue, sending all messages that have not been sent yet to the remote
   * destination.
   *
   * It uses a batching mechanism to reduce the number of system calls.
   */
  public flush(): void {
    if (!this.connected || !this.socket) return;

    const MAX_BATCH_SIZE = 16 * 1024; // 16KB batch size limit
    const batch: string[] = [];
    let batchSize = 0;

    // Check if we have items in the queue
    while (this.log_queue.length > 0) {
      const message = this.log_queue.shift() as string;
      const entry = `${message}\n`;
      // Optimization: Use string length as proxy for byte length.
      // It is significantly faster than Buffer.byteLength().
      // For ASCII it is accurate. For multibyte, it underestimates,
      // which is fine as 16KB is just a soft limit for batching.
      const entrySize = entry.length;

      batch.push(entry);
      batchSize += entrySize;

      // If the chunk exceeds the batch size, write it to the socket
      if (batchSize >= MAX_BATCH_SIZE) {
        const success = this.writeToSocket(batch.join(''));
        batch.length = 0;
        batchSize = 0;

        if (!success) {
          // We can't write more right now, waiting for drain
          return;
        }
      }
    }

    // Write any remaining data
    if (batch.length > 0) {
      this.writeToSocket(batch.join(''));
    }
  }

  /**
   * Immediately writes a string to the underlying socket.
   *
   * @param message The string to write.
   */
  public sendLog(message: string): void {
    this.writeToSocket(`${message}\n`);
  }

  /**
   * Sends a string message. The message will be immediately sent if the stream
   * is already connected, or queued if the stream is not connected yet.
   * @param message The string to send
   */
  public send(message: string): void {
    // If the queue is empty and we are connected and can write, send directly.
    // This avoids unnecessary buffering and shifting.
    if (this.log_queue.length === 0 && this.connected && this.canWriteToExternalSocket) {
      this.sendLog(message);
    } else {
      this.log_queue.push(message);
      if (this.connected && this.canWriteToExternalSocket) {
        this.flush();
      }
    }
  }
}

/**
 * Creates a new instance of LogstashStream from the options.
 *
 * @param options The constructions options. See the constructor for details.
 *
 * @returns The bunyan stream that sends data to logstash
 */
export function createStream(options?: LogstashStreamOptions): LogstashStream {
  return new LogstashStream(options);
}
