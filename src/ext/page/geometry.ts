import { clip, sleep } from '../env';
import { q } from './read';
import { glow } from './glow';
import { byRef, refOf } from './refs';

export type Pt = { x: number; y: number };

/** Element rect in top-window viewport px, accounting for same-origin iframes. */
function rectTop(el: Element) {
  const r = el.getBoundingClientRect();
  let x = r.left;
  let y = r.top;
  let w: Window | null = el.ownerDocument.defaultView;
  while (w && w !== window && w.frameElement) {
    const f = w.frameElement as HTMLElement;
    const fr = f.getBoundingClientRect();
    x += fr.left + f.clientLeft;
    y += fr.top + f.clientTop;
    w = w.parent;
  }
  return { x, y, w: r.width, h: r.height };
}

export function deepAt(x: number, y: number): Element | null {
  let e = document.elementFromPoint(x, y);
  while (e?.shadowRoot) {
    const inner = e.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === e) break;
    e = inner;
  }
  return e;
}

function within(node: Node | null, anc: Node) {
  for (let n: any = node; n; n = n.parentNode ?? n.host) if (n === anc) return true;
  return false;
}

function brief(el: Element) {
  const id = el.id ? '#' + el.id : '';
  const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
  const t = clip((el as HTMLElement).innerText, 30);
  return `${el.localName}${id}${cls}${t ? ` "${q(t)}"` : ''}`;
}

export function locate(ref: string): Pt & { cover?: string } {
  const el = byRef(ref);
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
  const r = rectTop(el);
  if (!r.w && !r.h) throw new Error(`${ref} is not visible`);
  const x = r.x + r.w / 2;
  const y = r.y + r.h / 2;
  const top = deepAt(x, y);
  const inFrame = el.ownerDocument !== document;
  if (top && !inFrame && !within(top, el) && !within(el, top)) return { x, y, cover: `${refOf(top)} ${brief(top)}` };
  return { x, y };
}

/** Convert a screenshot point to viewport px, scrolling it into view if needed. */
export function ensurePoint(m: { x: number; y: number; doc: Pt | null }): Pt {
  if (!m.doc) return { x: m.x, y: m.y };
  const { x, y } = m.doc;
  let vx = x - scrollX;
  let vy = y - scrollY;
  if (vx < 0 || vy < 0 || vx >= innerWidth || vy >= innerHeight) {
    scrollTo({ left: x - innerWidth / 2, top: y - innerHeight / 2, behavior: 'instant' as ScrollBehavior });
    vx = x - scrollX;
    vy = y - scrollY;
  }
  return { x: vx, y: vy };
}

export function viewport(ref?: string) {
  glow(false);
  const rect = ref ? (locate(ref), rectTop(byRef(ref))) : undefined;
  const de = document.documentElement;
  // Let the glow removal paint before the capture.
  return Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), sleep(80)]).then(() => ({
    w: innerWidth,
    h: innerHeight,
    sx: scrollX,
    sy: scrollY,
    sw: Math.max(de.scrollWidth, document.body?.scrollWidth ?? 0),
    sh: Math.max(de.scrollHeight, document.body?.scrollHeight ?? 0),
    rect,
  }));
}
