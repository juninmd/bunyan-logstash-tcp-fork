const net = require('net');
const fs = require('fs');
const os = require('os');
const tls = require('tls');
const CBuffer = require('CBuffer');
const EventEmitter = require('events').EventEmitter;
const safeStringify = require('fast-safe-stringify');

const levels = new Map([
  [10, 'trace'],
  [20, 'debug'],
  [30, 'info'],
  [40, 'warn'],
  [50, 'error'],
  [60, 'fatal']
]);

// Keys that are manually constructed in the msg object and should be skipped
// in the generic copy loop
const IGNORED_KEYS = {
  msg: true,
  time: true,
  v: true,
  level: true,
  pid: true
};

/**
 * This class implements the bunyan stream contract with a stream that
 * sends data to logstash.
 *
 * @extends EventEmitter
 * @fires LogstashStream#connect
 * @fires LogstashStream#close
 * @fires LogstashStream#error
 * @fires LogstashStream#timeout
 */
class LogstashStream extends EventEmitter {
  /**
   * Creates a new instance of LogstashStream from the options.
   *
   * @param {object} options The constructions options.
   * @param {string} [options.level='info'] The log level.
   * @param {string} [options.server=os.hostname()] The server name.
   * @param {string} [options.host='127.0.0.1'] The logstash host.
   * @param {number} [options.port=9999] The logstash port.
   * @param {string} [options.appName=process.title] The application name.
   * @param {number} [options.pid=process.pid] The process ID.
   * @param {string[]} [options.tags=['bunyan']] Tags to add to the log.
   * @param {string} [options.type] The type of the log.
   * @param {boolean} [options.ssl_enable=false] Enable SSL/TLS.
   * @param {string} [options.ssl_key] Path to SSL key.
   * @param {string} [options.ssl_cert] Path to SSL certificate.
   * @param {string[]} [options.ca] Paths to CA certificates.
   * @param {string} [options.ssl_passphrase] SSL passphrase.
   * @param {number} [options.cbuffer_size=10] Size of the circular buffer.
   * @param {number} [options.max_connect_retries=4] Maximum number of connection retries.
   * @param {number} [options.retry_interval=100] Retry interval in ms.
   */
  constructor(options) {
    super();
    const opts = options || {};

    this.client = null;

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
          key: this.ssl_key ? fs.readFileSync(this.ssl_key) : null,
          cert: this.ssl_cert ? fs.readFileSync(this.ssl_cert) : null,
          passphrase: this.ssl_passphrase ? this.ssl_passphrase : null,
          ca: this.ca ? this.ca.map(filePath => fs.readFileSync(filePath)) : null
        };
      } catch (err) {
        throw new Error(`Failed to load SSL/TLS certificates: ${err.message}`);
      }
    }

    this.cbuffer_size = opts.cbuffer_size || 10;

    // Connection state
    this.log_queue = new CBuffer(this.cbuffer_size);
    this.connected = false;
    this.socket = null;
    this.retries = -1;
    this.canWriteToExternalSocket = false;

    this.max_connect_retries = (typeof opts.max_connect_retries === 'number')
      ? opts.max_connect_retries
      : 4;
    this.retry_interval = opts.retry_interval || 100;

    this.connect();
  }

  /**
   * Writes a log entry to the stream.
   *
   * @param {object|string} entry The entry to write.
   * @returns {void}
   */
  write(entry) {
    if (this.silent) {
      return;
    }

    let rec;

    if (typeof (entry) === 'string') {
      try {
        rec = JSON.parse(entry);
      } catch (e) {
        this.emit('error', e);
        return;
      }
    } else {
      rec = entry;
    }

    let level = rec.level;

    if (levels.has(level)) {
      level = levels.get(level);
    }

    let timestamp;
    try {
      if (rec.time instanceof Date) {
        timestamp = rec.time.toISOString();
      } else if (typeof rec.time === 'string') {
        timestamp = new Date(rec.time).toISOString();
      } else {
        timestamp = new Date(rec.time).toISOString();
      }
    } catch (error) {
      // If time is invalid, default to now
      timestamp = new Date().toISOString();
    }

    const msg = {
      '@timestamp': timestamp,
      message: rec.msg,
      tags: this.tags,
      source: this.source,
      level,
      pid: this.pid
    };

    if (typeof (this.type) === 'string') {
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
   * @param {function} onConnectCallback Callback called when connection is established.
   * @returns {void}
   * @private
   */
  connectTCP(onConnectCallback) {
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
   * @param {function} onConnectCallback Callback called when connection is established.
   * @returns {void}
   * @private
   */
  connectTLS(onConnectCallback) {
    this.socket = tls.connect(this.port, this.host, this.tlsOptions, () => {
      if (this.socket) {
        this.socket.setEncoding('UTF-8');
        this.socket.setKeepAlive(true, 60000); // Keep connection alive
      }
      onConnectCallback();
    });
  }

  /**
   * Connects the stream to the remote logstash server specified in the options.
   *
   * @returns {void}
   */
  connect() {
    this.retries += 1;
    this.connecting = true;

    const onConnectCallback = () => {
      this.connecting = false;
      this.announce();
    };

    const onError = (err) => {
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
          setTimeout(() => {
            this.connect();
          }, this.retry_interval).unref();
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
   *
   * @returns {void}
   */
  announce() {
    this.connected = true;
    this.flush();
  }

  /**
   * Flushes the queue, sending all messages that have not been sent yet to the remote
   * destination.
   *
   * It uses a batching mechanism to reduce the number of system calls.
   *
   * @returns {void}
   */
  flush() {
    if (!this.connected) return;

    const MAX_BATCH_SIZE = 16 * 1024; // 16KB batch size limit
    const batch = [];
    let batchSize = 0;

    // Check if we have items in the queue
    while (this.log_queue.length > 0) {
      const message = this.log_queue.shift();
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
        try {
          if (!this.socket.write(batch.join(''))) {
            this.canWriteToExternalSocket = false;
            // We can't write more right now, waiting for drain
            return;
          }
        } catch (e) {
          this.emit('error', e);
          return;
        }
        batch.length = 0;
        batchSize = 0;
      }
    }

    // Write any remaining data
    if (batch.length > 0) {
      try {
        if (!this.socket.write(batch.join(''))) {
          this.canWriteToExternalSocket = false;
        }
      } catch (e) {
        this.emit('error', e);
      }
    }
  }

  /**
   * Immediately writes a string to the undelying socket.
   *
   * @param {string} message The string to write.
   * @returns {void}
   */
  sendLog(message) {
    if (this.socket) {
      try {
        if (!this.socket.write(`${message}\n`)) {
          this.canWriteToExternalSocket = false;
        }
      } catch (e) {
        this.emit('error', e);
      }
    }
  }

  /**
   * Sends a string message. The message will be immediately sent if the stream
   * is already connected, or queued if the stream is not connected yet.
   * @param {string} message The string to send
   * @returns {void}
   */
  send(message) {
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
 * @param {object} options The constructions options. See the constructor for details.
 *
 * @returns {LogstashStream} The bunyan stream that sends data to logstash
 */
function createLogstashStream(options) {
  return new LogstashStream(options);
}

module.exports = {
  createStream: createLogstashStream,
  LogstashStream
};
