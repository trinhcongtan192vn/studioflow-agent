// Semver range tối giản cho `app_api` (D13): >=, >, <=, <, =, ^, ~; khoảng trắng = AND; `||` = OR.

type V = [number, number, number];

function parse(v: string): V {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.trim());
  if (!m) throw new Error(`bad version "${v}"`);
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function cmp(a: V, b: V): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

function one(v: V, c: string): boolean {
  const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(c.trim());
  if (!m) return false;
  const [, op = '=', rest] = m;
  const t = parse(rest!);
  switch (op) {
    case '>=':
      return cmp(v, t) >= 0;
    case '<=':
      return cmp(v, t) <= 0;
    case '>':
      return cmp(v, t) > 0;
    case '<':
      return cmp(v, t) < 0;
    case '^':
      return cmp(v, t) >= 0 && (t[0] > 0 ? v[0] === t[0] : v[0] === 0 && v[1] === t[1]);
    case '~':
      return cmp(v, t) >= 0 && v[0] === t[0] && v[1] === t[1];
    default:
      return cmp(v, t) === 0;
  }
}

export function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  return range.split('||').some((alt) =>
    alt
      .trim()
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1')
      .split(/\s+/)
      .filter(Boolean)
      .every((c) => one(v, c)),
  );
}
