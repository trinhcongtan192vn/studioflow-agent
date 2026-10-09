// 093 · FR-WF-93-02 — lỗi đặt marker nhỏ của model trong SCRIPT.md được app tự sắp lại (0 token) trước khi gán ID.
import { describe, expect, it } from 'vitest';
import {
  assignScriptIds,
  parseScript,
  repairScriptMarkup,
} from '../../src/domain/markdown/script.js';
import { validateArtifact } from '../../src/domain/validate.js';

const fm = '---\nschema_version: 1\nvideo_id: vd_rbxtpyp5\nlanguage: vi\nstatus: draft\n---\n';
const ok = `${fm}## Hook <!-- sf:beat -->\n\n<!-- sf:line speaker=narrator -->\nCâu một.\n<!-- sf:tts text="Câu một." -->\n`;

describe('repairScriptMarkup (093)', () => {
  it('a blank line between the paragraph and sf:tts is removed', () => {
    const bad = `${fm}## Hook <!-- sf:beat -->\n\n<!-- sf:line speaker=narrator -->\nCâu một.\n\n<!-- sf:tts text="Câu một." -->\n`;
    expect(repairScriptMarkup(bad)).toBe(ok);
  });

  it('sf:tts written before the paragraph is moved after it', () => {
    const bad = `${fm}## Hook <!-- sf:beat -->\n\n<!-- sf:line speaker=narrator -->\n<!-- sf:tts text="Câu một." -->\nCâu một.\n`;
    expect(repairScriptMarkup(bad)).toBe(ok);
  });

  it('valid scripts are untouched; assignScriptIds repairs then assigns ids', () => {
    expect(repairScriptMarkup(ok)).toBe(ok);
    const bad = `${fm}## Hook <!-- sf:beat -->\n\n<!-- sf:line speaker=narrator -->\nCâu một.\n\n\n<!-- sf:tts text="Câu một." -->\n`;
    const r = assignScriptIds(bad, new Set(), { seed: 's' });
    expect(r.assigned).toHaveLength(2);
    expect(validateArtifact('videos/vd_rbxtpyp5/SCRIPT.md', r.text).valid).toBe(true);
    expect(parseScript(r.text).lines[0]!.tts).toBe('Câu một.');
  });
});
