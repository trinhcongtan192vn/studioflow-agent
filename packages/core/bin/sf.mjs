#!/usr/bin/env node
// Vỏ mỏng: mọi logic ở dist/cli/main.js (constitution Điều II).
// node:sqlite còn ExperimentalWarning; stderr của CLI chỉ dành cho JSON lỗi (D4 mục 12).
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (String(warning).includes('SQLite')) return;
  return emitWarning.call(process, warning, ...rest);
};
const { main } = await import('../dist/cli/main.js');

process.exitCode = await main(process.argv.slice(2));
