import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SfError } from '../errors.js';
import { nodeChildEnv } from '../node-child.js';
import { ensureOutsideDirs, writeOutsideProject } from '../store/scratch.js';

/**
 * 044: MCP server YouTube (zubeid-youtube-mcp-server, MIT) chạy stdio, bọc thành tool Gateway `youtube.*`
 * (quyền, log, lỗi theo D4/D5). Gói ghim phiên bản, cài riêng trong thư mục dữ liệu của app
 * (`<app-data>/mcp/youtube`), không dùng chung với app khác. Thêm tính năng sau (đối thủ, trending…)
 * chỉ cần gọi thêm tool của server.
 */
export const YOUTUBE_MCP_PACKAGE = 'zubeid-youtube-mcp-server';
export const YOUTUBE_MCP_VERSION = '1.0.2';
/** Tên bí mật (Credential Manager / Cài đặt) của khóa YouTube Data API v3. */
export const YOUTUBE_SECRET = 'youtube_api_key';

export interface McpServerSpec {
  command: string;
  args: string[];
  cwd?: string;
}

export interface YouTubeMcpOptions {
  /** Lệnh chạy server (cài khi thiếu). */
  server: () => Promise<McpServerSpec>;
  apiKey: () => string | undefined;
}

const NO_KEY =
  'Chưa có khóa YouTube Data API v3: thêm trong Cài đặt → Khóa API (YouTube). Tạo khóa miễn phí ở Google Cloud Console → APIs & Services → YouTube Data API v3.';

export class YouTubeMcp {
  private client?: Promise<Client>;
  private key?: string;

  constructor(private readonly o: YouTubeMcpOptions) {}

  /** Gọi một tool của server; kết quả JSON đã phân tích. Lỗi của server → `E_PROVIDER_FAILED`. */
  async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const c = await this.connect();
    const r = (await c.callTool({ name: tool, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = (r.content ?? [])
      .filter((x) => x.type === 'text')
      .map((x) => x.text ?? '')
      .join('\n');
    if (r.isError)
      throw new SfError('E_PROVIDER_FAILED', text.replace(/^Error:\s*/, '').slice(0, 500));
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  async close(): Promise<void> {
    const c = this.client;
    this.client = undefined;
    if (c) await (await c.catch(() => undefined))?.close().catch(() => {});
  }

  private async connect(): Promise<Client> {
    const key = this.o.apiKey();
    if (!key) throw new SfError('E_PROVIDER_UNAVAILABLE', NO_KEY);
    // khóa đổi (người dùng nhập lại trong Cài đặt) → khởi động lại server
    if (this.client && key !== this.key) await this.close();
    this.key = key;
    this.client ??= (async () => {
      const spec = await this.o.server();
      const env = Object.fromEntries(
        Object.entries(nodeChildEnv()).filter((e): e is [string, string] => e[1] !== undefined),
      );
      const transport = new StdioClientTransport({
        command: spec.command,
        args: spec.args,
        ...(spec.cwd ? { cwd: spec.cwd } : {}),
        env: { ...env, YOUTUBE_API_KEY: key, YOUTUBE_TRANSCRIPT_LANG: 'vi' },
        stderr: 'ignore',
      });
      const client = new Client({ name: 'studioflow-agent', version: '1.0.0' });
      await client.connect(transport);
      return client;
    })();
    try {
      return await this.client;
    } catch (e) {
      this.client = undefined;
      throw new SfError('E_PROVIDER_FAILED', `YouTube MCP server: ${(e as Error).message}`);
    }
  }
}

/**
 * Lệnh chạy server đã cài trong `<app-data>/mcp/youtube`; chưa có → `npm install` gói đã ghim (một lần).
 * `SF_YOUTUBE_MCP_ENTRY` (test/dev) trỏ thẳng tới file JS của server.
 */
export function youtubeServer(appDataDir: string): () => Promise<McpServerSpec> {
  return async () => {
    const override = process.env.SF_YOUTUBE_MCP_ENTRY;
    if (override) return { command: process.execPath, args: [override] };
    const dir = path.join(appDataDir, 'mcp', 'youtube');
    const entry = path.join(dir, 'node_modules', YOUTUBE_MCP_PACKAGE, 'dist', 'cli.js');
    if (!existsSync(entry)) await installServer(dir);
    if (!existsSync(entry))
      throw new SfError('E_PROVIDER_UNAVAILABLE', `YouTube MCP server not found at ${entry}`);
    // cwd = thư mục cài: server nạp `.env` theo cwd, không lấy nhầm của dự án khác
    return { command: process.execPath, args: [entry], cwd: dir };
  };
}

function installServer(dir: string): Promise<void> {
  ensureOutsideDirs(dir);
  const pkg = path.join(dir, 'package.json');
  if (!existsSync(pkg))
    writeOutsideProject(
      pkg,
      `${JSON.stringify({ name: 'sf-youtube-mcp', private: true }, null, 2)}\n`,
    );
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return new Promise((resolve, reject) => {
    const p = spawn(
      npm,
      [
        'install',
        `${YOUTUBE_MCP_PACKAGE}@${YOUTUBE_MCP_VERSION}`,
        '--no-audit',
        '--no-fund',
        '--omit=dev',
        '--save-exact',
      ],
      { cwd: dir, shell: process.platform === 'win32', windowsHide: true, stdio: 'pipe' },
    );
    let err = '';
    p.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    const timer = setTimeout(() => p.kill(), 10 * 60_000);
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(
        new SfError(
          'E_PROVIDER_UNAVAILABLE',
          `cannot run npm to install the YouTube MCP server: ${e.message}`,
        ),
      );
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new SfError(
            'E_PROVIDER_FAILED',
            `npm install ${YOUTUBE_MCP_PACKAGE}@${YOUTUBE_MCP_VERSION} failed (exit ${code}): ${err.trim().slice(-400)}`,
          ),
        );
    });
  });
}
