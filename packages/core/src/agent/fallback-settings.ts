import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultAppDataDir } from '../config/resolve.js';
import type { Gateway } from '../gateway/gateway.js';
import { CodexPlanRuntime } from './codex.js';
import { resolveCodexCommand } from './codex-command.js';

export function fallbackSettings(appDataDir = defaultAppDataDir()) {
  const file = path.join(appDataDir, 'settings.json');
  const config = existsSync(file)
    ? ((JSON.parse(readFileSync(file, 'utf8')) as { config?: Record<string, unknown> }).config ??
      {})
    : {};
  return {
    enabled: config['agent.fallback.enabled'] !== false,
    model: String(config['agent.fallback.model'] ?? '').trim(),
    command: resolveCodexCommand({ configured: String(config['agent.fallback.command'] ?? '') }),
  };
}

export function createCodexPlan(gateway: Gateway, appDataDir = defaultAppDataDir()) {
  return new CodexPlanRuntime({
    gateway,
    home: path.join(appDataDir, 'codex'),
    command: () => fallbackSettings(appDataDir).command,
    model: () => fallbackSettings(appDataDir).model,
  });
}
