// Định dạng chat (FN-008 mục 2): tên tool, đối tượng, kết quả/lỗi đọc được, gộp tool, markdown.
import { describe, expect, it } from 'vitest';
import {
  groupRuns,
  isQuietTool,
  parseInline,
  parseMarkdown,
  stepCtas,
  toolLabel,
  toolOutcome,
  toolTarget,
} from '../../src/renderer/chat-format';

describe('chat formatting', () => {
  it('names tools in Vietnamese and shows their target', () => {
    expect(toolLabel('mcp__sf__workflow_select')).toBe('Chọn workflow');
    expect(toolLabel('mcp__sf__artifact_list')).toBe('Liệt kê tệp');
    expect(toolLabel('Skill')).toBe('Nạp kỹ năng');
    expect(isQuietTool('ToolSearch')).toBe(true);
    expect(toolTarget({ path: 'SCRIPT.md' })).toBe('SCRIPT.md');
    expect(toolTarget({ key: 'voice.id', value: 1 })).toBe('voice.id');
    expect(toolTarget({ line_ids: 'all' })).toBe('mọi line');
  });

  it('turns tool results (even truncated JSON) into readable outcomes', () => {
    expect(toolOutcome('…').status).toBe('running');
    expect(
      toolOutcome(
        '{"ok":false,"error":{"code":"E_SCOPE_DENIED","message":"no video selected in this session","retryable":false}}',
      ),
    ).toMatchObject({ status: 'error', message: 'no video selected in this session' });
    // bị cắt ở 200 ký tự
    expect(
      toolOutcome(
        '{"ok":false,"error":{"code":"E_CONFIG_UNKNOWN_KEY","message":"unknown config key \\"channel.language\\" (D3 7.2)","retr',
      ),
    ).toMatchObject({ status: 'error', message: 'unknown config key "channel.language" (D3 7.2)' });
    expect(toolOutcome('{"ok":true,"data":{"paths":["channel.json"]}}')).toMatchObject({
      status: 'ok',
      message: '',
    });
    expect(toolOutcome('{"ok":true,"data":{"workflows":[{"id":"essay').status).toBe('ok');
    expect(toolOutcome('Launching skill: studioflow-core:studioflow')).toMatchObject({
      status: 'ok',
      message: 'Launching skill: studioflow-core:studioflow',
    });
  });

  it('groups consecutive tool items', () => {
    const g = groupRuns(['t', 't', 'x', 't'], (s) => s === 't');
    expect(g.map((x) => (x.kind === 'tools' ? x.items.length : 'one'))).toEqual([2, 'one', 1]);
  });

  it('parses the markdown subset agents use', () => {
    expect(
      parseMarkdown(
        'Xin chào\n\n**Bạn cần làm:** tạo video\n\n- một\n- hai\n\n1. a\n2. b\n\n```\ncode\n```',
      ),
    ).toEqual([
      { kind: 'p', text: 'Xin chào' },
      { kind: 'p', text: '**Bạn cần làm:** tạo video' },
      { kind: 'ul', items: ['một', 'hai'] },
      { kind: 'ol', items: ['a', 'b'] },
      { kind: 'code', text: 'code' },
    ]);
    expect(parseInline('Cả `workflow_state` và **đậm** *nghiêng*')).toEqual([
      { kind: 'text', text: 'Cả ' },
      { kind: 'code', text: 'workflow_state' },
      { kind: 'text', text: ' và ' },
      { kind: 'b', text: 'đậm' },
      { kind: 'text', text: ' ' },
      { kind: 'i', text: 'nghiêng' },
    ]);
  });
});

describe('step CTAs when there is nothing to recheck (065 FR-UI-65-02)', () => {
  const step = { id: 'script', status: 'failed', title: 'Kịch bản' };
  it('a provider error or a missing output only offers Chạy lại bước', () => {
    for (const err of ['claude: error_max_turns', 'artifact_valid(SCRIPT.md): SCRIPT.md missing'])
      expect(stepCtas(step, [], err).map((c) => c.kind)).toEqual(['retry']);
  });
  it('a gate failure on an existing file keeps Kiểm tra lại first', () => {
    expect(
      stepCtas(step, [], 'artifact_valid(SCRIPT.md): line 3: bad id').map((c) => c.kind),
    ).toEqual(['recheck', 'retry']);
  });
});
