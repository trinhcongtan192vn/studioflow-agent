// ComfyUI giả lập cho test 018 (HTTP + WebSocket tối giản). Chạy như "python main.py --port N …".
// FAKE_COMFY_JOB_MS: thời gian mỗi job · FAKE_COMFY_HEALTH_FAIL_AFTER: sau N lần /system_stats thì trả 500
// FAKE_COMFY_LOG: file ghi lại các yêu cầu (một JSON mỗi dòng).
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]);
const jobMs = Number(process.env.FAKE_COMFY_JOB_MS ?? 300);
const failAfter = Number(process.env.FAKE_COMFY_HEALTH_FAIL_AFTER ?? 0);
const log = (o) =>
  process.env.FAKE_COMFY_LOG &&
  appendFileSync(process.env.FAKE_COMFY_LOG, `${JSON.stringify(o)}\n`);

// PNG 1×1 RGB hợp lệ (màu theo seed) — đủ cho imageInfo
function png(seed) {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, seed % 256, 80, 160]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let stats = 0;
let vram = 1.2e9;
const history = new Map();
const running = new Map();
const sockets = new Set();

function wsSend(obj) {
  const data = Buffer.from(JSON.stringify(obj));
  const head =
    data.length < 126
      ? Buffer.from([0x81, data.length])
      : Buffer.from([0x81, 126, data.length >> 8, data.length & 255]);
  for (const s of sockets) s.write(Buffer.concat([head, data]));
}

function body(req) {
  return new Promise((res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => res(Buffer.concat(chunks)));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const json = (code, o) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(o));
  };
  if (url.pathname === '/system_stats') {
    stats++;
    if (failAfter && stats > failAfter) return json(500, { error: 'sick' });
    return json(200, {
      system: { comfyui_version: 'fake' },
      devices: [{ vram_total: 16e9, vram_free: 16e9 - vram }],
    });
  }
  if (url.pathname === '/prompt' && req.method === 'POST') {
    const b = JSON.parse((await body(req)).toString());
    const id = createHash('sha1')
      .update(JSON.stringify(b.prompt) + Math.random())
      .digest('hex')
      .slice(0, 12);
    log({ path: '/prompt', id, prompt: b.prompt });
    const bad = Object.values(b.prompt).find((n) => n.class_type === 'Broken');
    if (bad)
      return json(400, {
        error: { message: 'Prompt outputs failed validation' },
        node_errors: { x: { errors: [{ message: 'bad node' }] } },
      });
    const seed = Number(
      Object.values(b.prompt).find((n) => n.class_type === 'KSampler')?.inputs.seed ?? 0,
    );
    vram = 12.9e9;
    const steps = 5;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      wsSend({ type: 'progress', data: { value: i, max: steps, prompt_id: id } });
      if (i >= steps) {
        clearInterval(timer);
        running.delete(id);
        history.set(id, {
          status: { status_str: 'success', completed: true },
          outputs: {
            8: { images: [{ filename: `sf_${id}.png`, subfolder: '', type: 'output', seed }] },
          },
        });
      }
    }, jobMs / steps);
    running.set(id, timer);
    return json(200, { prompt_id: id, number: 1 });
  }
  if (url.pathname.startsWith('/history/')) {
    const id = url.pathname.split('/')[2];
    return json(200, history.has(id) ? { [id]: history.get(id) } : {});
  }
  if (url.pathname === '/view') {
    const f = url.searchParams.get('filename');
    const id = f.slice(3, -4);
    const seed = history.get(id)?.outputs[8].images[0].seed ?? 0;
    res.writeHead(200, { 'content-type': 'image/png' });
    return res.end(png(seed));
  }
  if (url.pathname === '/upload/image' && req.method === 'POST') {
    const b = await body(req);
    const name = /filename="([^"]+)"/.exec(b.toString('latin1'))?.[1] ?? 'up.png';
    log({ path: '/upload/image', name });
    return json(200, { name, subfolder: '', type: 'input' });
  }
  if (url.pathname === '/interrupt' && req.method === 'POST') {
    const b = JSON.parse((await body(req)).toString() || '{}');
    log({ path: '/interrupt', ...b });
    for (const [id, t] of running) {
      if (!b.prompt_id || b.prompt_id === id) {
        clearInterval(t);
        running.delete(id);
        history.set(id, {
          status: {
            status_str: 'error',
            completed: false,
            messages: [['execution_interrupted', {}]],
          },
          outputs: {},
        });
      }
    }
    return json(200, {});
  }
  if (url.pathname === '/queue' && req.method === 'POST') {
    log({ path: '/queue', ...JSON.parse((await body(req)).toString() || '{}') });
    return json(200, {});
  }
  if (url.pathname === '/free' && req.method === 'POST') {
    log({ path: '/free', ...JSON.parse((await body(req)).toString() || '{}') });
    vram = 1.25e9;
    return json(200, {});
  }
  json(404, { error: 'not found' });
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const accept = createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => sockets.delete(socket));
  socket.on('data', () => {});
});

server.listen(port, '127.0.0.1', () =>
  console.log(`To see the GUI go to: http://127.0.0.1:${port}`),
);
