import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Thư mục gói mở rộng đi kèm app (D3 mục 1); `SF_EXTENSIONS_DIR` ghi đè khi đóng gói. */
export const EXTENSIONS_DIR =
  process.env.SF_EXTENSIONS_DIR ?? path.resolve(here, '..', '..', '..', 'extensions');
