import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Lang } from '../contracts/types.js';
import { resolveConfig } from '../config/resolve.js';
import { SfError } from '../errors.js';
import type { ProviderAdapter } from './types.js';

export interface ResolveScope {
  channelDir: string;
  videoId?: string;
  language?: Lang | string;
  appDataDir?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapter có kiểu I/O khác nhau theo capability
export type AnyAdapter = ProviderAdapter<any, any>;

async function healthy(a: AnyAdapter): Promise<boolean> {
  const timeout = a.manifest.health?.timeout_ms ?? 5000;
  try {
    const r = await Promise.race([
      a.health(),
      new Promise<{ ok: false }>((res) => setTimeout(() => res({ ok: false }), timeout)),
    ]);
    return r.ok;
  } catch {
    return false;
  }
}

/** Provider đã đăng ký + định tuyến theo D4 mục 4.4. */
export class ProviderRegistry {
  private readonly adapters = new Map<string, AnyAdapter>();

  register(adapter: AnyAdapter): void {
    this.adapters.set(adapter.manifest.id, adapter);
  }

  get(id: string): AnyAdapter | undefined {
    return this.adapters.get(id);
  }

  forCapability(capability: string): AnyAdapter[] {
    return [...this.adapters.values()].filter((a) => a.manifest.capabilities.includes(capability));
  }

  /**
   * Khóa `provider.<capability>` → provider khả dụng (đã đăng ký + health ok) → hỗ trợ ngôn ngữ →
   * chuỗi dự phòng trong `settings.json`. Không có → `E_PROVIDER_UNAVAILABLE`.
   */
  async resolve(capability: string, scope: ResolveScope): Promise<AnyAdapter> {
    const configured = resolveConfig<string | null>(
      `provider.${capability}`,
      { channelDir: scope.channelDir, videoId: scope.videoId },
      { appDataDir: scope.appDataDir },
    ).value;
    const settingsFile = scope.appDataDir
      ? path.join(scope.appDataDir, 'settings.json')
      : undefined;
    const fallbacks =
      settingsFile && existsSync(settingsFile)
        ? ((
            JSON.parse(readFileSync(settingsFile, 'utf8')) as {
              provider_fallbacks?: Record<string, string[]>;
            }
          ).provider_fallbacks?.[capability] ?? [])
        : [];
    let chain = [
      ...new Set([configured, ...fallbacks].filter((x): x is string => typeof x === 'string')),
    ];
    if (chain.length === 0) chain = this.forCapability(capability).map((a) => a.manifest.id);
    const tried: string[] = [];
    for (const id of chain) {
      const a = this.adapters.get(id);
      if (!a || !a.manifest.capabilities.includes(capability)) {
        tried.push(`${id} (not installed)`);
        continue;
      }
      if (
        scope.language &&
        a.manifest.languages &&
        !a.manifest.languages.includes(scope.language as Lang)
      ) {
        tried.push(`${id} (no ${scope.language})`);
        continue;
      }
      if (!(await healthy(a))) {
        tried.push(`${id} (unhealthy)`);
        continue;
      }
      return a;
    }
    // D12 mục 2: khi không có GPU, provider giả của capability thay provider thật.
    if (process.env.SF_GPU === '0') {
      const fake = this.forCapability(capability).find((a) => a.manifest.id.endsWith('.fake'));
      if (fake) return fake;
    }
    throw new SfError(
      'E_PROVIDER_UNAVAILABLE',
      `no available provider for ${capability}${tried.length ? `: ${tried.join(', ')}` : ''}; install the needed profile in Settings`,
    );
  }
}
