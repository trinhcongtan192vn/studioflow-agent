import { randomBytes } from 'node:crypto';

/** Tiền tố ID theo D3 mục 2. */
export const ID_PREFIXES = [
  'ch',
  'vd',
  'bt',
  'sc',
  'fr',
  'el',
  'ln',
  'cg',
  'ca',
  'vo',
  'as',
  'mt',
  'jb',
  'rd',
  'ap',
  'ss',
] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** `<tiền tố>_<8 ký tự [0-9a-z]>`, ngẫu nhiên mật mã; tránh các ID trong `taken`. */
export function newId(prefix: IdPrefix, taken?: ReadonlySet<string>): string {
  if (!(ID_PREFIXES as readonly string[]).includes(prefix)) {
    throw new Error(`unknown ID prefix "${prefix}"`);
  }
  for (;;) {
    // 36^8 ≈ 2.8e12; lấy mẫu loại bỏ để phân bố đều.
    let s = '';
    while (s.length < 8) {
      for (const b of randomBytes(16)) {
        if (b < 252 && s.length < 8) s += ALPHABET[b % 36];
      }
    }
    const id = `${prefix}_${s}`;
    if (!taken?.has(id)) return id;
  }
}

export function isId(prefix: IdPrefix, value: unknown): boolean {
  return typeof value === 'string' && new RegExp(`^${prefix}_[0-9a-z]{8}$`).test(value);
}
