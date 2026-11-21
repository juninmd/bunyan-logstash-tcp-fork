import CBuffer from 'CBuffer';
import type net from 'node:net';
import type tls from 'node:tls';
import safeStringifyModule from 'fast-safe-stringify';
import { connectTCP, connectTLS } from './connection';
import { LogstashStreamBase } from './LogstashStreamBase';
import type { LogstashStreamOptions } from './types';
import { formatMessage } from './utils';

// fast-safe-stringify ships CJS; under NodeNext only its shape is loose
const safeStringify = safeStringifyModule as unknown as (value: unknown) => string;

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
    // Connection is handled explicitly via connect(), but we store state from constructor
  }

  /**
   * Connects to the remote Logstash server.
   */
  public async connect(): Promise<void> {
    this.retries += 1;
    this.connecting = true;

    let socket: net.Socket | tls.TLSSocket | null;
    try {
      if (this.ssl_enable && this.tlsOptions) {
        socket = await connectTLS(this.port, this.host, this.tlsOptions);
      } else {
        socket = await connectTCP(this.port, this.host);
      }
    } catch (e) {
      this.socket = null;
      this.connecting = false;
      // Emit error asynchronously to avoid crashing the process synchronously
      process.nextTick(() => this.emit('error', e));
      return;
    }

    this.socket = socket;

    if (!this.socket) return;
    this.socket.unref();

    const onError = (err: Error) => {
      this.connecting = false;
      this.connected = false;
      if (this.socket) this.socket.destroy();
      this.socket = null;
      this.emit('error', err);
    };

    this.socket!.addListener('error', onError);

    const onConnect = () => {
      this.connecting = false;
      this.retries = 0;
      this.canWriteToExternalSocket = true;
      this.announce();
      this.emit('connect');
    };

    this.socket!.addListener('connect', onConnect);
    // connectTCP/connectTLS only resolve once the socket is connected.
    onConnect();

    this.socket!.addListener('timeout', () => {
      if (this.socket?.readyState !== 'open') this.socket!.destroy();
      this.emit('timeout');
    });

    this.socket!.addListener('drain', () => {
      this.canWriteToExternalSocket = true;
      this.flush();
    });

    this.socket!.addListener('close', () => {
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

    const msg = formatMessage(rec, this.tags, this.source, this.pid, this.type);
    this.send(safeStringify(msg));
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
      if (result === false) this.canWriteToExternalSocket = false;
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
