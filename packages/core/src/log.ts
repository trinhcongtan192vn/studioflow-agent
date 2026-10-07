// Log JSON có cấu trúc (constitution Điều VII) với che khóa bí mật (D5 mục 5.4).

const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  // token bot Telegram `<số>:<chuỗi>` (nằm trong URL Bot API, 055)
  /\d{6,12}:[A-Za-z0-9_-]{30,}/g,
];

/** Che chuỗi khớp mẫu khóa API/token; giữ vài ký tự đầu để nhận dạng. */
export function maskSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m) => `${m.slice(0, 6)}…[redacted]`);
  return out;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSink = (line: string) => void;

export class Logger {
  private readonly sinks = new Set<LogSink>();

  constructor() {
    if (process.env.SF_LOG) this.sinks.add((line) => process.stderr.write(`${line}\n`));
  }

  addSink(sink: LogSink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  write(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
    if (this.sinks.size === 0) return;
    const line = maskSecrets(
      JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }),
    );
    for (const s of this.sinks) s(line);
  }
}
