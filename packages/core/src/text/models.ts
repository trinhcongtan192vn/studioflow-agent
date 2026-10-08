import { resolveConfig, type ConfigScope } from '../config/resolve.js';
import { SfError } from '../errors.js';

export interface ModelRef {
  /** `claude` | `openai` | `deepseek` (provider `text.<provider>`). */
  provider: string;
  model: string;
}

export const TEXT_PROVIDERS = ['claude', 'openai', 'deepseek'] as const;

/** Model theo hãng (009 research R2; 085: `critic` của Claude = model mạnh dùng khi `advanced.reasoning`). */
export const DEFAULT_MODELS = {
  claude: { primary: 'claude-sonnet-5-5', critic: 'claude-opus-5-5', aux: 'claude-haiku-4-5' },
  openai: { primary: 'gpt-5' },
  deepseek: { primary: 'deepseek-chat' },
} as const;

export function parseModelRef(s: string): ModelRef {
  const m = /^([a-z]+)\/(.+)$/.exec(s);
  if (!m || !(TEXT_PROVIDERS as readonly string[]).includes(m[1]!)) {
    throw new SfError(
      'E_SCHEMA_INVALID',
      `model "${s}" must be <provider>/<model> with provider ${TEXT_PROVIDERS.join('|')}`,
    );
  }
  return { provider: m[1]!, model: m[2]! };
}

const claude = (model: string): ModelRef => ({ provider: 'claude', model });
const deepseek = (): ModelRef => ({ provider: 'deepseek', model: DEFAULT_MODELS.deepseek.primary });

/**
 * `text.producer/critic/aux` theo tầng cấu hình; không đặt → mặc định D4 mục 4.3 (085): `advanced.reasoning`
 * tắt → producer DeepSeek nếu có khóa, không thì Sonnet; critic Sonnet (producer Sonnet → Haiku). Bật →
 * producer Opus, critic Sonnet. Aux: DeepSeek nếu có khóa, không thì Haiku.
 */
export function resolveTextModels(
  scope: ConfigScope,
  opts: {
    appDataDir?: string;
    getSecret: (name: string) => string | undefined;
    /** Ghi đè `advanced.reasoning` (test); không đặt → giải theo tầng. */
    reasoning?: boolean;
  },
): { producer: ModelRef; critic: ModelRef; aux: ModelRef } {
  const cfg = <T>(k: string) => resolveConfig<T>(k, scope, { appDataDir: opts.appDataDir }).value;
  const reasoning = opts.reasoning ?? cfg<boolean>('advanced.reasoning') === true;
  const hasDeepseek = Boolean(opts.getSecret('deepseek'));
  const set = (k: string) => {
    const v = cfg<string | null>(k);
    return v ? parseModelRef(v) : undefined;
  };
  const producer =
    set('text.producer') ??
    (reasoning
      ? claude(DEFAULT_MODELS.claude.critic)
      : hasDeepseek
        ? deepseek()
        : claude(DEFAULT_MODELS.claude.primary));
  const sonnetWrites =
    producer.provider === 'claude' && producer.model === DEFAULT_MODELS.claude.primary;
  const critic =
    set('text.critic') ??
    claude(sonnetWrites ? DEFAULT_MODELS.claude.aux : DEFAULT_MODELS.claude.primary);
  const aux = set('text.aux') ?? (hasDeepseek ? deepseek() : claude(DEFAULT_MODELS.claude.aux));
  return { producer, critic, aux };
}

/** D6 mục 4.1: critic phải khác producer (provider + model). */
export function assertDifferentModels(
  producer: ModelRef,
  critic: ModelRef,
): { sameVendor: boolean } {
  if (producer.provider === critic.provider && producer.model === critic.model) {
    throw new SfError(
      'E_REFINE_SAME_MODEL',
      `producer and critic are the same model (${producer.provider}/${producer.model})`,
    );
  }
  return { sameVendor: producer.provider === critic.provider };
}
