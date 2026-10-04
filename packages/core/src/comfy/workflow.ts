import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SfError } from '../errors.js';

/** Workflow ComfyUI dạng API: `{ <node id>: { class_type, inputs } }`. */
export type ComfyWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export type WorkflowVars = Record<string, string | number | boolean>;

/** `workflows/<mode>.json` của gói provider (D4 mục 9.2). */
export function loadWorkflow(packDir: string, mode: string): ComfyWorkflow {
  return JSON.parse(
    readFileSync(path.join(packDir, 'workflows', `${mode}.json`), 'utf8'),
  ) as ComfyWorkflow;
}

const WHOLE = /^\{\{(\w+)\}\}$/;
const EMBEDDED = /\{\{(\w+)\}\}/g;

/**
 * Thay chỗ trống (018 research R5): chuỗi chỉ gồm `{{k}}` → giá trị đúng kiểu (số giữ là số); chỗ
 * trống nằm trong chuỗi dài hơn → thay bằng văn bản. Thiếu biến → `E_SCHEMA_INVALID`.
 */
export function fillWorkflow(wf: ComfyWorkflow, vars: WorkflowVars): ComfyWorkflow {
  const get = (k: string) => {
    if (!(k in vars))
      throw new SfError('E_SCHEMA_INVALID', `workflow placeholder {{${k}}} has no value`);
    return vars[k]!;
  };
  const fill = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const whole = WHOLE.exec(v);
      if (whole) return get(whole[1]!);
      return v.replace(EMBEDDED, (_, k: string) => String(get(k)));
    }
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  return fill(wf) as ComfyWorkflow;
}

const clone = (wf: ComfyWorkflow): ComfyWorkflow => JSON.parse(JSON.stringify(wf)) as ComfyWorkflow;

function nodeOf(wf: ComfyWorkflow, classType: string): [string, ComfyWorkflow[string]] | undefined {
  return Object.entries(wf).find(([, n]) => n.class_type === classType);
}

function freeId(wf: ComfyWorkflow): string {
  let i = Math.max(0, ...Object.keys(wf).map(Number).filter(Number.isFinite)) + 1;
  while (String(i) in wf) i++;
  return String(i);
}

/**
 * Ảnh tham chiếu (Ref2Image / edit): mỗi ảnh một `LoadImage`, nối vào nhóm autogrow `images.image_N`
 * của node mã hóa (bắt đầu ở chỗ trống tiếp theo); node mã hóa cần VAE để ghép latent tham chiếu.
 */
export function attachImages(
  wf: ComfyWorkflow,
  names: string[],
  opts: { encoder?: string } = {},
): ComfyWorkflow {
  const out = clone(wf);
  if (names.length === 0) return out;
  const enc = nodeOf(out, opts.encoder ?? 'TextEncodeQwenImage21');
  if (!enc)
    throw new SfError('E_PROVIDER_FAILED', 'workflow has no encoder node for reference images');
  const [, encNode] = enc;
  let slot = 1;
  while (`images.image_${slot}` in encNode.inputs) slot++;
  for (const name of names) {
    const id = freeId(out);
    out[id] = { class_type: 'LoadImage', inputs: { image: name } };
    encNode.inputs[`images.image_${slot++}`] = [id, 0];
  }
  if (!encNode.inputs.vae) {
    const vae = nodeOf(out, 'VAELoader');
    if (vae) encNode.inputs.vae = [vae[0], 0];
  }
  return out;
}

/** Giữ alpha: `SaveImage` lấy thẳng đầu ra giải mã thay vì qua `SplitImageWithAlpha`. */
export function keepAlpha(wf: ComfyWorkflow): ComfyWorkflow {
  const out = clone(wf);
  const split = nodeOf(out, 'SplitImageWithAlpha');
  const save = nodeOf(out, 'SaveImage');
  if (!split || !save) return out;
  save[1].inputs.images = split[1].inputs.image;
  delete out[split[0]];
  return out;
}
