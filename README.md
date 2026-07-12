# bunyan-logstash-tcp-fork

[![CI](https://github.com/juninmd/bunyan-logstash-tcp-fork/actions/workflows/ci.yml/badge.svg)](https://github.com/juninmd/bunyan-logstash-tcp-fork/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/bunyan-logstash-tcp-fork.svg)](https://badge.fury.io/js/bunyan-logstash-tcp-fork)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A modern, strongly-typed [Bunyan](https://github.com/trentm/node-bunyan) stream for sending logs to Logstash via TCP or TLS/SSL.

This package is a modernized fork designed for Node.js 18+ with full TypeScript support, robust connection handling, exponential backoff retries, and high-performance log batching.

## Features

- **TypeScript Native:** Strict types for a great developer experience.
- **TCP & TLS/SSL:** Support for both standard and secure TCP connections to Logstash.
- **Reliability:** Built-in connection retries with exponential backoff and connection state management.
- **Performance:** Implements log batching, circular buffering for offline logs, and optimized JSON serialization using `fast-safe-stringify`.
- **Modern Syntax:** Refactored without legacy code to maintain low overhead and high performance.

## Installation

Install using your preferred package manager:

```bash
npm install bunyan-logstash-tcp-fork bunyan
# or
yarn add bunyan-logstash-tcp-fork bunyan
# or
pnpm add bunyan-logstash-tcp-fork bunyan
# or
bun add bunyan-logstash-tcp-fork bunyan
```

## Usage

### TypeScript Example

```typescript
import bunyan from 'bunyan';
import { createStream } from 'bunyan-logstash-tcp-fork';

const logstashStream = createStream({
  host: '127.0.0.1',
  port: 5000,
  max_connect_retries: -1, // Retry infinitely
  retry_min: 1000, // 1 second minimum delay
  retry_max: 60000 // 60 seconds maximum delay
});

logstashStream.on('error', (err) => {
  console.error('Logstash Stream Error:', err);
});

const logger = bunyan.createLogger({
  name: 'my-app',
  streams: [
    {
      type: 'raw',
      level: 'info',
      stream: logstashStream
    }
  ]
});

logger.info({ user: 'alice' }, 'User logged in successfully');
```

### JavaScript Example (CommonJS)

```javascript
const bunyan = require('bunyan');
const { createStream } = require('bunyan-logstash-tcp-fork');

const logstashStream = createStream({
  host: 'logstash.internal.network',
  port: 5044,
  ssl_enable: true,
  ssl_key: '/path/to/key.pem',
  ssl_cert: '/path/to/cert.pem',
  ca: ['/path/to/ca.pem']
});

const logger = bunyan.createLogger({
  name: 'my-secure-app',
  streams: [
    {
      type: 'raw',
      level: 'warn',
      stream: logstashStream
    }
  ]
});

logger.warn('This log is securely transmitted over TLS.');
```

## Configuration Options

When calling `createStream(options)`, the following configuration options are available:

| Option | Type | Default | Description |
|---|---|---|---|
| `host` | `string` | `'127.0.0.1'` | Logstash server hostname or IP address. |
| `port` | `number` | `9999` | Logstash server TCP port. |
| `max_connect_retries` | `number` | `4` | Max reconnection attempts. Use `-1` for infinite retries. When exceeded, the stream enters a permanent silent mode to prevent memory leaks. |
| `retry_min` | `number` | `100` | Minimum wait time (in ms) before retrying a connection (starts exponential backoff). |
| `retry_max` | `number` | `10000` | Maximum wait time (in ms) between connection retries. |
| `cbuffer_size` | `number` | `10` | Number of unwritten log messages to buffer while offline before dropping the oldest logs. |
| `level` | `string` | `'info'` | Default log level threshold. |
| `appName` | `string` | `process.title` | Name of the application (adds `source` field). |
| `server` | `string` | `os.hostname()` | Name of the server (adds `source` field). |
| `pid` | `number` | `process.pid` | Process ID. |
| `tags` | `string[]` | `['bunyan']` | Logstash tags to attach to every payload. |
| `type` | `string` | `undefined` | Logstash `type` field value. |
| `ssl_enable` | `boolean` | `false` | Enable TLS/SSL connection to Logstash. |
| `ssl_key` | `string` | `''` | File path to the SSL private key. |
| `ssl_cert` | `string` | `''` | File path to the SSL certificate. |
| `ca` | `string[] \| string` | `''` | File path(s) to the Certificate Authority bundle. |
| `ssl_passphrase` | `string` | `''` | Passphrase used for the SSL private key, if applicable. |

## Network Behavior

- **TCP Keep-Alive:** The stream actively uses TCP Keep-Alive to detect dead connections and proactively attempt reconnections.
- **Buffering & Backpressure:** Logs sent while the stream is disconnected are buffered in a FIFO `CBuffer` up to `cbuffer_size`. The stream correctly monitors `socket.write` returns; if the socket buffer fills up, it waits for the `drain` event before flushing the rest of the queue, effectively handling backpressure.
- **Batching:** Flushes transmit buffered logs using chunking (batch sizes up to ~16KB) to improve throughput and reduce underlying system calls.
- **Reconnects:** It uses an exponential backoff strategy calculated as `retry_min * (2 ** retries)`, capped at `retry_max`. If retries exceed `max_connect_retries` (and it's not set to `-1`), the stream halts gracefully, stopping further attempts and ignoring subsequent writes to avoid boundless memory exhaustion.

## License

[MIT](LICENSE.md)
