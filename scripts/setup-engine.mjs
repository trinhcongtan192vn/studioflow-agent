#!/usr/bin/env node
// 006 FR-010, 010 FR-008 — cài engine cho dev. Trình cài chính thức (tiến độ, hồ sơ) là 014.
//   node scripts/setup-engine.mjs omnivoice   (môi trường Python + torch cu128 + omnivoice)
//   node scripts/setup-engine.mjs asr         (whisper.cpp dựng sẵn + model large-v3-turbo)
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  linkSync,
  mkdirSync,
  renameSync,
} from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const PY_ENGINES = {
  omnivoice: {
    python: '3.12',
    steps: [
      [
        'torch==2.8.0+cu128',
        'torchaudio==2.8.0+cu128',
        '--extra-index-url',
        'https://download.pytorch.org/whl/cu128',
        '--index-strategy',
        'unsafe-best-match',
      ],
      ['omnivoice==0.2.1'],
    ],
  },
};

// whisper.cpp bản dựng sẵn cho Windows x64 (010 R1); model đa ngôn ngữ cho tiếng Việt.
const WHISPER = {
  release: 'b5130',
  zips: { cuda: 'whisper-cublas-12.4.0-bin-x64.zip', cpu: 'whisper-bin-x64.zip' },
  model: 'large-v3-turbo',
};

const engine = process.argv[2];
const appData = process.env.SF_APP_DATA ?? path.join(process.env.APPDATA, 'StudioFlow');

async function download(url, dest) {
  if (existsSync(dest)) return;
  console.log(`> download ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  mkdirSync(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${dest}.part`));
  renameSync(`${dest}.part`, dest);
}

async function setupAsr() {
  const dir = path.join(appData, 'providers', 'whisper');
  for (const [kind, zip] of Object.entries(WHISPER.zips)) {
    const exe = path.join(dir, kind, 'Release', 'whisper-cli.exe');
    if (existsSync(exe)) continue;
    const file = path.join(dir, zip);
    await download(
      `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER.release}/${zip}`,
      file,
    );
    mkdirSync(path.join(dir, kind), { recursive: true });
    const r = spawnSync('tar', ['-xf', file, '-C', path.join(dir, kind)], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  const model = path.join(dir, 'models', `ggml-${WHISPER.model}.bin`);
  await download(
    `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER.model}.bin`,
    model,
  );
  // hyperframes đọc model ở <home>/.cache/hyperframes/whisper/models; provider chạy với home riêng
  const hf = path.join(
    dir,
    'home',
    '.cache',
    'hyperframes',
    'whisper',
    'models',
    path.basename(model),
  );
  if (!existsSync(hf)) {
    mkdirSync(path.dirname(hf), { recursive: true });
    try {
      linkSync(model, hf);
    } catch {
      copyFileSync(model, hf);
    }
  }
  console.log(`engine asr ready: ${dir}`);
}

function setupPython(spec) {
  const env = path.join(appData, 'providers', 'python', engine);
  const py = path.join(env, 'Scripts', 'python.exe');
  const run = (args) => {
    console.log(`> uv ${args.join(' ')}`);
    const r = spawnSync('uv', args, { stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  };
  if (!existsSync(py)) run(['venv', env, '--python', spec.python]);
  for (const pkgs of spec.steps) run(['pip', 'install', '--python', py, ...pkgs]);
  run(['pip', 'freeze', '--python', py]);
  console.log(`engine ${engine} ready: ${py}`);
}

if (engine === 'asr') await setupAsr();
else if (PY_ENGINES[engine]) setupPython(PY_ENGINES[engine]);
else {
  console.error(`usage: setup-engine.mjs <${[...Object.keys(PY_ENGINES), 'asr'].join('|')}>`);
  process.exit(2);
}
