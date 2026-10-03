import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type {
  TextGenerateInput,
  TextGenerateOutput,
  TextReviewInput,
  TextReviewOutput,
} from '../contracts/types.js';
import { SfError } from '../errors.js';
import { getSecretDefault } from '../secrets/credman.js';
import { withSpan } from '../trace/trace.js';
import { Logger } from '../log.js';
import type { WriteStore } from '../store/writer.js';
import { llmCall, LlmFixtureError, type LlmMode } from '../testing/llm-replay.js';
import { resolveTextModels, type ModelRef } from './models.js';
import { claudeTextProvider, openAICompatProvider, type TextProvider } from './providers.js';

export interface TextServiceOptions {
  appDataDir?: string;
  /** Khóa API theo tên provider (`openai`, `deepseek`) — kho bí mật (D5 5.4); 009 đọc biến môi trường. */
  getSecret?: (name: string) => string | undefined;
  /** Ghi/phát lại (D12): thư mục bản ghi + chế độ; không đặt → gọi thật, không ghi. */
  fixtureDir?: string;
  mode?: LlmMode;
  endpoints?: Partial<Record<'openai' | 'deepseek', string>>;
  query?: typeof sdkQuery;
  logger?: Logger;
}

export interface CallScope {
  store: WriteStore;
  videoId?: string;
  /** Ghi đè model (mặc định theo `text.producer`/`text.aux`/`text.critic`). */
  model?: ModelRef;
  critic?: ModelRef;
}

export interface TextService {
  models(scope: CallScope): ReturnType<typeof resolveTextModels>;
  generate(
    role: 'primary' | 'aux',
    input: TextGenerateInput,
    scope: CallScope,
  ): Promise<TextGenerateOutput>;
  review(input: TextReviewInput, scope: CallScope): Promise<TextReviewOutput>;
}

/** Khóa provider: biến môi trường (dev) rồi Credential Manager `StudioFlow/<provider>` (014, D5 5.4). */
export const defaultGetSecret = (name: string): string | undefined => getSecretDefault(name);

function pricing(appDataDir?: string) {
  const f = appDataDir ? path.join(appDataDir, 'settings.json') : undefined;
  const table =
    f && existsSync(f)
      ? ((
          JSON.parse(readFileSync(f, 'utf8')) as {
            pricing?: { provider: string; model: string; unit: string; usd: number }[];
          }
        ).pricing ?? [])
      : [];
  return (provider: string) => (model: string, inp: number, out: number) => {
    const rate = (unit: string) =>
      table.find((p) => p.provider === provider && p.model === model && p.unit === unit)?.usd ?? 0;
    return (inp / 1e6) * rate('mtok_in') + (out / 1e6) * rate('mtok_out');
  };
}

/** `settings.trace.capture_content` (mặc định true, D11 mục 1). */
function captureContent(appDataDir?: string): boolean {
  const f = appDataDir ? path.join(appDataDir, 'settings.json') : undefined;
  if (!f || !existsSync(f)) return true;
  return (
    (JSON.parse(readFileSync(f, 'utf8')) as { trace?: { capture_content?: boolean } }).trace
      ?.capture_content !== false
  );
}

/** Trích JSON từ câu trả lời (bỏ rào ```json …```). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const src = fenced ?? text;
  const a = src.indexOf('{');
  const b = src.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON object');
  return JSON.parse(src.slice(a, b + 1));
}

function reviewMessages(input: TextReviewInput, retry: boolean): TextGenerateInput['messages'] {
  const r = input.rubric;
  return [
    {
      role: 'system',
      content:
        'Bạn là người chấm (critic) độc lập. Chấm bản nháp theo rubric, chỉ ra vấn đề cụ thể. ' +
        'Trả về DUY NHẤT một JSON, không giải thích thêm.',
    },
    {
      role: 'user',
      content: [
        `# Rubric ${r.id} v${r.version} (thang ${r.scale})`,
        ...r.criteria.map((c) => `- ${c.id} (trọng số ${c.weight}): ${c.prompt}`),
        `Mức độ: ${r.severity_rules}`,
        '',
        '# Brief',
        input.brief,
        '',
        '# Bản nháp',
        input.artifact_text,
        ...(input.prior_issues?.length
          ? [
              '',
              '# Vấn đề vòng trước',
              ...input.prior_issues.map((i) => `- [${i.severity}] ${i.text}`),
            ]
          : []),
        '',
        'Định dạng trả về:',
        '{"criteria": [{"id": "<id tiêu chí>", "score": <0-10>, "note": "<ngắn>"}], "issues": [{"severity": "critical|major|minor", "location": "<id line/beat nếu có>", "text": "<vấn đề>"}]}',
        ...(retry
          ? ['Lần trước bạn trả sai định dạng. Chỉ trả JSON đúng mẫu trên, đủ mọi tiêu chí.']
          : []),
      ].join('\n'),
    },
  ];
}

/** Dịch vụ text (D4 `text.generate`/`text.review`): chọn model, ghi/phát lại, cộng ngân sách video. */
export function createTextService(opts: TextServiceOptions = {}): TextService {
  const getSecret = opts.getSecret ?? defaultGetSecret;
  const price = pricing(opts.appDataDir);
  const logger = opts.logger ?? new Logger();
  const providers: Record<string, TextProvider> = {
    claude: claudeTextProvider({ query: opts.query }),
    openai: openAICompatProvider({
      id: 'text.openai',
      baseUrl: opts.endpoints?.openai ?? 'https://api.openai.com/v1',
      secret: () => getSecret('openai'),
      price: price('text.openai'),
    }),
    deepseek: openAICompatProvider({
      id: 'text.deepseek',
      baseUrl: opts.endpoints?.deepseek ?? 'https://api.deepseek.com/v1',
      secret: () => getSecret('deepseek'),
      price: price('text.deepseek'),
    }),
  };

  const models = (scope: CallScope) =>
    resolveTextModels(
      { channelDir: scope.store.root, videoId: scope.videoId },
      { appDataDir: opts.appDataDir, getSecret },
    );

  /** Lời gọi text trong span `sf.text.call` (D11): gen_ai.* + nội dung khi `trace.capture_content`. */
  function call(
    capability: string,
    ref: ModelRef,
    input: TextGenerateInput,
    scope: CallScope,
  ): Promise<TextGenerateOutput> {
    return withSpan(
      'sf.text.call',
      {
        'gen_ai.system': ref.provider,
        'gen_ai.request.model': ref.model,
        'sf.capability': capability,
        'sf.video_id': scope.videoId,
      },
      async (span) => {
        const out = await callInner(capability, ref, input, scope);
        span.setAttributes({
          'gen_ai.usage.input_tokens': out.usage.input,
          'gen_ai.usage.output_tokens': out.usage.output,
          'sf.cost_usd': out.cost_usd,
        });
        if (captureContent(opts.appDataDir)) {
          span.setAttributes({
            'input.value': input.messages
              .map((m) => `[${m.role}] ${m.content}`)
              .join('\n')
              .slice(0, 20_000),
            'output.value': out.text.slice(0, 20_000),
          });
        }
        return out;
      },
    );
  }

  async function callInner(
    capability: string,
    ref: ModelRef,
    input: TextGenerateInput,
    scope: CallScope,
  ): Promise<TextGenerateOutput> {
    const p = providers[ref.provider];
    if (!p || !p.available()) {
      throw new SfError(
        'E_PROVIDER_UNAVAILABLE',
        `text provider ${ref.provider} is not available (missing API key?)`,
      );
    }
    const t0 = Date.now();
    const real = () => p.chat(ref.model, input);
    const out =
      opts.fixtureDir && opts.mode
        ? await llmCall({ capability, provider: p.id, model: ref.model, input }, real, {
            fixtureDir: opts.fixtureDir,
            mode: opts.mode,
          }).catch((e: unknown) => {
            throw e instanceof LlmFixtureError ? new SfError(e.code, e.message) : e;
          })
        : await real();
    logger.write('info', 'sf.text.call', {
      capability,
      provider: p.id,
      model: ref.model,
      input_tokens: out.usage.input,
      output_tokens: out.usage.output,
      cost_usd: out.cost_usd,
      ms: Date.now() - t0,
    });
    if (scope.videoId) {
      const rel = `videos/${scope.videoId}/state.json`;
      const st = JSON.parse(readFileSync(scope.store.abs(rel), 'utf8')) as {
        budget: { tokens_used: number; api_cost_usd: number };
      };
      st.budget.tokens_used += out.usage.input + out.usage.output;
      st.budget.api_cost_usd = Math.round((st.budget.api_cost_usd + out.cost_usd) * 1e6) / 1e6;
      scope.store.write(rel, `${JSON.stringify(st, null, 2)}\n`, { by: 'budget' });
    }
    return out;
  }

  return {
    models,
    generate(role, input, scope) {
      const m = models(scope);
      return call(
        'text.generate',
        scope.model ?? (role === 'aux' ? m.aux : m.producer),
        input,
        scope,
      );
    },
    async review(input, scope) {
      const critic = scope.critic ?? models(scope).critic;
      let usage = { input: 0, output: 0 };
      let cost = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        const out = await call(
          'text.review',
          critic,
          {
            role: 'aux',
            messages: reviewMessages(input, attempt > 0),
            max_tokens: 4000,
            response_format: 'json',
          },
          scope,
        );
        usage = { input: usage.input + out.usage.input, output: usage.output + out.usage.output };
        cost += out.cost_usd;
        try {
          const j = extractJson(out.text) as {
            criteria: { id: string; score: number; note?: string }[];
            issues?: TextReviewOutput['issues'];
          };
          const criteria = input.rubric.criteria.map((c) => {
            const got = j.criteria.find((x) => x.id === c.id);
            if (!got || typeof got.score !== 'number') throw new Error(`missing criterion ${c.id}`);
            return {
              id: c.id,
              score: got.score,
              weight: c.weight,
              ...(got.note ? { note: got.note } : {}),
            };
          });
          const issues = (j.issues ?? []).filter(
            (i) =>
              ['critical', 'major', 'minor'].includes(i.severity) && typeof i.text === 'string',
          );
          const score =
            Math.round(criteria.reduce((s, c) => s + c.score * c.weight, 0) * 100) / 100;
          return { score, criteria, issues, usage, cost_usd: cost, model: out.model };
        } catch {
          /* thử lại một lần (D6 4.3) */
        }
      }
      throw new SfError(
        'E_REVIEW_FORMAT',
        `critic ${critic.provider}/${critic.model} did not return the review JSON format`,
      );
    },
  };
}
