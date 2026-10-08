// 078 — lỗi chung tạm thời (mạng, Claude quá tải, Claude cần đăng nhập lại) → tạm dừng thay vì hỏng mục.
import { describe, expect, it } from 'vitest';
import { outageOf } from '../../src/autopilot/runner.js';

describe('outageOf (078)', () => {
  it('classifies global, temporary errors', () => {
    expect(outageOf('E_INTERNAL', 'TypeError: fetch failed')?.kind).toBe('network');
    expect(outageOf('E_PROVIDER_FAILED', 'getaddrinfo ENOTFOUND api.anthropic.com')?.kind).toBe(
      'network',
    );
    expect(outageOf('E_INTERNAL', 'read ECONNRESET')?.kind).toBe('network');
    expect(outageOf('E_RUNTIME_RATE_LIMIT', 'claude: 529 Overloaded')?.kind).toBe('overloaded');
    expect(outageOf('E_AUTH_REQUIRED', 'not logged in')?.kind).toBe('auth');
    expect(outageOf('E_PROVIDER_FAILED', 'Invalid API key · Please run /login')?.kind).toBe('auth');
    expect(outageOf('E_INTERNAL', 'OAuth token has expired')?.kind).toBe('auth');
  });
  it('leaves step-specific errors alone', () => {
    expect(outageOf('E_PROVIDER_FAILED', 'tts boom')).toBeUndefined();
    expect(
      outageOf('E_GATE_FAILED', 'artifact_valid(SCRIPT.md): SCRIPT.md missing'),
    ).toBeUndefined();
    // ComfyUI cục bộ chưa chạy không phải mất mạng
    expect(outageOf('E_PROVIDER_FAILED', 'connect ECONNREFUSED 127.0.0.1:8188')).toBeUndefined();
    expect(outageOf('E_GPU_OOM', 'CUDA out of memory')).toBeUndefined();
  });
  it('waits 15 min for network, 10 for overload, 60 for login', () => {
    expect(outageOf('E_INTERNAL', 'fetch failed')!.wait_ms).toBe(15 * 60_000);
    expect(outageOf('E_RUNTIME_RATE_LIMIT', 'overloaded_error')!.wait_ms).toBe(10 * 60_000);
    expect(outageOf('E_AUTH_REQUIRED', 'x')!.wait_ms).toBe(60 * 60_000);
  });
});
