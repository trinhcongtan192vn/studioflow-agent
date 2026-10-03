import { spawnSync } from 'node:child_process';
import { SfError } from '../errors.js';

/**
 * Kho bí mật Windows (Credential Manager, D5 mục 5.4, FR-OP-07): credential kiểu generic tên
 * `StudioFlow/<provider>`. Gọi CredRead/CredWrite/CredDelete qua PowerShell (P/Invoke) — bí mật đi qua
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

export const credTarget = (name: string) => `StudioFlow/${name}`;

function ps(script: string, stdin = ''): string {
  if (process.platform !== 'win32')
    throw new SfError('E_PROVIDER_UNAVAILABLE', 'Credential Manager is only available on Windows');
  const encoded = Buffer.from(TYPE + script, 'utf16le').toString('base64');
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
  const b64 = ps(`$v = [SfCred]::Read('${credTarget(name)}'); if ($v) { $v }`);
  const v = b64 ? Buffer.from(b64, 'base64').toString('utf8') : undefined;
  memo.set(name, v);
  return v;
}

export function secretSet(name: string, value: string): void {
  if (!value) throw new SfError('E_SCHEMA_INVALID', 'secret is empty');
  const out = ps(
    `$b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); if ([SfCred]::Write('${credTarget(name)}', '${name}', $b)) { 'ok' } else { 'fail' }`,
    Buffer.from(value, 'utf8').toString('base64'),
  );
  if (out !== 'ok') throw new SfError('E_PROVIDER_FAILED', `could not store secret ${name}`);
  memo.set(name, value);
}

export function secretDelete(name: string): boolean {
  memo.delete(name);
  return ps(`if ([SfCred]::Delete('${credTarget(name)}')) { 'ok' } else { 'none' }`) === 'ok';
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
    } as Record<string, string | undefined>
  )[name];
  if (env) return env;
  if (process.platform !== 'win32' || process.env.SF_NO_CREDMAN === '1') return undefined;
  try {
    return secretGet(name);
  } catch {
    return undefined;
  }
}
