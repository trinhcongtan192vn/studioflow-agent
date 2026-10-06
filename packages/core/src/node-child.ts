/**
 * Môi trường cho tiến trình con chạy bằng `process.execPath` (HyperFrames, `sf`). Trong app, core là
 * utilityProcess của Electron nên `execPath` là electron.exe; thiếu `ELECTRON_RUN_AS_NODE` thì
 * electron.exe coi script là một ứng dụng: không tự thoát, worker con treo (037, quan sát 2026-10-06:
 * `hyperframes check` 44 s ngoài app nhưng > 23 phút trong app).
 */
export function nodeChildEnv(
  env: NodeJS.ProcessEnv | Record<string, string> = process.env,
  inElectron = Boolean(process.versions.electron),
): NodeJS.ProcessEnv {
  return inElectron ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : { ...env };
}
