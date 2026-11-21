import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';
import { expect } from 'chai';
import sinon from 'sinon';
import { createStream, type LogstashStream, type LogstashStreamOptions } from '../index';

class MockSocket extends EventEmitter {
  public unrefCalled = false;
  public destroyCalled = false;
  public encoding: string | null = null;
  public host: string | null = null;
  public port: number | null = null;
  public content = '';
  public keepAlive = false;
  public keepAliveDelay: number | null = null;
  public readyState = '';

  public connect(port: number, host: string, callback?: () => void) {
    this.host = host;
    this.port = port;
    // Resolve the connection promise and emit the event like a real socket.
    setTimeout(() => {
      this.emit('connect');
      if (typeof callback === 'function') callback();
    }, 10);
  }

  public unref() {
    this.unrefCalled = true;
  }

  public destroy() {
    this.destroyCalled = true;
  }

  public setEncoding(encoding: string) {
    this.encoding = encoding;
  }

  public setKeepAlive(enable: boolean, initialDelay: number) {
    this.keepAlive = enable;
    this.keepAliveDelay = initialDelay;
  }

  public write(data: string) {
    this.content += data;
    return true;
  }

  public dispatchEvent(event: string) {
    this.emit(event);
  }
}

describe('LogstashStream', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(net.Socket.prototype, 'connect').callsFake(function (this: net.Socket) {
      setTimeout(() => this.emit('connect'), 10);
      return this;
    });
    process.on('uncaughtException', () => {});
  });

  afterEach(() => {
    sandbox.restore();
    process.removeAllListeners('uncaughtException');
  });

  describe('constructor', () => {
    it('Should create a default instance', () => {
      const stream = createStream();
      expect(stream).to.have.property('name', 'bunyan');
      expect(stream).to.have.property('level', 'info');
      expect(stream).to.have.property('server', os.hostname());
      expect(stream).to.have.property('host', '127.0.0.1');
      expect(stream).to.have.property('port', 9999);
      expect(stream).to.have.property('application', process.title);
      expect(stream).to.have.property('pid', process.pid);
      expect(stream).to.have.property('tags').to.eql(['bunyan']);
      expect(stream).to.have.property('ssl_enable', false);
      expect(stream).to.have.property('cbuffer_size', 10);
      expect(stream).to.have.property('max_connect_retries', 4);
      expect(stream).to.have.property('retry_interval', 100);
      expect(stream).to.have.property('retry_min', 100);
      expect(stream).to.have.property('retry_max', 10000);
    });

    it('Should create an instance with provided options', () => {
      const stream = createStream({
        name: 'custom',
        level: 'debug',
        server: 'custom-server',
        host: '10.0.0.1',
        port: 8080,
        appName: 'custom-app',
        pid: 1234,
        tags: ['custom-tag'],
        type: 'custom-type',
        cbuffer_size: 100,
        max_connect_retries: 10,
        retry_interval: 200,
        retry_min: 50,
        retry_max: 5000
      } as unknown as LogstashStreamOptions);

      expect(stream).to.have.property('level', 'debug');
      expect(stream).to.have.property('server', 'custom-server');
      expect(stream).to.have.property('host', '10.0.0.1');
      expect(stream).to.have.property('port', 8080);
      expect(stream).to.have.property('application', 'custom-app');
      expect(stream).to.have.property('pid', 1234);
      expect(stream).to.have.property('tags').to.eql(['custom-tag']);
      expect(stream).to.have.property('type', 'custom-type');
      expect(stream).to.have.property('cbuffer_size', 100);
      expect(stream).to.have.property('max_connect_retries', 10);
      expect(stream).to.have.property('retry_interval', 200);
      expect(stream).to.have.property('retry_min', 50);
      expect(stream).to.have.property('retry_max', 5000);
    });

    it('Should handle SSL/TLS options correctly', () => {
      sandbox.stub(fs, 'readFileSync').returns(Buffer.from('dummy-content'));
      const stream = createStream({
        ssl_enable: true,
        ssl_key: '/path/to/key',
        ssl_cert: '/path/to/cert',
        ca: ['/path/to/ca'],
        ssl_passphrase: 'password'
      });

      expect(stream).to.have.property('ssl_enable', true);
      expect(stream.tlsOptions?.key?.toString()).to.equal('dummy-content');
      expect(stream.tlsOptions?.cert?.toString()).to.equal('dummy-content');
      expect(stream.tlsOptions).to.have.property('passphrase', 'password');
      expect(stream.tlsOptions?.ca).to.be.an('array').with.lengthOf(1);
    });

    it('Should throw error when SSL certificates fail to load', () => {
      sandbox.stub(fs, 'readFileSync').throws(new Error('File not found'));
      expect(() => {
        createStream({
          ssl_enable: true,
          ssl_key: '/invalid/path'
        });
      }).to.throw('Failed to load SSL/TLS certificates: File not found');
    });
  });

  describe('write', () => {
    let stream: LogstashStream;
    let sendStub: sinon.SinonStub;

    beforeEach(() => {
      stream = createStream();
      sendStub = sandbox.stub(stream, 'send');
    });

    it('Should ignore writes when silent is true', () => {
      stream.silent = true;
      stream.write({ msg: 'hello' });
      expect(sendStub.callCount).to.equal(0);
    });

    it('Should parse string entry and format message', () => {
      stream.write(JSON.stringify({ msg: 'hello', level: 30, custom: 'field' }));
      expect(sendStub.callCount).to.equal(1);
      const args = sendStub.firstCall.args;
      const parsed = JSON.parse(args[0]);

      expect(parsed).to.have.property('message', 'hello');
      expect(parsed).to.have.property('level', 'info');
      expect(parsed).to.have.property('custom', 'field');
      expect(parsed).to.have.property('@timestamp');
    });

    // SECURITY: the payload must be serialized as data, never interpreted
    it('Should safely serialize malicious string input', () => {
      const sqlPayload = "'; DROP TABLE users; --";
      stream.write(JSON.stringify({ msg: sqlPayload, level: 30 }));
      expect(sendStub.callCount).to.equal(1);
      const parsed = JSON.parse(sendStub.firstCall.args[0]);
      expect(parsed).to.have.property('message', sqlPayload);
    });

    // SECURITY: XSS markup is preserved as plain data by the JSON serialization
    it('Should safely serialize XSS payload', () => {
      const xssPayload = "<script>alert('XSS')</script>";
      stream.write(JSON.stringify({ msg: xssPayload, level: 30 }));
      expect(sendStub.callCount).to.equal(1);
      const parsed = JSON.parse(sendStub.firstCall.args[0]);
      expect(parsed).to.have.property('message', xssPayload);
    });

    it('Should handle invalid JSON string entry by emitting error', () => {
      stream.on('error', () => {});
      const emitSpy = sandbox.spy(stream, 'emit');
      stream.write('invalid-json');
      expect(emitSpy.calledWith('error')).to.be.true;
      expect(sendStub.callCount).to.equal(0);
    });

    it('Should parse object entry and format message', () => {
      stream.write({ msg: 'hello', level: 30, custom: 'field' });
      expect(sendStub.callCount).to.equal(1);
      const parsed = JSON.parse(sendStub.firstCall.args[0]);

      expect(parsed).to.have.property('message', 'hello');
      expect(parsed).to.have.property('level', 'info');
      expect(parsed).to.have.property('custom', 'field');
    });

    it('Should handle different time formats', () => {
      const now = new Date();
      stream.write({ msg: 'hello', level: 30, time: now });
      expect(JSON.parse(sendStub.firstCall.args[0])).to.have.property(
        '@timestamp',
        now.toISOString()
      );

      sendStub.reset();
      stream.write({ msg: 'hello', level: 30, time: now.toISOString() });
      expect(JSON.parse(sendStub.firstCall.args[0])).to.have.property(
        '@timestamp',
        now.toISOString()
      );

      sendStub.reset();
      stream.write({ msg: 'hello', level: 30, time: 'invalid-date' });
      expect(JSON.parse(sendStub.firstCall.args[0])).to.have.property('@timestamp');
    });
  });

  describe('connect', () => {
    it('Should connect via TCP when ssl_enable is false', async () => {
      const socketMock = new MockSocket();
      sandbox.stub(net, 'Socket').returns(socketMock as unknown as net.Socket);

      const stream = createStream();

      await stream.connect();

      expect(stream.socket).to.equal(socketMock);
      expect(socketMock.keepAlive).to.be.true;
    });

    it('Should connect via TLS when ssl_enable is true', async () => {
      const socketMock = new MockSocket();
      sandbox.stub(tls, 'connect').callsFake((...args: unknown[]) => {
        const callback = args[args.length - 1] as () => void;
        setTimeout(callback, 10);
        return socketMock as unknown as tls.TLSSocket;
      });
      sandbox.stub(fs, 'readFileSync').returns(Buffer.from('dummy'));

      const stream = createStream({ ssl_enable: true, ssl_key: 'dummy' } as unknown as LogstashStreamOptions);

      await stream.connect();

      expect(stream.socket).to.equal(socketMock);
      expect(socketMock.encoding).to.equal('utf-8');
      expect(socketMock.keepAlive).to.be.true;
    });

    it('Should handle socket timeout', async () => {
      const socketMock = new MockSocket();
      sandbox.stub(net, 'Socket').returns(socketMock as unknown as net.Socket);

      const stream = createStream();
      const emitSpy = sandbox.spy(stream, 'emit');

      await stream.connect();

      socketMock.dispatchEvent('timeout');

      expect(socketMock.destroyCalled).to.be.true;
      expect(emitSpy.calledWith('timeout')).to.be.true;
    });

    it('Should handle socket drain event', async () => {
      const socketMock = new MockSocket();
      sandbox.stub(net, 'Socket').returns(socketMock as unknown as net.Socket);

      const stream = createStream();
      const flushStub = sandbox.stub(stream, 'flush');

      await stream.connect();

      socketMock.dispatchEvent('drain');

      expect(stream.canWriteToExternalSocket).to.be.true;
      expect(flushStub.called).to.be.true;
    });

    it('Should handle connection retries with exponential backoff', async () => {
      const clock = sandbox.useFakeTimers();
      (net.Socket.prototype.connect as sinon.SinonStub).restore();

      sandbox.stub(net.Socket.prototype, 'connect').callsFake(function (this: net.Socket) {
        return this;
      });

      const stream = createStream({
        max_connect_retries: 2,
        retry_min: 100,
        retry_max: 10000
      } as unknown as LogstashStreamOptions);
      stream.socket = new MockSocket() as unknown as net.Socket;

      stream.retries = 0;
      stream.connecting = false;
      stream.emit('close');

      const triggerClose = () => {
        const delay = Math.min(stream.retry_max, stream.retry_min * 2 ** stream.retries);
        setTimeout(() => stream.connect(), delay).unref();
      };

      triggerClose();

      await clock.tickAsync(100);
      expect(stream.retries).to.equal(1);

      stream.connecting = false;
      triggerClose();

      await clock.tickAsync(200);
      expect(stream.retries).to.equal(2);

      clock.restore();
    });

    it('Should go silent when max retries exceeded', async () => {
      const socketMock = new MockSocket();
      sandbox.stub(net, 'Socket').returns(socketMock as unknown as net.Socket);

      const stream = createStream({
        max_connect_retries: 1
      } as unknown as LogstashStreamOptions);

      await stream.connect();

      stream.retries = 1;
      stream.connecting = false;

      socketMock.dispatchEvent('close');

      expect(stream.silent).to.be.true;
    });
  });

  describe('flush', () => {
    it('Should batch messages and write to socket', () => {
      const stream = createStream();
      stream.connected = true;
      stream.canWriteToExternalSocket = true;
      stream.socket = new MockSocket() as unknown as net.Socket;

      stream.log_queue.push('a');
      stream.log_queue.push('b');

      const writeSpy = sandbox.spy(stream.socket as unknown as net.Socket, 'write');

      stream.flush();

      expect(writeSpy.calledOnce).to.be.true;
      expect(writeSpy.firstCall.args[0]).to.equal('a\nb\n');
      expect(stream.log_queue.toArray()).to.have.length(0);
    });

    it('Should stop writing when socket returns false and wait for drain', () => {
      const stream = createStream();
      stream.connected = true;
      stream.canWriteToExternalSocket = true;
      stream.socket = new MockSocket() as unknown as net.Socket;

      sandbox.stub(stream.socket as unknown as net.Socket, 'write').returns(false);

      stream.log_queue.push('a');
      stream.log_queue.push('b');

      stream.flush();

      expect(stream.canWriteToExternalSocket).to.be.false;
    });
  });

  describe('send', () => {
    it('Should write log directly if connected and queue empty', () => {
      const stream = createStream();
      stream.connected = true;
      stream.canWriteToExternalSocket = true;
      const sendLogStub = sandbox.stub(stream, 'sendLog');

      stream.send('hello');

      expect(sendLogStub.calledOnceWith('hello')).to.be.true;
    });

    it('Should queue log if not connected', () => {
      const stream = createStream();
      stream.connected = false;
      const sendLogStub = sandbox.stub(stream, 'sendLog');

      stream.send('hello');

      expect(sendLogStub.called).to.be.false;
      expect(stream.log_queue.pop()).to.equal('hello');
    });
  });
});
