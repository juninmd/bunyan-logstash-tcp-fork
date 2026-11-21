import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import type { LogstashStreamOptions } from './types.js';

/**
 * Creates TLS options from the configuration.
 *
 * @param opts The stream options.
 * @returns The TLS options object or throws an error.
 */
export async function createTlsOptions(opts: LogstashStreamOptions): Promise<tls.ConnectionOptions> {
  try {
    const key = opts.ssl_key ? await fs.promises.readFile(opts.ssl_key) : undefined;
    const cert = opts.ssl_cert ? await fs.promises.readFile(opts.ssl_cert) : undefined;
    const passphrase = opts.ssl_passphrase ?? undefined;
    const ca = Array.isArray(opts.ca)
      ? await Promise.all(opts.ca.map((filePath) => fs.promises.readFile(filePath)))
      : opts.ca ? [await fs.promises.readFile(opts.ca as string)] : undefined;
    return { key, cert, passphrase, ca };
  } catch {
    throw new Error('Failed to load SSL/TLS certificates');
  }
}

/**
 * Connects via standard TCP.
 *
 * @param port The port to connect to.
 * @param host The host to connect to.
 * @returns A promise that resolves with the TCP socket.
 */
export async function connectTCP(port: number, host: string): Promise<net.Socket> {
  const socket = new net.Socket();
  socket.setKeepAlive(true, 60000);
  await new Promise<void>((resolve, reject) => {
    socket.connect(port, host, () => resolve());
    socket.on('error', (err) => reject(err));
  });
  return socket;
}

/**
 * Connects via secure TLS.
 *
 * @param port The port to connect to.
 * @param host The host to connect to.
 * @param tlsOptions The TLS options.
 * @returns A promise that resolves with the TLS socket.
 */
export async function connectTLS(
  port: number,
  host: string,
  tlsOptions: tls.ConnectionOptions
): Promise<tls.TLSSocket> {
  const socket = tls.connect(port, host, tlsOptions);
  socket.setEncoding('utf-8');
  socket.setKeepAlive(true, 60000);
  await new Promise<void>((resolve, reject) => {
    socket.once('secureConnect', () => resolve());
    socket.once('error', (err) => reject(err));
  });
  return socket;
}
