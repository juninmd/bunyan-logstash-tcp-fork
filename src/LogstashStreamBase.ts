import CBuffer from 'CBuffer';
import { EventEmitter } from 'node:events';
import type net from 'node:net';
import os from 'node:os';
import type tls from 'node:tls';
import { createTlsOptions } from './connection.js';
import type { LogstashStreamOptions } from './types.js';

/**
 * Base class for LogstashStream handling state and configuration.
 */
export class LogstashStreamBase extends EventEmitter {
  /** The name of the stream (typically 'bunyan') */
  public name: string = 'bunyan';
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
  /** Optional log type field */
  public type?: string;
  /** Whether SSL/TLS is enabled */
  public ssl_enable: boolean;
  /** Path to SSL key */
  public ssl_key: string;
  /** Path to SSL cert */
  public ssl_cert: string;
  /** Path(s) to CA cert(s) */
  public ca: string | string[];
  /** Passphrase for SSL key */
  public ssl_passphrase?: string;
  /** The loaded TLS connection options */
  public tlsOptions?: tls.ConnectionOptions;
  /** Size of the circular buffer */
  public cbuffer_size: number;
  /** Queue of unwritten messages */
  public log_queue: CBuffer<string>;
  /** Connection state */
  public connected: boolean = false;
  /** The underlying socket */
  public socket: net.Socket | tls.TLSSocket | null = null;
  /** Current connection retries */
  public retries: number = -1;
  /** Indicates if we can write to socket (waiting for drain) */
  public canWriteToExternalSocket: boolean = false;
  /** Pre-computed source field */
  public source: string;
  /** Max allowed retries */
  public max_connect_retries: number;
  /** (Deprecated) Retry interval */
  public retry_interval: number;
  /** Minimum delay for exponential backoff */
  public retry_min: number;
  /** Maximum delay for exponential backoff */
  public retry_max: number;
  /** Whether the stream is actively trying to connect */
  public connecting: boolean = false;
  /** Whether the stream has gone permanently silent due to exhausted retries */
  public silent: boolean = false;

  /**
   * Initializes the stream state from options.
   *
   * @param options The configurations options.
   */
  constructor(options?: LogstashStreamOptions) {
    super();

    const opts = options || {};

    this.level = opts.level ?? 'info';
    this.server = opts.server ?? os.hostname();
    this.host = opts.host ?? '127.0.0.1';
    this.port = opts.port ?? 9999;
    this.application = opts.appName ?? process.title;
    this.pid = opts.pid ?? process.pid;
    this.tags = opts.tags ?? ['bunyan'];
    this.type = opts.type;

    this.source = `${this.server}/${this.application}`;

    this.ssl_enable = opts.ssl_enable ?? false;
    this.ssl_key = opts.ssl_key ?? '';
    this.ssl_cert = opts.ssl_cert ?? '';
    this.ca = opts.ca ?? '';
    this.ssl_passphrase = opts.ssl_passphrase ?? '';

    if (this.ssl_enable) {
      this.tlsOptions = createTlsOptions(opts);
    }

    this.cbuffer_size = opts.cbuffer_size ?? 10;
    this.log_queue = new CBuffer(this.cbuffer_size);
    
    this.max_connect_retries = opts.max_connect_retries ?? 4;
    this.retry_interval = opts.retry_interval ?? 100;
    this.retry_min = opts.retry_min ?? this.retry_interval ?? 100;
    this.retry_max = opts.retry_max ?? 10000;
  }
}
