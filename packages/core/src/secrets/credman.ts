import { spawnSync } from 'node:child_process';
import { SfError } from '../errors.js';
import { assertSecretName } from './store.js';

/**
 * Kho bí mật Windows (Credential Manager, D5 mục 5.4, FR-OP-07): credential kiểu generic tên
 * `StudioFlow Agent/<provider>` (069; trước đó `StudioFlow/<provider>`, đọc rồi chép sang). Gọi CredRead/CredWrite/CredDelete qua PowerShell (P/Invoke) — bí mật đi qua
 * stdin, không nằm trên dòng lệnh; giá trị trả về mã base64.
 */
const TYPE = String.raw`
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class SfCred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CredRead(string t, int type, int flags, out IntPtr c);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CredWrite(ref CREDENTIAL c, int flags);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CredDelete(string t, int type, int flags);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr c);
  public static string Read(string t) { IntPtr p; if (!CredRead(t, 1, 0, out p)) return null;
    var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    var b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p);
    return Convert.ToBase64String(b); }
  public static bool Write(string t, string u, byte[] b) { var c = new CREDENTIAL(); c.Type = 1; c.TargetName = t; c.UserName = u;
    c.Persist = 2; c.CredentialBlobSize = b.Length; c.CredentialBlob = Marshal.AllocHGlobal(b.Length);
    Marshal.Copy(b, 0, c.CredentialBlob, b.Length); var ok = CredWrite(ref c, 0); Marshal.FreeHGlobal(c.CredentialBlob); return ok; }
  public static bool Delete(string t) { return CredDelete(t, 1, 0); }
}
"@
`;

export const credTarget = (name: string) => {
  // tên đi vào script PowerShell → chỉ nhận ký tự an toàn (055)
  assertSecretName(name);
  return `StudioFlow Agent/${name}`;
};

/** Tên của bản trước 069 (`StudioFlow/<tên>`): chỉ đọc một lần rồi chép sang tên mới, không xóa. */
export const legacyCredTarget = (name: string) => {
  assertSecretName(name);
  return `StudioFlow/${name}`;
};

/** Đọc `credTarget`; chưa có → đọc tên cũ và chép sang tên mới (069). Trả base64 hoặc rỗng. */
const READ_FN = String.raw`
function SfRead($t, $old, $u) { $v = [SfCred]::Read($t); if (-not $v) { $v = [SfCred]::Read($old); if ($v) { [void][SfCred]::Write($t, $u, [Convert]::FromBase64String($v)) } }; $v }
`;
const readExpr = (name: string) =>
  `SfRead '${credTarget(name)}' '${legacyCredTarget(name)}' '${name}'`;

function ps(script: string, stdin = ''): string {
  if (process.platform !== 'win32')
    throw new SfError('E_PROVIDER_UNAVAILABLE', 'Credential Manager is only available on Windows');
  const encoded = Buffer.from(TYPE + READ_FN + script, 'utf16le').toString('base64');
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    {
      input: stdin,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
    },
  );
  if (r.status !== 0)
    throw new SfError(
      'E_PROVIDER_FAILED',
      `Credential Manager: ${(r.stderr || r.stdout).trim().slice(0, 300)}`,
    );
  return r.stdout.trim();
}

const memo = new Map<string, string | undefined>();

export function secretGet(name: string): string | undefined {
  if (memo.has(name)) return memo.get(name);
  const b64 = ps(`$v = ${readExpr(name)}; if ($v) { $v }`);
  const v = b64 ? Buffer.from(b64, 'base64').toString('utf8') : undefined;
  memo.set(name, v);
  return v;
}

/**
 * 058: đọc nhiều bí mật trong **một** lần gọi PowerShell (mỗi lần ~0,5–1 s, chạy đồng bộ ở `main` — gọi lẻ
 * từng tên làm đứng giao diện khi mở Cài đặt / khởi động). Tên đã có trong bộ nhớ đệm không đọc lại.
 */
export function secretGetMany(names: string[]): Record<string, string | undefined> {
  const missing = [...new Set(names)].filter((n) => !memo.has(n));
  if (missing.length) {
    for (const n of missing)
      if (!/^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/.test(n))
        throw new SfError('E_SCHEMA_INVALID', `invalid secret name ${n}`);
    const out = ps(
      missing
        .map((n, i) => `$v = ${readExpr(n)}; '${i}=' + $(if ($v) { $v } else { '' })`)
        .join('; '),
    );
    const got = new Map<number, string>();
    for (const line of out.split('\n')) {
      const m = /^(\d+)=(.*)$/.exec(line.trim());
      if (m) got.set(Number(m[1]), m[2]!);
    }
    missing.forEach((n, i) => {
      const b64 = got.get(i);
      memo.set(n, b64 ? Buffer.from(b64, 'base64').toString('utf8') : undefined);
    });
  }
  return Object.fromEntries(names.map((n) => [n, memo.get(n)]));
}

/** Xóa bộ nhớ đệm (test). */
export function clearSecretMemo(): void {
  memo.clear();
}

export function secretSet(name: string, value: string): void {
  if (!value) throw new SfError('E_SCHEMA_INVALID', 'secret is empty');
  const out = ps(
    `$b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); if ([SfCred]::Write('${credTarget(name)}', '${(assertSecretName(name), name)}', $b)) { 'ok' } else { 'fail' }`,
    Buffer.from(value, 'utf8').toString('base64'),
  );
  if (out !== 'ok') throw new SfError('E_PROVIDER_FAILED', `could not store secret ${name}`);
  memo.set(name, value);
}

export function secretDelete(name: string): boolean {
  memo.delete(name);
  // xóa cả tên cũ, không thì lần đọc sau chép nó sang lại (069)
  return (
    ps(
      `$a = [SfCred]::Delete('${credTarget(name)}'); $b = [SfCred]::Delete('${legacyCredTarget(name)}'); if ($a -or $b) { 'ok' } else { 'none' }`,
    ) === 'ok'
  );
}

/** Chỉ 4 ký tự cuối (D10: UI không hiện khóa). */
export function secretHint(name: string): string | null {
  const v = secretGet(name);
  return v ? `…${v.slice(-4)}` : null;
}

/** Biến môi trường (dev/CI) trước, rồi Credential Manager. */
export function getSecretDefault(name: string): string | undefined {
  const env = (
    {
      openai: process.env.OPENAI_API_KEY,
      deepseek: process.env.DEEPSEEK_API_KEY,
      anthropic: process.env.SF_ANTHROPIC_API_KEY,
      dashscope_api_key: process.env.DASHSCOPE_API_KEY,
      youtube_api_key: process.env.YOUTUBE_API_KEY,
    } as Record<string, string | undefined>
  )[name];
  if (env) return env;
  // app desktop: `main` đọc Credential Manager và chuyển cho core (D5 mục 5.4)
  if (hostSecrets) return hostSecrets[name];
  if (process.platform !== 'win32' || process.env.SF_NO_CREDMAN === '1') return undefined;
  try {
    return secretGet(name);
  } catch {
    return undefined;
  }
}

let hostSecrets: Record<string, string> | undefined;

/** Core trong app desktop nhận bí mật từ `main` (không tự đọc Credential Manager). */
export function setHostSecrets(s: Record<string, string> | undefined): void {
  hostSecrets = s;
}
