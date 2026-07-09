# bunyan-logstash-tcp-fork

[![CI](https://github.com/juninmd/bunyan-logstash-tcp-fork/actions/workflows/ci.yml/badge.svg)](https://github.com/juninmd/bunyan-logstash-tcp-fork/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/bunyan-logstash-tcp-fork.svg)](https://badge.fury.io/js/bunyan-logstash-tcp-fork)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A modern, TypeScript-first TCP stream for [Bunyan](https://github.com/trentm/node-bunyan) that sends logs to Logstash. Supports SSL/TLS, robust connection handling, batching, buffering, and exponential backoff.

This is a modernized fork of the original `bunyan-logstash-tcp` with better performance, full TypeScript support, up-to-date tooling (Node 18+), and improved handling of network drops.

## Features

- **TypeScript Ready**: First-class TypeScript support with strong typing for stream configuration.
- **Performance**: Uses `fast-safe-stringify` for blazing fast JSON serialization and reduces system calls by batching messages (up to 16KB chunks) before writing to the socket.
- **Reliability & Resilience**: Built-in exponential backoff reconnection logic. Buffers logs in a circular queue when offline and handles TCP backpressure correctly to prevent memory leaks or data loss.
- **SSL/TLS Support**: Native support for secure log transmission with configurable certificates and keys.
- **Keep-Alive**: Automatic TCP Keep-Alive to detect dead connections rapidly.
- **FIFO Ordering**: Ensures First-In-First-Out delivery of buffered logs.

## Installation

You can install this package using any major package manager:

```bash
# Using npm
npm install bunyan-logstash-tcp-fork

# Using yarn
yarn add bunyan-logstash-tcp-fork

# Using pnpm
pnpm add bunyan-logstash-tcp-fork

# Using bun
bun add bunyan-logstash-tcp-fork
```

## Usage

### TypeScript Example

```typescript
import bunyan from 'bunyan';
import { createStream } from 'bunyan-logstash-tcp-fork';

const logstashStream = createStream({
  host: '127.0.0.1',
  port: 9998,
  appName: 'my-service',
  max_connect_retries: 10,
  retry_min: 500,     // start backoff at 500ms
  retry_max: 30000,   // cap backoff at 30 seconds
  cbuffer_size: 100   // keep last 100 logs in memory while offline
});

const log = bunyan.createLogger({
  name: 'myapp',
  streams: [
    {
      level: 'info',
      type: 'raw',
      stream: logstashStream
    }
  ]
});

// Best practice: handle stream errors to prevent Node from crashing on unhandled socket errors
logstashStream.on('error', (err: Error) => {
  console.error('Logstash stream error:', err.message);
});

log.info({ user: 'johndoe' }, 'User logged in');
```

### JavaScript Example (SSL/TLS)

```javascript
const bunyan = require('bunyan');
const { createStream } = require('bunyan-logstash-tcp-fork');

const log = bunyan.createLogger({
  name: 'myapp-secure',
  streams: [
    {
      level: 'info',
      type: 'raw',
      stream: createStream({
        host: 'logstash.example.com',
        port: 9999,
        ssl_enable: true,
        ssl_key: '/path/to/client-key.pem',
        ssl_cert: '/path/to/client-cert.pem',
        ca: ['/path/to/ca-cert.pem'],
        ssl_passphrase: 'optional-passphrase'
      })
    }
  ]
});

log.info('Securely sending logs to Logstash!');
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | `string` | `"127.0.0.1"` | The Logstash host address. |
| `port` | `number` | `9999` | The Logstash TCP port. |
| `level` | `string` | `"info"` | Log level (trace, debug, info, warn, error, fatal). |
| `server` | `string` | `os.hostname()` | The server name, added to log metadata. |
| `appName` | `string` | `process.title` | Application name, added to log metadata. |
| `pid` | `number` | `process.pid` | Process ID, added to log metadata. |
| `tags` | `string[]` | `["bunyan"]` | Array of tags to add to the log entry. |
| `type` | `string` | `undefined` | The log type field. |
| `ssl_enable` | `boolean` | `false` | Enable SSL/TLS secure connection. |
| `ssl_key` | `string` | `""` | Absolute path to the SSL key file. |
| `ssl_cert` | `string` | `""` | Absolute path to the SSL certificate file. |
| `ca` | `string[]` | `[]` | Array of absolute paths to CA certificates. |
| `ssl_passphrase` | `string` | `""` | Passphrase for the SSL key. |
| `cbuffer_size` | `number` | `10` | The size of the circular buffer used to hold logs when the stream is disconnected. |
| `max_connect_retries` | `number` | `4` | Maximum number of connection retries before the stream goes permanently silent. Set to `< 0` for infinite retries. |
| `retry_min` | `number` | `100` | Minimum interval in ms between connection retries (the base for the exponential backoff). |
| `retry_max` | `number` | `10000` | Maximum interval in ms between retries. Capped exponential backoff. |
| `retry_interval` | `number` | `100` | (Deprecated) Use `retry_min` instead. |

## Network Resilience & Backpressure

### Reconnection & Backoff

If the connection to Logstash drops, this stream will automatically attempt to reconnect using an **exponential backoff algorithm**.
The wait time is calculated as `min(retry_max, retry_min * 2^retries)`.

If `max_connect_retries` is reached, the stream will clear its buffer and enter a `silent` mode where further log operations are dropped cheaply. This prevents memory leaks if Logstash becomes permanently unreachable.

### Buffering

While the stream is offline or attempting to reconnect, incoming logs are stored in a circular buffer (up to `cbuffer_size`). Once reconnected, this buffer is quickly flushed to Logstash via batch processing to minimize system calls.

### Backpressure

If the underlying Node.js TCP Socket buffer gets full, the stream will respect the Node.js `drain` event to prevent your Node application from running out of memory.

## Error Handling

By default, Node.js streams emit `error` events on network issues. If these are not handled, they will bubble up as `uncaughtException`s and crash your process.
Always listen to the `error` event:

```typescript
const stream = createStream({ ... });
stream.on('error', (err) => {
  // Silent log, or report to another APM system
});
```

## Logstash Configuration Example

A standard Logstash input configuration (`logstash.conf`) for this plugin:

```ruby
input {
  tcp {
    port => 9998
    codec => json_lines
  }
}

output {
  stdout { codec => rubydebug }
}
```

## License

[MIT](LICENSE.md)
