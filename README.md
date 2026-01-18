# Logstash TCP stream for Bunyan

[![CircleCI](https://circleci.com/gh/transcovo/bunyan-logstash-tcp.svg?style=shield)](https://circleci.com/gh/transcovo/bunyan-logstash-tcp)
[![codecov](https://codecov.io/gh/transcovo/bunyan-logstash-tcp/branch/master/graph/badge.svg)](https://codecov.io/gh/transcovo/bunyan-logstash-tcp)

A tcp logger for [Logstash](http://logstash.net/docs/1.4.2/inputs/tcp) that supports SSL/TLS, buffering, and backpressure.

## Features

- **Performance**: Optimized write operations, minimal object allocation, and faster JSON serialization using `fast-safe-stringify`.
- **Batching**: Reduces system calls by batching log messages (up to 16KB chunks) before writing to the socket.
- **Reliability**: Robust error handling for connection issues, TLS configuration, and JSON parsing. Automatic reconnection logic.
- **Backpressure**: Handles TCP backpressure to prevent memory leaks or data loss.
- **Ordering**: Ensures FIFO (First-In-First-Out) delivery of buffered logs.
- **SSL/TLS Support**: Secure logging with SSL/TLS.
- **Modern**: ES6 class-based implementation.

## Installation

```bash
npm install bunyan-logstash-tcp-fork
```

## Usage

### Basic Usage

```javascript
const bunyan = require('bunyan');
const bunyantcp = require('bunyan-logstash-tcp-fork');

const log = bunyan.createLogger({
  name: 'myapp',
  streams: [
    {
      level: 'info',
      type: 'raw',
      stream: bunyantcp.createStream({
        host: '127.0.0.1',
        port: 9998
      })
    }
  ]
});

log.info('Hello Logstash!');
```

### SSL/TLS Usage

```javascript
const log = bunyan.createLogger({
  name: 'myapp',
  streams: [
    {
      level: 'info',
      type: 'raw',
      stream: bunyantcp.createStream({
        host: 'logstash.example.com',
        port: 9998,
        ssl_enable: true,
        ssl_key: '/path/to/client-key.pem',
        ssl_cert: '/path/to/client-cert.pem',
        ca: ['/path/to/ca-cert.pem']
      })
    }
  ]
});
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | `string` | `"127.0.0.1"` | Logstash host address. |
| `port` | `number` | `9999` | Logstash TCP port. |
| `level` | `string` | `"info"` | Log level (trace, debug, info, warn, error, fatal). |
| `server` | `string` | `os.hostname()` | Server name added to log metadata. |
| `appName` | `string` | `process.title` | Application name added to log metadata. |
| `pid` | `number` | `process.pid` | Process ID added to log metadata. |
| `tags` | `string[]` | `["bunyan"]` | Tags to add to the log entry. |
| `type` | `string` | `undefined` | Log type field. |
| `ssl_enable` | `boolean` | `false` | Enable SSL/TLS connection. |
| `ssl_key` | `string` | `""` | Path to SSL key file. |
| `ssl_cert` | `string` | `""` | Path to SSL certificate file. |
| `ca` | `string[]` | `[]` | Array of paths to CA certificates. |
| `ssl_passphrase` | `string` | `""` | Passphrase for SSL key. |
| `cbuffer_size` | `number` | `10` | Size of the circular buffer for offline logs. |
| `max_connect_retries` | `number` | `4` | Maximum number of connection retries. |
| `retry_interval` | `number` | `100` | Interval in ms between retries. |

## Error Handling

The stream emits `error` events. It is recommended to handle these to prevent the application from crashing.

```javascript
const stream = bunyantcp.createStream({ ... });

stream.on('error', (err) => {
  console.error('Logstash stream error:', err);
});
```

## Logstash Configuration

Example `logstash.conf`:

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

## Credits

This module is heavily based on [bunyan-logstash](https://github.com/sheknows/bunyan-logstash) and re-uses parts of [winston-logstash](https://github.com/jaakkos/winston-logstash/blob/master/lib/winston-logstash.js).

Thanks to

- [sheknows](https://github.com/sheknows)
- [jaakkos](https://github.com/jaakkos) 
- [Chris Rock](https://github.com/chris-rock/bunyan-logstash-tcp)

for their amazing work

## License

MIT
