import type { Msg } from '../shared/protocol';
import { Link } from './link';

const MAX_TO_EXT = 1024 * 1024;
const CHUNK = 256 * 1024;

/**
 * Native messaging host, launched by the browser extension. Relays between the
 * extension (length-prefixed JSON on stdio) and the hub (in-process or over WebSocket).
 */
export function runNative() {
  const link = new Link('browser', 'browser');

  const write = (m: Msg, json = JSON.stringify(m)) => {
    const body = Buffer.from(json);
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length);
    process.stdout.write(Buffer.concat([head, body]));
  };

  let buf = Buffer.alloc(0);
  process.stdin.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      const raw = buf.subarray(4, 4 + len).toString('utf8');
      buf = buf.subarray(4 + len);
      let m: Msg;
      try {
        m = JSON.parse(raw);
      } catch {
        continue;
      }
      if (m.t === 'hello') link.setName(m.name);
      else link.send(m);
    }
  });
  // Browser closed the port (extension reloaded or browser quit).
  process.stdin.on('end', () => process.exit(0));

  link.on('msg', (m: Msg) => {
    if (m.t === 'ping') return;
    const json = JSON.stringify(m);
    if (m.t !== 'call' || Buffer.byteLength(json) <= MAX_TO_EXT) return write(m, json);
    const n = Math.ceil(json.length / CHUNK);
    for (let i = 0; i < n; i++) write({ t: 'chunk', id: m.id, i, n, data: json.slice(i * CHUNK, (i + 1) * CHUNK) });
  });
  link.on('up', () => write({ t: 'link', up: true }));
  link.on('down', () => write({ t: 'link', up: false }));
  link.start();
}
