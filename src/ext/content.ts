import { parseKeys } from '../shared/keys';
import { times } from './compact';
import { api, clip } from './env';
import { ensurePoint, locate, viewport } from './page/geometry';
import { glow, markAgent } from './page/glow';
import { drag, fill, focusRef, mouse, mouseDrag, pressKeys, scroll, scrollEnd, scrollStart, typeText, upload, waitFor } from './page/input';
import { notices, read } from './page/read';

declare global {
  interface Window {
    __bbCs?: boolean;
  }
}

if (!window.__bbCs) {
  window.__bbCs = true;
  init();
}

function init() {
  // ---------- console / error buffer fed by hook.js (main world)
  const logs: { kind: string; level: string; text: string; n: number; seq: number; first: number }[] = [];
  const doc = Math.random().toString(36).slice(2);
  const MAX_NOTICES = 50;
  let logSeq = 0;
  window.addEventListener('__bb_log', (e) => {
    try {
      const d = JSON.parse((e as CustomEvent).detail);
      const last = logs.at(-1);
      logSeq++;
      if (last && last.text === d.text && last.level === d.level) {
        last.n++;
        last.seq = logSeq;
      } else {
        logs.push({ ...d, n: 1, seq: logSeq, first: logSeq });
        if (logs.length > 500) logs.shift();
      }
    } catch {
      /* ignore */
    }
  });

  api.runtime.onMessage.addListener((m: any, _s, reply) => {
    Promise.resolve()
      .then(() => handle(m))
      .then(
        (value) => reply({ value }),
        (e) => reply({ error: String(e?.message ?? e) }),
      );
    return true;
  });

  // Re-arm agent mode after the agent's tab navigates.
  api.runtime
    .sendMessage({ t: 'isAgent' })
    .then((on: boolean) => on && markAgent())
    .catch(() => {});

  async function handle(m: any): Promise<unknown> {
    if (m.op !== 'viewport' && m.op !== 'logs') markAgent();
    switch (m.op) {
      case 'read':
        return read(m);
      case 'locate':
        return locate(m.ref);
      case 'ensurePoint':
        return ensurePoint(m);
      case 'focus':
        return focusRef(m.ref);
      case 'mouse':
        return mouse(m.kind, m.ref, m.x, m.y);
      case 'type':
        return typeText(m.text);
      case 'key':
        return pressKeys(parseKeys(m.text));
      case 'fill':
        return fill(m.fields);
      case 'scroll':
        return scroll(m);
      case 'scrollStart':
        return scrollStart(m);
      case 'scrollEnd':
        return scrollEnd();
      case 'drag':
        return drag(m.ref, m.from, m.to);
      case 'mouseDrag':
        return mouseDrag(m.from, m.to);
      case 'upload':
        return upload(m.ref, m.files);
      case 'wait':
        return waitFor(m.text, m.ms);
      case 'viewport':
        return viewport(m.ref);
      case 'glow':
        return glow(true);
      case 'logs':
        return readLogs(m);
      case 'mark':
        return { doc, seq: logSeq, n: logs.at(-1)?.n ?? 0, notes: notices(MAX_NOTICES) };
      case 'since':
        return since(m.mark);
    }
    throw new Error(`unknown op ${m.op}`);
  }

  function since(mark: { doc: string; seq: number; n: number; notes: string[] }) {
    const same = mark.doc === doc;
    const from = same ? mark.seq : 0;
    const errors = logs
      .filter((l) => l.seq > from && (l.level === 'error' || l.level === 'dialog'))
      .slice(-3)
      .map((l) => `[${l.level}] ${clip(l.text, 150)}${times(from && l.first <= from ? l.n - mark.n : l.n)}`);
    const before = new Set(same ? mark.notes : []);
    const notes = notices(MAX_NOTICES).filter((n) => !before.has(n)).slice(0, 3);
    return { errors, notes };
  }

  function readLogs(m: { kind: string; q?: string; n: number; clear?: boolean }) {
    let list = m.kind === 'errors' ? logs.filter((l) => l.kind === 'error' || l.level === 'error') : logs;
    if (m.q) list = list.filter((l) => l.text.includes(m.q!));
    const out = list.slice(-m.n).map((l) => `[${l.level}] ${l.text}${times(l.n)}`);
    if (m.clear) logs.length = 0;
    return out.join('\n');
  }
}
