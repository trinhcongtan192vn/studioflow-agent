import type { AgentEvent } from '../contracts/types.js';

const AUTH = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required',
  'billing_error',
  'cloud_credential_error',
]);
const RATE = new Set(['rate_limit', 'overloaded']);

function codeFor(kind: string): string {
  if (AUTH.has(kind)) return 'E_AUTH_REQUIRED';
  if (RATE.has(kind)) return 'E_RUNTIME_RATE_LIMIT';
  return 'E_INTERNAL';
}

function summarize(content: unknown): string {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((c: { type?: string; text?: string }) =>
              c?.type === 'text' ? (c.text ?? '') : '',
            )
            .join('')
        : '';
  return text.slice(0, 200);
}

/** Thông điệp Claude Agent SDK → `AgentEvent` (D5 mục 1). Hàm thuần, kiểm bằng unit test. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- thông điệp SDK là union rất lớn; chỉ đọc vài trường
export function mapSdkMessage(m: any): AgentEvent[] {
  switch (m?.type) {
    case 'stream_event': {
      const ev = m.event;
      if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta')
        return [{ type: 'text_delta', text: ev.delta.text }];
      return [];
    }
    case 'assistant': {
      if (m.error) return [{ type: 'error', code: codeFor(m.error), message: String(m.error) }];
      const blocks: { type: string; id?: string; name?: string; input?: unknown }[] =
        m.message?.content ?? [];
      return blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ type: 'tool_call' as const, id: b.id!, name: b.name!, input: b.input }));
    }
    case 'user': {
      const blocks = Array.isArray(m.message?.content) ? m.message.content : [];
      return blocks
        .filter((b: { type?: string }) => b?.type === 'tool_result')
        .map((b: { tool_use_id: string; is_error?: boolean; content?: unknown }) => ({
          type: 'tool_result' as const,
          id: b.tool_use_id,
          ok: !b.is_error,
          summary: summarize(b.content),
        }));
    }
    case 'result':
      if (
        (m.is_error && /limit|resets|overloaded/i.test(String(m.result ?? m.errors ?? ''))) ||
        (!m.usage?.output_tokens &&
          /hit your (session|usage|weekly) limit|usage limit|rate limit|resets \d/i.test(
            String(m.result ?? ''),
          ))
      ) {
        return [
          {
            type: 'error',
            code: 'E_RUNTIME_RATE_LIMIT',
            message: String(m.result ?? m.errors ?? 'Claude usage limit'),
          },
        ];
      }
      return [
        {
          type: 'usage',
          input_tokens: m.usage?.input_tokens ?? 0,
          output_tokens: m.usage?.output_tokens ?? 0,
          cost_usd: m.total_cost_usd,
        },
        {
          type: 'done',
          stop_reason: m.subtype === 'success' ? (m.stop_reason ?? 'end_turn') : m.subtype,
        },
      ];
    default:
      return [];
  }
}

/** Ngoại lệ từ runtime → sự kiện lỗi có mã (D5 mục 7). */
export function agentErrorFrom(e: unknown): AgentEvent {
  const message = String((e as Error)?.message ?? e).split('\n')[0]!;
  let code = 'E_INTERNAL';
  const providedCode = (e as { code?: string } | undefined)?.code;
  if (
    providedCode &&
    [
      'E_AUTH_REQUIRED',
      'E_RUNTIME_RATE_LIMIT',
      'E_PROVIDER_FAILED',
      'E_PROVIDER_UNAVAILABLE',
      'E_REFINE_SAME_MODEL',
    ].includes(providedCode)
  )
    return { type: 'error', code: providedCode, message };
  if (/api key|\/login|unauthori[sz]ed|401|authentication|not logged in/i.test(message))
    code = 'E_AUTH_REQUIRED';
  else if (/rate.?limit|429|overloaded|usage limit|session limit|weekly limit/i.test(message))
    code = 'E_RUNTIME_RATE_LIMIT';
  return { type: 'error', code, message };
}
