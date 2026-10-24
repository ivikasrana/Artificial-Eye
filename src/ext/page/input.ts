import { type KeySpec } from '../../shared/keys';
import { sleep, type Pt } from '../env';
import { byRef } from './refs';
import { deepAt, locate } from './geometry';

function activeEl(): HTMLElement | null {
  let a = document.activeElement as HTMLElement | null;
  for (;;) {
    if (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement as HTMLElement;
    else if (a?.localName === 'iframe') {
      try {
        const inner = (a as HTMLIFrameElement).contentDocument?.activeElement as HTMLElement | null;
        if (!inner || inner === a) break;
        a = inner;
      } catch {
        break;
      }
    } else break;
  }
  return a;
}

function isTextField(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  return el.localName === 'textarea' || (el.localName === 'input' && !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image', 'range', 'color'].includes((el as HTMLInputElement).type));
}

export function focusRef(ref: string, forText = false): { click?: Pt } {
  const el = byRef(ref) as HTMLElement;
  if (forText && (el.localName === 'select' || (el.localName === 'input' && !isTextField(el))))
    throw new Error(`${ref} does not accept text; use a=fill or a=click`);
  if (isTextField(el)) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    el.focus();
    try {
      const n = el.value.length;
      el.setSelectionRange(n, n);
    } catch {
      /* email/number inputs reject selection */
    }
    return {};
  }
  return { click: locate(ref) };
}

function fire(el: Element, type: string, init: MouseEventInit, C: typeof MouseEvent = MouseEvent) {
  return el.dispatchEvent(new C(type, { bubbles: true, cancelable: true, composed: true, view: window, ...init }));
}

export function mouse(kind: string, ref: string | undefined, x: number, y: number) {
  const el = ref ? byRef(ref) : deepAt(x, y);
  if (!el) throw new Error('Nothing at that point');
  const right = kind === 'rclick';
  const o: PointerEventInit = { clientX: x, clientY: y, button: right ? 2 : 0, buttons: right ? 2 : 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  fire(el, 'pointerover', o, PointerEvent);
  fire(el, 'mouseover', o);
  fire(el, 'pointermove', o, PointerEvent);
  fire(el, 'mousemove', o);
  if (kind === 'hover') return 'ok';
  const press = () => {
    fire(el, 'pointerdown', o, PointerEvent);
    fire(el, 'mousedown', o);
    (el as HTMLElement).focus?.({ preventScroll: true });
    fire(el, 'pointerup', { ...o, buttons: 0 }, PointerEvent);
    fire(el, 'mouseup', { ...o, buttons: 0 });
    if (!right) fire(el, 'click', { ...o, buttons: 0, detail: 1 });
  };
  press();
  if (kind === 'dblclick') {
    press();
    fire(el, 'dblclick', { ...o, detail: 2 });
  }
  if (right) fire(el, 'contextmenu', o);
  return 'ok';
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, v: string) {
  const view = el.ownerDocument.defaultView as any;
  const proto =
    el.localName === 'textarea'
      ? view.HTMLTextAreaElement.prototype
      : el.localName === 'select'
        ? view.HTMLSelectElement.prototype
        : view.HTMLInputElement.prototype;
  // The prototype setter bypasses framework value trackers so React & co see the change.
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function typeText(text: string) {
  const el = activeEl();
  if (!el || el === document.body) throw new Error('No focused field; pass ref');
  if (!el.ownerDocument.execCommand('insertText', false, text)) {
    if (isTextField(el)) setValue(el, el.value + text);
    else throw new Error('Focused element does not accept text');
  }
  return 'ok';
}

export function pressKeys(keys: KeySpec[]) {
  for (const k of keys) {
    const el = activeEl() ?? document.body;
    const init: KeyboardEventInit & { keyCode: number; which: number } = {
      key: k.key,
      code: k.code,
      keyCode: k.vk,
      which: k.vk,
      altKey: !!(k.mods & 1),
      ctrlKey: !!(k.mods & 2),
      metaKey: !!(k.mods & 4),
      shiftKey: !!(k.mods & 8),
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    if (el.dispatchEvent(new KeyboardEvent('keydown', init))) defaultKey(el, k, init);
    el.dispatchEvent(new KeyboardEvent('keyup', init));
  }
  return 'ok';
}

/** Synthetic key events have no default action, so emulate the common ones. */
function defaultKey(el: HTMLElement, k: KeySpec, init: KeyboardEventInit) {
  const doc = el.ownerDocument;
  const cmd = (k.mods & 6) !== 0;
  if (k.text && k.key !== 'Enter') {
    if (el.dispatchEvent(new KeyboardEvent('keypress', init))) doc.execCommand('insertText', false, k.text);
    return;
  }
  switch (k.key) {
    case 'Enter':
      if (el.localName === 'textarea' || el.isContentEditable) doc.execCommand('insertText', false, '\n');
      else if ((el as HTMLInputElement).form) (el as HTMLInputElement).form!.requestSubmit();
      else if (el.localName === 'a' || el.localName === 'button') el.click();
      break;
    case 'Tab':
      moveFocus(k.mods & 8 ? -1 : 1);
      break;
    case 'Backspace':
      doc.execCommand('delete');
      break;
    case 'Delete':
      doc.execCommand('forwardDelete');
      break;
    case 'a':
    case 'A':
      if (cmd) isTextField(el) ? el.select() : doc.execCommand('selectAll');
      break;
  }
}

function moveFocus(dir: number) {
  const all = [...document.querySelectorAll<HTMLElement>(
    'a[href],button,input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"]),[contenteditable=""],[contenteditable=true]',
  )].filter((e) => !(e as HTMLButtonElement).disabled && e.getClientRects().length);
  const i = all.indexOf(activeEl() as HTMLElement);
  all[(i + dir + all.length) % all.length]?.focus();
}

export function fill(fields: Record<string, unknown>) {
  if (!fields || typeof fields !== 'object') throw new Error('fill needs fields: {ref: value}');
  const bad: string[] = [];
  let n = 0;
  for (const [ref, val] of Object.entries(fields)) {
    try {
      let el = byRef(ref) as HTMLElement;
      if (el.localName === 'label' && (el as HTMLLabelElement).control) el = (el as HTMLLabelElement).control!;
      if (el.localName === 'select') {
        const sel = el as HTMLSelectElement;
        const wants = (Array.isArray(val) ? val : [val]).map((v) => String(v).toLowerCase().trim());
        const opts = [...sel.options];
        const pick = (w: string) =>
          opts.find((o) => o.value.toLowerCase() === w) ??
          opts.find((o) => o.text.toLowerCase().trim() === w) ??
          opts.find((o) => o.text.toLowerCase().includes(w));
        const chosen = wants.map(pick);
        if (chosen.some((o) => !o)) throw new Error(`no option "${wants.join(',')}"`);
        if (sel.multiple) opts.forEach((o) => (o.selected = chosen.includes(o)));
        else setValue(sel, chosen[0]!.value);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      } else if ((el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio') {
        const want = val === true || ['true', 'on', '1', 'yes'].includes(String(val).toLowerCase());
        if ((el as HTMLInputElement).checked !== want) el.click();
      } else if (isTextField(el)) {
        el.focus();
        setValue(el, String(val));
      } else if (el.isContentEditable) {
        el.focus();
        el.ownerDocument.execCommand('selectAll');
        el.ownerDocument.execCommand('insertText', false, String(val));
      } else throw new Error(`not a form field (${el.localName})`);
      n++;
    } catch (e) {
      bad.push(`${ref}: ${(e as Error).message}`);
    }
  }
  return `filled ${n}` + (bad.length ? `; failed ${bad.join('; ')}` : '');
}

function scrollables(el: Element | null): Element[] {
  const out: Element[] = [];
  for (let e: any = el; e && e !== document.documentElement; e = e.parentElement ?? e.parentNode?.host) {
    const s = getComputedStyle(e);
    if (/(auto|scroll|overlay)/.test(s.overflowY + s.overflowX) && (e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2))
      out.push(e);
  }
  return out;
}

type ScrollMark = { boxes: Element[]; pos: number[] };
let scrollMark: ScrollMark | null = null;

const boxPos = (b: Element[]) => b.flatMap((e) => [e.scrollLeft, e.scrollTop]).concat(scrollX, scrollY);
const winText = () => `y=${Math.round(scrollY)}/${Math.max(0, document.documentElement.scrollHeight - innerHeight)}`;
const boxText = (e: Element) => `box y=${Math.round(e.scrollTop)}/${e.scrollHeight - e.clientHeight}`;

export function scrollStart(m: { at?: Pt | null; dx?: number; dy?: number }) {
  const dx = Number(m.dx) || 0;
  const dy = m.dy != null ? Number(m.dy) : dx ? 0 : Math.round(innerHeight * 0.8);
  const at = m.at ?? { x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) };
  const boxes = scrollables(deepAt(at.x, at.y));
  scrollMark = { boxes, pos: boxPos(boxes) };
  return { x: at.x, y: at.y, dx, dy };
}

export async function scrollEnd() {
  const mark = scrollMark;
  scrollMark = null;
  if (!mark) return winText();
  const start = mark.pos.join();
  let pos = mark.pos;
  let last = '';
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    pos = boxPos(mark.boxes);
    const now = pos.join();
    if (now === last && now !== start) break;
    last = now;
    await sleep(25);
  }
  const moved = mark.boxes.find((_, i) => pos[i * 2] !== mark.pos[i * 2] || pos[i * 2 + 1] !== mark.pos[i * 2 + 1]);
  if (moved) return boxText(moved);
  if (pos.at(-2) !== mark.pos.at(-2) || pos.at(-1) !== mark.pos.at(-1)) return winText();
  return `nothing scrolled (at the end, or the page handles the wheel itself) ${winText()}`;
}

export function scroll(m: { ref?: string; x?: number; y?: number; dx: number; dy: number }) {
  if (m.ref) {
    const el = byRef(m.ref);
    el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    const box = scrollables(el.parentElement)[0];
    return box ? boxText(box) : winText();
  }
  const opt = { left: m.dx, top: m.dy, behavior: 'instant' as ScrollBehavior };
  for (const box of scrollMark?.boxes ?? []) {
    const before = box.scrollLeft + ',' + box.scrollTop;
    box.scrollBy(opt);
    if (box.scrollLeft + ',' + box.scrollTop !== before) return;
  }
  if (getComputedStyle(document.documentElement).overflowY !== 'hidden') scrollBy(opt);
}

export function drag(ref: string | undefined, from: Pt, to: Pt) {
  const src = ref ? byRef(ref) : deepAt(from.x, from.y);
  const dst = deepAt(to.x, to.y);
  if (!src || !dst) throw new Error('Nothing to drag at that point');
  const draggable = (src as HTMLElement).closest?.('[draggable="true"]');
  if (!draggable) return 'mouse';
  const dt = new DataTransfer();
  const ev = (type: string, p: Pt) =>
    new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: p.x, clientY: p.y });
  draggable.dispatchEvent(ev('dragstart', from));
  dst.dispatchEvent(ev('dragenter', to));
  dst.dispatchEvent(ev('dragover', to));
  dst.dispatchEvent(ev('drop', to));
  draggable.dispatchEvent(ev('dragend', to));
  return 'html5';
}

export async function mouseDrag(from: Pt, to: Pt) {
  const src = deepAt(from.x, from.y);
  if (!src) throw new Error('Nothing at drag start');
  const o = { button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  fire(src, 'pointerdown', { ...o, clientX: from.x, clientY: from.y }, PointerEvent);
  fire(src, 'mousedown', { ...o, clientX: from.x, clientY: from.y });
  for (let i = 1; i <= 10; i++) {
    const p = { clientX: from.x + ((to.x - from.x) * i) / 10, clientY: from.y + ((to.y - from.y) * i) / 10 };
    const el = deepAt(p.clientX, p.clientY) ?? src;
    fire(el, 'pointermove', { ...o, ...p }, PointerEvent);
    fire(el, 'mousemove', { ...o, ...p });
    await sleep(16);
  }
  const dst = deepAt(to.x, to.y) ?? src;
  fire(dst, 'pointerup', { ...o, buttons: 0, clientX: to.x, clientY: to.y }, PointerEvent);
  fire(dst, 'mouseup', { ...o, buttons: 0, clientX: to.x, clientY: to.y });
  return 'ok';
}

export function upload(ref: string, files: { name: string; mime: string; data: string }[]) {
  if (!ref) throw new Error('upload needs ref');
  const el = byRef(ref) as HTMLElement;
  const dt = new DataTransfer();
  for (const f of files) {
    const bin = atob(f.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    dt.items.add(new File([bytes], f.name, { type: f.mime }));
  }
  const input = (
    el.localName === 'input' && (el as HTMLInputElement).type === 'file'
      ? el
      : el.localName === 'label'
        ? (el as HTMLLabelElement).control
        : el.querySelector('input[type=file]')
  ) as HTMLInputElement | null;
  if (input) {
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return `uploaded ${files.length}`;
  }
  // No file input: treat the element as a drop zone.
  for (const type of ['dragenter', 'dragover', 'drop'])
    el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
  return `dropped ${files.length}`;
}

export async function waitFor(text: string, ms?: number) {
  const end = Date.now() + Math.min(Number(ms) || 10_000, 30_000);
  const css = text.startsWith('css:') ? text.slice(4) : null;
  const needle = text.toLowerCase();
  while (Date.now() < end) {
    if (css ? document.querySelector(css) : document.body?.innerText.toLowerCase().includes(needle)) return 'found';
    await sleep(200);
  }
  throw new Error(`Timed out waiting for "${text}"`);
}
