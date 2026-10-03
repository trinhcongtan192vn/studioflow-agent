import type { Readable } from 'node:stream';
import { CliError } from './errors.js';

export const MAX_STDIN_BYTES = 1024 * 1024;

const badJson = (message: string): CliError => new CliError('E_CLI_BAD_JSON', message, 2);

/** Đọc JSON object từ stdin, giới hạn 1 MB để không treo/tràn bộ nhớ. */
export async function readJsonInput(stdin: Readable | string): Promise<Record<string, unknown>> {
  let text: string;
  if (typeof stdin === 'string') {
    text = stdin;
  } else {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stdin) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buf.length;
      if (size > MAX_STDIN_BYTES) throw badJson(`stdin exceeds ${MAX_STDIN_BYTES} bytes`);
      chunks.push(buf);
    }
    text = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(text) > MAX_STDIN_BYTES) {
    throw badJson(`stdin exceeds ${MAX_STDIN_BYTES} bytes`);
  }
  if (text.trim() === '') return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw badJson(`stdin is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw badJson('stdin JSON must be an object');
  }
  return value as Record<string, unknown>;
}
