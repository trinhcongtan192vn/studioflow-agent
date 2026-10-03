import { resolveConfig, type ConfigScope } from '../config/resolve.js';
import { SfError } from '../errors.js';

export interface ModelRef {
  /** `claude` | `openai` | `deepseek` (provider `text.<provider>`). */
  provider: string;
  model: string;
}

export const TEXT_PROVIDERS = ['claude', 'openai', 'deepseek'] as const;

/** Mặc định `[chờ S14]` (009 research R2). */
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

/**
 * `text.producer/critic/aux` theo tầng cấu hình; không đặt → mặc định D4 mục 4.3: producer OpenAI nếu
 * có khóa, không thì Claude; critic Claude khác tầng; aux rẻ nhất có khóa.
 */
export function resolveTextModels(
  scope: ConfigScope,
  opts: { appDataDir?: string; getSecret: (name: string) => string | undefined },
): { producer: ModelRef; critic: ModelRef; aux: ModelRef } {
  const cfg = (k: string) =>
    resolveConfig<string | null>(k, scope, { appDataDir: opts.appDataDir }).value;
  const producer = cfg('text.producer')
    ? parseModelRef(cfg('text.producer')!)
    : opts.getSecret('openai')
      ? { provider: 'openai', model: DEFAULT_MODELS.openai.primary }
      : { provider: 'claude', model: DEFAULT_MODELS.claude.primary };
  let critic = cfg('text.critic')
    ? parseModelRef(cfg('text.critic')!)
    : { provider: 'claude', model: DEFAULT_MODELS.claude.critic };
  if (!cfg('text.critic') && producer.provider === 'claude' && producer.model === critic.model) {
    critic = { provider: 'claude', model: DEFAULT_MODELS.claude.primary };
  }
  const aux = cfg('text.aux')
    ? parseModelRef(cfg('text.aux')!)
    : { provider: 'claude', model: DEFAULT_MODELS.claude.aux };
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
