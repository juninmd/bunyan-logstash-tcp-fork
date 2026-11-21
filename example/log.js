"use strict";

import { createStream } from '../src/index.js';

const log = bunyan.createLogger({
  name: 'example',
  streams: [
    {
      level: 'debug',
      stream: process.stdout
    },
    {
      level: 'debug',
      type: 'raw',
      stream: createStream({
        host: '127.0.0.1',
        port: 9998
      }).on('error', console.error)
    }
  ],
  level: 'debug'
});

log.debug('test');
log.error('error test');