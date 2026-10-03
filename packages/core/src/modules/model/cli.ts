import type { CliCommand } from '../../cli/types.js';
import { usageError } from '../../cli/errors.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import {
  installEntry,
  installPlan,
  loadCatalog,
  type InstallProfile,
} from '../../models/install.js';

const PROFILES = ['minimal', 'standard', 'full'];

/** `sf model list [--profile]`, `sf model install <key|--profile p>` (D4 mục 12, 014). */
export const commands: CliCommand[] = [
  {
    module: 'model',
    name: 'list',
    summary: 'Components of an install profile with status and bytes to download',
    options: { profile: { type: 'string' } },
    async run(input) {
      const profile = (input.profile as InstallProfile | undefined) ?? 'full';
      if (!PROFILES.includes(profile))
        throw usageError('--profile must be minimal, standard or full');
      return installPlan(defaultAppDataDir(), profile);
    },
  },
  {
    module: 'model',
    name: 'install',
    summary:
      'Download/install one component (or every missing one of --profile); resumes, checks sha256',
    options: { profile: { type: 'string' } },
    positionals: ['key'],
    async run(input) {
      const appDataDir = defaultAppDataDir();
      const profile = input.profile as InstallProfile | undefined;
      if (profile && !PROFILES.includes(profile))
        throw usageError('--profile must be minimal, standard or full');
      const keys = input.key
        ? [input.key as string]
        : profile
          ? installPlan(appDataDir, profile)
              .entries.filter((e) => e.status === 'missing' || e.status === 'partial')
              .map((e) => e.key)
          : undefined;
      if (!keys) throw usageError('give a component key or --profile');
      const catalog = loadCatalog();
      const done = [];
      for (const k of keys) {
        let last = -1;
        done.push(
          await installEntry(appDataDir, k, {
            catalog,
            ...(profile ? { profile } : {}),
            progress: (d, t, m) => {
              const pct = t ? Math.floor((d / t) * 100) : 0;
              if (pct !== last) process.stderr.write(`\r${k}: ${pct}% ${m ?? ''}   `);
              last = pct;
            },
          }),
        );
        process.stderr.write('\n');
      }
      return { installed: done };
    },
  },
];
