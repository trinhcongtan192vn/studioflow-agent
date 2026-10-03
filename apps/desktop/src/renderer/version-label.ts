/** Chỉ định dạng hiển thị; giá trị phiên bản đến từ core qua IPC. */
export function versionLabel(v: { version: string }): string {
  return `core ${v.version}`;
}
