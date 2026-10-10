import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import { schemas, type SchemaRoot } from '../contracts/schemas.js';
import { isSfError } from '../errors.js';
import { artifactSpec, type ArtifactKind } from './artifacts.js';
import { parseBlocksDoc } from './markdown/blocks.js';
import { parseScript, toScriptDoc } from './markdown/script.js';
import { parseStoryboard, toStoryboardDoc } from './markdown/storyboard.js';

export interface ValidationError {
  code: 'E_SCHEMA_INVALID' | 'E_PARSE_MARKER' | 'E_ID_DUPLICATE' | 'E_ID_UNKNOWN';
  path: string;
  message: string;
  line?: number;
}

export interface ValidationResult {
  valid: boolean;
  kind?: ArtifactKind;
  errors: ValidationError[];
}

const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;
const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
const compiled = new Map<SchemaRoot, ValidateFunction>();

function validator(root: SchemaRoot): ValidateFunction {
  let v = compiled.get(root);
  if (!v) {
    v = ajv.compile(schemas[root] as object);
    compiled.set(root, v);
  }
  return v;
}

/** Gợi ý sửa cho lỗi agent hay mắc (thông báo lỗi là thứ agent đọc để tự sửa). */
const HINTS: Record<string, string> = {
  '/source_video_id':
    'source_video_id is only the channel video id (vd_…) a short is cut from; otherwise null. Put a YouTube reference URL/id in the brief body or REFERENCE.md.',
};

function ajvErrors(errors: ErrorObject[] | null | undefined): ValidationError[] {
  return (errors ?? []).map((e) => ({
    code: 'E_SCHEMA_INVALID',
    path: e.instancePath || '/',
    message: `${e.instancePath || '/'} ${e.message ?? 'invalid'}${
      e.params && 'allowedValues' in e.params
        ? ` (${(e.params.allowedValues as unknown[]).join(', ')})`
        : ''
    }${e.params && 'additionalProperty' in e.params ? ` (${String(e.params.additionalProperty)})` : ''}${
      HINTS[e.instancePath] ? ` — ${HINTS[e.instancePath]}` : ''
    }`,
  }));
}

/** Kiểm một giá trị với schema gốc trong `docs/contracts`. */
export function validateValue(root: SchemaRoot, value: unknown): ValidationError[] {
  const v = validator(root);
  return v(value) ? [] : ajvErrors(v.errors);
}

/** Dựng giá trị để kiểm schema từ nội dung Markdown theo loại. */
export function markdownValue(kind: ArtifactKind, content: string): unknown {
  switch (kind) {
    case 'script':
      return toScriptDoc(parseScript(content), { loose: true });
    case 'storyboard':
      return toStoryboardDoc(parseStoryboard(content), { loose: true });
    case 'cast': {
      const d = parseBlocksDoc(content);
      const block = d.blocks.find((b) => b.tag === 'sf-cast');
      return { front: d.front, cast: block?.data ?? [] };
    }
    case 'story': {
      const d = parseBlocksDoc(content);
      return {
        front: d.front,
        scenes: d.blocks.filter((b) => b.tag === 'sf-story').map((b) => b.data),
      };
    }
    default:
      return parseBlocksDoc(content).front;
  }
}

/** `artifact.validate` (D4 mục 2.4): loại theo đường dẫn, parse, kiểm schema. */
export function validateArtifact(p: string, content: string): ValidationResult {
  const spec = artifactSpec(p);
  if (!spec)
    return {
      valid: false,
      errors: [{ code: 'E_SCHEMA_INVALID', path: '/', message: `no schema for ${p}` }],
    };
  let value: unknown;
  try {
    value = spec.format === 'json' ? JSON.parse(content) : markdownValue(spec.kind, content);
  } catch (e) {
    if (isSfError(e) && e.code === 'E_PARSE_MARKER') {
      const line = (e.details as { line?: number } | undefined)?.line;
      return {
        valid: false,
        kind: spec.kind,
        errors: [{ code: 'E_PARSE_MARKER', path: '/', message: e.message, line }],
      };
    }
    return {
      valid: false,
      kind: spec.kind,
      errors: [{ code: 'E_SCHEMA_INVALID', path: '/', message: (e as Error).message }],
    };
  }
  const errors = validateValue(spec.schema, value);
  return { valid: errors.length === 0, kind: spec.kind, errors };
}
