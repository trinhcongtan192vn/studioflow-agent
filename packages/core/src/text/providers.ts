import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { cleanEnv } from '../agent/options.js';
import type { TextGenerateInput, TextGenerateOutput } from '../contracts/types.js';
import { SfError } from '../errors.js';

/** Provider `text.*` (D4 mục 4.3): một lời gọi chat không tool. */
export interface TextProvider {
  id: string;
  available(): boolean;
  chat(model: string, input: TextGenerateInput): Promise<TextGenerateOutput>;
}

/** `text.claude`: Agent SDK một lượt, không tool, không cấu hình người dùng (005 R1, 009 R1). */
/** Thông báo hết hạn mức của gói Claude / API (không phải nội dung). */
export const LIMIT_TEXT = /hit your (session|usage|weekly) limit|usage limit|rate limit|resets \d/i;

export function claudeTextProvider(
  opts: { query?: typeof sdkQuery; getApiKey?: () => string | undefined } = {},
): TextProvider {
  return {
    id: 'text.claude',
    available: () => true,
    async chat(model, input) {
      const system = input.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const convo = input.messages
        .filter((m) => m.role !== 'system')
        .map((m) => (m.role === 'assistant' ? `[Trợ lý trước đó]\n${m.content}` : m.content))
        .join('\n\n');
      const q = (opts.query ?? sdkQuery)({
        prompt: convo,
        options: {
          model,
          settingSources: [],
          allowedTools: [],
          maxTurns: 1,
          ...(system ? { systemPrompt: system } : {}),
          env: cleanEnv(process.env, opts.getApiKey?.()),
        },
      });
      for await (const m of q) {
        if (m.type !== 'result') continue;
        if (m.subtype !== 'success') throw new SfError('E_PROVIDER_FAILED', `claude: ${m.subtype}`);
        // hết hạn mức gói Claude: SDK trả thông báo như một "kết quả" không token → lỗi rate limit
        if (
          (m as { is_error?: boolean }).is_error ||
          (!m.usage.output_tokens && LIMIT_TEXT.test(m.result))
        ) {
          throw new SfError('E_RUNTIME_RATE_LIMIT', `claude: ${m.result.slice(0, 200)}`);
        }
        return {
          text: m.result,
          usage: { input: m.usage.input_tokens ?? 0, output: m.usage.output_tokens ?? 0 },
          cost_usd: m.total_cost_usd ?? 0,
          model,
        };
      }
      throw new SfError('E_PROVIDER_FAILED', 'claude returned no result');
    },
  };
}

/** `text.openai`, `text.deepseek`: API Chat Completions tương thích OpenAI; khóa qua kho bí mật (D5 5.4). */
export function openAICompatProvider(opts: {
  id: string;
  baseUrl: string;
  secret: () => string | undefined;
  price?: (model: string, input: number, output: number) => number;
}): TextProvider {
  return {
    id: opts.id,
    available: () => Boolean(opts.secret()),
    async chat(model, input) {
      const key = opts.secret();
      if (!key)
        throw new SfError(
          'E_PROVIDER_UNAVAILABLE',
          `${opts.id}: no API key configured; add it in Settings`,
        );
      const res = await fetch(`${opts.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: input.messages,
          max_completion_tokens: input.max_tokens,
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          ...(input.response_format === 'json' ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
      if (res.status === 401) throw new SfError('E_AUTH_REQUIRED', `${opts.id}: API key rejected`);
      if (res.status === 429) throw new SfError('E_RUNTIME_RATE_LIMIT', `${opts.id}: rate limited`);
      if (!res.ok) throw new SfError('E_PROVIDER_FAILED', `${opts.id}: HTTP ${res.status}`);
      const j = (await res.json()) as {
        model?: string;
        choices: { message: { content: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const usage = { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 };
      return {
        text: j.choices[0]?.message.content ?? '',
        usage,
        cost_usd: opts.price?.(model, usage.input, usage.output) ?? 0,
        model: j.model ?? model,
      };
    },
  };
}
