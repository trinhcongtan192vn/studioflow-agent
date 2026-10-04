/**
 * Đầu vào adapter ảnh (dạng nội bộ của `ImageGenerateInput`/`ImageEditInput`, D4 mục 3): asset đã
 * được đổi thành đường dẫn tương đối kênh + hash nội dung (hash vào khóa cache, đường dẫn thì không).
 */
export interface ImageFileRef {
  path: string;
  hash: string;
}

export interface ImageAdapterInput {
  kind: 'generate' | 'edit';
  prompt: string;
  negative_prompt?: string;
  /** generate: kích thước đã làm tròn; edit: theo ảnh nguồn. */
  width?: number;
  height?: number;
  transparent?: boolean;
  steps?: number;
  seed: number;
  source?: ImageFileRef;
  mask?: ImageFileRef;
  refs?: ImageFileRef[];
  /** edit trên ảnh có alpha → giữ alpha. */
  keep_alpha?: boolean;
}

export interface ImageAdapterOutput {
  file: string;
  width: number;
  height: number;
  alpha: boolean;
  seed: number;
}

export const imageCacheParts = (i: ImageAdapterInput) => ({
  kind: i.kind,
  prompt: i.prompt,
  negative_prompt: i.negative_prompt ?? '',
  width: i.width ?? null,
  height: i.height ?? null,
  transparent: Boolean(i.transparent),
  steps: i.steps ?? null,
  source: i.source?.hash ?? null,
  mask: i.mask?.hash ?? null,
  refs: (i.refs ?? []).map((r) => r.hash),
  keep_alpha: Boolean(i.keep_alpha),
});

export interface RemoveBgAdapterInput {
  source: ImageFileRef;
  subject: 'person' | 'object';
}
