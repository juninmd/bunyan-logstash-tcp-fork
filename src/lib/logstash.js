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

/**
 * This class implements the bunyan stream contract with a stream that
 * sends data to logstash.
 *
 * @extends EventEmitter
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
    options = options || {};

    this.client = null;

    this.name = 'bunyan';
    this.level = options.level || 'info';
    this.server = options.server || os.hostname();
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 9999;
    this.application = options.appName || process.title;
    this.pid = options.pid || process.pid;
    this.tags = options.tags || ['bunyan'];
    this.type = options.type;

    // ssl
    this.ssl_enable = options.ssl_enable || false;
    this.ssl_key = options.ssl_key || '';
    this.ssl_cert = options.ssl_cert || '';
    this.ca = options.ca || '';
    this.ssl_passphrase = options.ssl_passphrase || '';

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

    this.cbuffer_size = options.cbuffer_size || 10;

    // Connection state
    this.log_queue = new CBuffer(this.cbuffer_size);
    this.connected = false;
    this.socket = null;
    this.retries = -1;
    this.canWriteToExternalSocket = false;

    this.max_connect_retries = (typeof options.max_connect_retries === 'number') ? options.max_connect_retries : 4;
    this.retry_interval = options.retry_interval || 100;

    this.connect();
  }

  /**
   * Writes a log entry to the steam.
   *
   * @param {object|string} entry The entry to write.
   * @returns {void}
   */
  write(entry) {
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

    const msg = {
      '@timestamp': rec.time instanceof Date ? rec.time.toISOString() : new Date(rec.time).toISOString(),
      message: rec.msg,
      tags: this.tags,
      source: `${this.server}/${this.application}`,
      level,
      pid: this.pid
    };

    if (typeof (this.type) === 'string') {
      msg.type = this.type;
    }

    // Copy other properties
    Object.keys(rec).forEach((key) => {
      if (key !== 'time' && key !== 'msg' && key !== 'v' && key !== 'level' && key !== 'pid') {
        msg[key] = rec[key];
      }
    });

    this.send(safeStringify(msg));
  }

  /**
   * Connects the stream to the remote logstash server specified in the options.
   *
   * @returns {void}
   */
  connect() {
    this.retries += 1;
    this.connecting = true;
    if (this.ssl_enable) {
      try {
        this.socket = tls.connect(this.port, this.host, this.tlsOptions, () => {
          if (this.socket) {
            this.socket.setEncoding('UTF-8');
            this.announce();
          }
          this.connecting = false;
        });
      } catch (e) {
        this.socket = null;
        this.connecting = false;
        process.nextTick(() => this.emit('error', e));
        return;
      }
    } else {
      this.socket = new net.Socket();
    }

    if (!this.socket) return;

    this.socket.unref();

    this.socket.on('error', (err) => {
      this.connecting = false;
      this.connected = false;
      if (this.socket) {
        this.socket.destroy();
      }
      this.socket = null;
      this.emit('error', err);
    });

    this.socket.on('timeout', () => {
      if (this.socket && this.socket.readyState !== 'open') {
        this.socket.destroy();
      }
      this.emit('timeout');
    });

    this.socket.on('connect', () => {
      this.retries = 0;
      this.canWriteToExternalSocket = true;
      this.emit('connect');
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
        this.log_queue = new CBuffer(this.cbuffer_size);
        this.silent = true;
      }
      this.emit('close');
    });

    if (!this.ssl_enable) {
      this.socket.connect(this.port, this.host, () => {
        this.announce();
        this.connecting = false;
      });
    }
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
   * @returns {void}
   */
  flush() {
    let message = this.log_queue.shift();
    while (message) {
      this.sendLog(message.message);

      if (!this.canWriteToExternalSocket) {
        // If backpressure happens, the data is already in Node's buffer,
        // so we don't need to put it back. We just stop flushing.
        break;
      }
      message = this.log_queue.shift();
    }
  }

  /**
   * Immediately writes a string to the undelying socket.
   *
   * @param {string} message The string to write.
   * @returns {void}
   */
  sendLog(message) {
    if (this.socket && !this.socket.write(`${message}\n`)) {
      this.canWriteToExternalSocket = false;
    }
  }

  /**
   * Sends a string message. The message will be immediately sent if the stream
   * is already connected, or queued if the stream is not connected yet.
   * @param {string} message The string to send
   * @returns {void}
   */
  send(message) {
    // Always use the queue to ensure order if there are pending messages.
    // If the queue is empty and we can write, we could optimize, but it's safer to just push/flush.
    // However, for performance, if queue is empty and canWrite, send directly.
    if (this.log_queue.length === 0 && this.connected && this.canWriteToExternalSocket) {
      this.sendLog(message);
    } else {
      this.log_queue.push({
        message
      });
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
