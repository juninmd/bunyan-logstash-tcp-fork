import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import type { LogstashStreamOptions } from './types';

/**
 * Creates TLS options from the configuration.
 *
 * @param opts The stream options.
 * @returns The TLS options object or throws an error.
 */
export function createTlsOptions(opts: LogstashStreamOptions): tls.ConnectionOptions {
  try {
    return {
      key: opts.ssl_key ? fs.readFileSync(opts.ssl_key) : undefined,
      cert: opts.ssl_cert ? fs.readFileSync(opts.ssl_cert) : undefined,
      passphrase: opts.ssl_passphrase ? opts.ssl_passphrase : undefined,
      ca: Array.isArray(opts.ca)
        ? opts.ca.map((filePath) => fs.readFileSync(filePath))
        : opts.ca
          ? [fs.readFileSync(opts.ca as string)]
          : undefined
    };
  } catch (err: unknown) {
    throw new Error(
      `Failed to load SSL/TLS certificates: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Connects via standard TCP.
 *
 * @param port The port to connect to.
 * @param host The host to connect to.
 * @param onConnect Callback invoked on success.
 * @returns The TCP socket.
 */
export function connectTCP(port: number, host: string, onConnect: () => void): net.Socket {
  const socket = new net.Socket();
  socket.connect(port, host, () => {
    socket.setKeepAlive(true, 60000);
    onConnect();
  });
  return socket;
}

/**
 * Connects via secure TLS.
 *
 * @param port The port to connect to.
 * @param host The host to connect to.
 * @param tlsOptions The TLS options.
 * @param onConnect Callback invoked on success.
 * @returns The TLS socket.
 */
export function connectTLS(
  port: number,
  host: string,
  tlsOptions: tls.ConnectionOptions,
  onConnect: () => void
): tls.TLSSocket {
  const socket = tls.connect(port, host, tlsOptions, () => {
    socket.setEncoding('utf-8');
    socket.setKeepAlive(true, 60000);
    onConnect();
  });
  return socket;
}
