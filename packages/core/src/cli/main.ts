import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getVersion } from '../version.js';
import { SfError } from '../errors.js';
import { usageError } from './errors.js';
import { readJsonInput } from './io.js';
import { loadCommands } from './registry.js';
import type { CliCommand } from './types.js';

export type { CliCommand, CommandContext, OptionSpec } from './types.js';
export { CliError, usageError } from './errors.js';

export interface MainIo {
  stdin?: Readable | string;
  stdout?: Writable;
  stderr?: Writable;
  /** Thư mục chứa module; mặc định `modules/` cạnh khung. */
  modulesDirs?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

const defaultModulesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'modules');

function writeJson(stream: Writable, value: unknown): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

function buildInput(cmd: CliCommand, args: string[], json: Record<string, unknown>) {
  const options: NonNullable<Parameters<typeof parseArgs>[0]>['options'] = {
    json: { type: 'boolean' },
  };
  for (const [name, spec] of Object.entries(cmd.options ?? {})) {
    options[name] = {
      type: spec.type,
      ...(spec.short ? { short: spec.short } : {}),
      ...(spec.multiple ? { multiple: true } : {}),
    };
  }
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (e) {
    throw usageError((e as Error).message);
  }
  const input: Record<string, unknown> = { ...json };
  const names = cmd.positionals ?? [];
  names.forEach((name, i) => {
    if (name.endsWith('...')) {
      const rest = parsed.positionals.slice(i);
      if (rest.length) input[name.slice(0, -3)] = rest;
    } else if (parsed.positionals[i] !== undefined) {
      input[name] = parsed.positionals[i];
    }
  });
  const variadic = names.some((n) => n.endsWith('...'));
  if (!variadic && parsed.positionals.length > names.length) {
    throw usageError(`unexpected argument: ${parsed.positionals[names.length]}`);
  }
  for (const [name, value] of Object.entries(parsed.values)) {
    if (name !== 'json' && value !== undefined) input[name] = value;
  }
  for (const [name, spec] of Object.entries(cmd.options ?? {})) {
    const v = input[name];
    if (v === undefined) {
      if (spec.required) throw usageError(`missing required option --${name}`);
      continue;
    }
    if (spec.kind === 'number') {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) throw usageError(`--${name} must be a number, got "${String(v)}"`);
      input[name] = n;
    } else if ((spec.kind ?? spec.type) === 'string' && !spec.multiple && typeof v !== 'string') {
      throw usageError(`--${name} must be a string`);
    }
  }
  return { input, wantsJson: parsed.values.json === true };
}

/** Điểm vào CLI `sf` (D4 mục 12). Trả về mã thoát; không gọi `process.exit`. */
export async function main(argv: string[], io: MainIo = {}): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  try {
    if (argv[0] === '--version' || argv[0] === '-v') {
      writeJson(stdout, getVersion());
      return 0;
    }
    const commands = await loadCommands(io.modulesDirs ?? [defaultModulesDir]);
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
      writeJson(stdout, {
        commands: commands.map(({ module, name, summary }) => ({ module, name, summary })),
      });
      return 0;
    }
    const [mod, name, ...rest] = argv;
    const cmd = commands.find((c) => c.module === mod && c.name === name);
    if (!cmd) throw usageError(`unknown command: sf ${[mod, name].filter(Boolean).join(' ')}`);
    const wantsJson = rest.includes('--json');
    const json = wantsJson ? await readJsonInput(io.stdin ?? process.stdin) : {};
    const { input } = buildInput(cmd, rest, json);
    const result = await cmd.run(input, {
      cwd: io.cwd ?? process.cwd(),
      env: io.env ?? process.env,
    });
    writeJson(stdout, result ?? {});
    return 0;
  } catch (e) {
    if (e instanceof SfError) {
      writeJson(stderr, {
        code: e.code,
        message: e.message,
        ...(e.details === undefined ? {} : { details: e.details }),
      });
      return e.exit;
    }
    writeJson(stderr, { code: 'E_INTERNAL', message: (e as Error)?.message ?? String(e) });
    return 1;
  }
}
