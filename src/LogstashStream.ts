import CBuffer from 'CBuffer';
import safeStringify from 'fast-safe-stringify';
import { connectTCP, connectTLS } from './connection';
import { LogstashStreamBase } from './LogstashStreamBase';
import type { LogstashStreamOptions } from './types';
import { getTimestamp, IGNORED_KEYS, levels } from './utils';

/**
 * LogstashStream implements a Bunyan stream that sends data to Logstash via TCP or TLS.
 */
export class LogstashStream extends LogstashStreamBase {
  /**
   * Creates a new instance of LogstashStream from the options.
   *
   * @param options The constructions options.
   */
  constructor(options?: LogstashStreamOptions) {
    super(options);
    this.connect();
  }

  /**
   * Writes a log entry to the stream.
   *
   * @param entry The log entry (either a JSON string or an object).
   */
  public write(entry: unknown): void {
    if (this.silent) return;

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

    const msg: Record<string, unknown> = {
      '@timestamp': getTimestamp(rec.time),
      message: rec.msg,
      tags: this.tags,
      source: this.source,
      level,
      pid: this.pid
    };

    if (typeof this.type === 'string') msg.type = this.type;

    const keys = Object.keys(rec);
    for (let i = 0; i < keys.length; i += 1) {
      if (!IGNORED_KEYS[keys[i]]) msg[keys[i]] = rec[keys[i]];
    }

    this.send(safeStringify(msg));
  }

  /**
   * Connects to the remote Logstash server.
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
      if (this.socket) this.socket.destroy();
      this.socket = null;
      this.emit('error', err);
    };

    try {
      if (this.ssl_enable && this.tlsOptions) {
        this.socket = connectTLS(this.port, this.host, this.tlsOptions, onConnectCallback);
      } else {
        this.socket = connectTCP(this.port, this.host, onConnectCallback);
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

    this.socket.on('connect', () => {
      this.retries = 0;
      this.canWriteToExternalSocket = true;
      this.emit('connect');
    });

    this.socket.on('timeout', () => {
      if (this.socket && this.socket.readyState !== 'open') this.socket.destroy();
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
          setTimeout(() => this.connect(), delay).unref();
        }
      } else {
        this.log_queue = new CBuffer(this.cbuffer_size);
        this.silent = true;
      }
      this.emit('close');
    });
  }

  /**
   * Announces that the stream is connected and flushes the queue.
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
    if (!this.socket) return false;
    try {
      const result = this.socket.write(payload);
      if (!result) this.canWriteToExternalSocket = false;
      return result;
    } catch (e) {
      this.emit('error', e);
      return false;
    }
  }

  /**
   * Flushes the queue, sending all unwritten messages in batches.
   */
  public flush(): void {
    if (!this.connected || !this.socket) return;

    const MAX_BATCH_SIZE = 16 * 1024;
    const batch: string[] = [];
    let batchSize = 0;

    while (this.log_queue.length > 0) {
      const entry = `${this.log_queue.shift()}\n`;
      const entrySize = entry.length;

      batch.push(entry);
      batchSize += entrySize;

      if (batchSize >= MAX_BATCH_SIZE) {
        const success = this.writeToSocket(batch.join(''));
        batch.length = 0;
        batchSize = 0;
        if (!success) return;
      }
    }

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
   * Sends a string message or queues it if not connected.
   *
   * @param message The string to send.
   */
  public send(message: string): void {
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
