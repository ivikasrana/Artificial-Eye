import { collect } from './read';

let seq = 0;
const refOfEl = new WeakMap<Element, string>();
const elOfRef = new Map<string, WeakRef<Element>>();

export function refOf(el: Element) {
  let r = refOfEl.get(el);
  if (!r) {
    r = 'e' + ++seq;
    refOfEl.set(el, r);
    elOfRef.set(r, new WeakRef(el));
    if (seq % 5000 === 0) pruneRefs();
  } else if (!elOfRef.has(r)) elOfRef.set(r, new WeakRef(el));
  return r;
}

function pruneRefs() {
  for (const [r, w] of elOfRef) {
    if (w.deref()?.isConnected) continue;
    elOfRef.delete(r);
    lineOfRef.delete(r);
  }
}

export function byRef(ref: string): Element {
  const el = elOfRef.get(String(ref))?.deref();
  if (!el || !el.isConnected) throw new Error(goneMessage(String(ref)));
  return el;
}

const lineOfRef = new Map<string, string>();

export function remember(ref: string, line: string) {
  lineOfRef.set(ref, line);
  return line;
}

function goneMessage(ref: string) {
  const old = lineOfRef.get(ref);
  if (!old) return `ref ${ref} not found; page changed, read again`;
  const body = old.slice(ref.length);
  const hits = collect(document.body, false).filter((e) => e.ref && e.line.slice(e.ref.length) === body);
  const now = hits.length === 1 ? hits[0] : undefined;
  return now ? `ref ${ref} is gone; same element is now ${now.ref}` : `ref ${ref} (${body.trim()}) is gone; read again`;
}
