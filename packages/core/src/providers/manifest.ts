import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { EXTENSIONS_DIR } from '../agent/options.js';
import type { ProviderManifest } from '../contracts/types.js';
import { validateValue } from '../domain/validate.js';
import { SfError } from '../errors.js';

/** Đọc + kiểm `extensions/providers/<id>/provider.yaml` (D4 mục 4.1). */
export function loadProviderManifest(
  id: string,
  dir = path.join(EXTENSIONS_DIR, 'providers'),
): ProviderManifest {
  const file = path.join(dir, id, 'provider.yaml');
  if (!existsSync(file))
    throw new SfError('E_PROVIDER_UNAVAILABLE', `provider manifest not found: ${file}`);
  const m = parse(readFileSync(file, 'utf8')) as ProviderManifest;
  const errors = validateValue('ProviderManifest', m);
  if (errors.length)
    throw new SfError('E_SCHEMA_INVALID', `${file}: ${errors[0]!.message}`, errors);
  return m;
}
