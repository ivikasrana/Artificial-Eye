import { clip } from '../env';
import { collapse, diffLines, paginate } from '../compact';
import { byRef, refOf, remember } from './refs';
import { session } from './session';

type Entry = { depth: number; line: string; hay: string; ref?: string; text?: boolean };

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'aeye-glow', 'br', 'wbr']);
const NO_DESCEND = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'img', 'svg', 'video', 'audio', 'canvas', 'option']);
const IN_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
  'switch', 'textbox', 'combobox', 'searchbox', 'slider', 'spinbutton', 'treeitem',
]);
const LANDMARKS = new Set(['nav', 'main', 'form', 'table', 'header', 'footer', 'aside', 'navigation', 'search']);
const MAX_ENTRIES = 6000;

export function read(o: { mode?: string; q?: string; ref?: string; max?: number; offset?: number; diff?: boolean; sid?: string }) {
  const max = Math.min(Number(o.max) || 4000, 50_000);
  const off = Number(o.offset) || 0;
  const head = () => {
    const sh = document.documentElement.scrollHeight;
    const scroll = sh > innerHeight + 10 ? ` [scroll ${Math.round(scrollY)}/${sh - innerHeight}]` : '';
    return `${clip(document.title, 80)} | ${clip(location.href, 100)}${scroll}\n`;
  };
  let out: string;
  if (o.mode === 'text') {
    const root = (o.ref ? byRef(o.ref) : document.querySelector('main,[role=main],article') ?? document.body) as HTMLElement;
    out = textOf(root).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();
  } else if (o.mode === 'find') {
    return paginate(find(String(o.q ?? '')), off, max);
  } else if (!o.ref && off > 0 && session(o.sid).page?.key === `${o.mode}|${location.href}`) {
    // Later pages come from the first page's output: no DOM re-walk, and offsets stay consistent.
    out = session(o.sid).page!.out;
  } else {
    const ents = collect(o.ref ? byRef(o.ref) : document.body, o.mode === 'all');
    const lines = ents.map((e) => '  '.repeat(e.depth) + e.line);
    out = lines.join('\n');
    if (!o.ref && o.mode !== 'all' && off === 0) {
      const s = session(o.sid);
      const prev = o.diff ? s.lines : undefined;
      s.lines = out.length <= max ? lines : undefined;
      if (prev) {
        const d = changes(prev, lines);
        if (d.length < Math.min(out.length, max)) return head() + d;
      }
    }
    if (out.length > max && !o.max) {
      const c = collapse(lines, ents.map(sigOf), (i) => '  '.repeat(ents[i].depth));
      if (c.hidden) out = c.lines.join('\n') + '\n(similar rows hidden: find q=words, or pass max to see all)';
    }
  }
  if (!o.ref && o.mode !== 'text' && off === 0) session(o.sid).page = { key: `${o.mode}|${location.href}`, out };
  const page = paginate(out, off, max);
  return off === 0 ? head() + page : page;
}

function textOf(root: HTMLElement | null) {
  let text = root?.innerText ?? '';
  for (const s of root?.querySelectorAll('select') ?? []) {
    const opts = s.innerText;
    if (opts) text = text.replace(opts, s.selectedOptions[0]?.text ?? '');
  }
  return text;
}

function labelOf(el: HTMLInputElement) {
  const l = el.labels?.[0];
  if (!l) return '';
  const own = l.contains(el) ? el.innerText : '';
  return own ? l.innerText.replace(own, '') : l.innerText;
}

function changes(prev: string[], next: string[]) {
  const { added, removed } = diffLines(prev.map((l) => l.trim()), next.map((l) => l.trim()));
  if (!added.length && !removed.length) return 'no changes since last read';
  const out = [`changes since last read: +${added.length} -${removed.length}`];
  for (const l of removed) out.push('- ' + l);
  for (const l of added) out.push('+ ' + l);
  return out.join('\n');
}

function sigOf(e: Entry) {
  const w = e.line.split(' ');
  const kind = e.ref ? w[1] : /^#+$/.test(w[0]) ? w[0] : e.text ? 'text' : w[0];
  return e.depth + ' ' + kind;
}

export function collect(root: Element | null, all: boolean): Entry[] {
  const out: Entry[] = [];
  if (!root) return out;
  const visit = (el: Element, depth: number, parentPointer: boolean, inText: boolean) => {
    if (out.length >= MAX_ENTRIES) return;
    const tag = el.localName;
    if (SKIP.has(tag) || el.getAttribute('aria-hidden') === 'true') return;
    const st = getComputedStyle(el);
    if (st.display === 'none') return;
    const pointer = st.cursor === 'pointer';
    let e: Entry | null = null;
    if (st.visibility !== 'hidden' && st.visibility !== 'collapse' && st.display !== 'contents')
      e = describe(el, tag, all, pointer && !parentPointer, inText, depth);
    if (e) out.push(e);
    if (NO_DESCEND.has(tag)) return;
    if (tag === 'iframe') {
      try {
        const b = (el as HTMLIFrameElement).contentDocument?.body;
        if (b) visit(b, depth + 1, false, false);
      } catch {
        /* cross-origin */
      }
      return;
    }
    const d = e && all ? depth + 1 : depth;
    const kids = el.shadowRoot ? [...el.shadowRoot.children, ...el.children] : el.children;
    for (const c of kids) visit(c, d, pointer, inText || !!e?.text);
  };
  visit(root, 0, false, false);
  return out;
}

function describe(el: Element, tag: string, all: boolean, newPointer: boolean, inText: boolean, depth: number): Entry | null {
  const role = roleOf(el, tag);
  if (isInteractive(el, tag, role, newPointer)) {
    let target = el;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      // Visually hidden checkbox/radio: point at its label instead.
      const label = (el as HTMLInputElement).labels?.[0];
      if (!label || !label.getBoundingClientRect().width) return null;
      target = label;
    }
    const name = nameOf(el, tag) || (target !== el ? clip((target as HTMLElement).innerText, 80) : '');
    return {
      depth,
      line: remember(refOf(target), `${refOf(target)} ${role}${name ? ` "${q(name)}"` : ''}${extras(el, tag, role)}`),
      hay: `${role} ${name} ${el.getAttribute('placeholder') ?? ''}`.toLowerCase(),
      ref: refOf(target),
    };
  }
  if (/^h[1-6]$/.test(tag)) {
    const lv = Number(tag[1]);
    if (!all && lv > 3) return null;
    const t = clip((el as HTMLElement).innerText, 100);
    return t ? { depth, line: `${'#'.repeat(lv)} ${t}`, hay: t.toLowerCase(), text: true } : null;
  }
  if (role === 'dialog' || role === 'alertdialog' || (tag === 'dialog' && (el as HTMLDialogElement).open)) {
    const n = nameOf(el, tag, false);
    return { depth, line: `dialog${n ? ` "${q(n)}"` : ''}`, hay: 'dialog ' + n.toLowerCase() };
  }
  if (role === 'alert' || role === 'status') {
    const t = clip((el as HTMLElement).innerText, 150);
    return t ? { depth, line: `${role} "${q(t)}"`, hay: t.toLowerCase(), text: true } : null;
  }
  if (!all) return null;
  if (tag === 'img') {
    const alt = clip(el.getAttribute('alt'), 80);
    return alt ? { depth, line: `img "${q(alt)}"`, hay: alt.toLowerCase() } : null;
  }
  if (LANDMARKS.has(role)) {
    const n = el.getAttribute('aria-label') ?? '';
    return { depth, line: role + (n ? ` "${q(clip(n, 60))}"` : ''), hay: role };
  }
  if (!inText && hasOwnText(el)) {
    const t = clip((el as HTMLElement).innerText ?? el.textContent, 200);
    return t ? { depth, line: t, hay: t.toLowerCase(), text: true } : null;
  }
  return null;
}

export const q = (s: string) => s.replace(/"/g, "'");

function hasOwnText(el: Element) {
  for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent!.trim()) return true;
  return false;
}

function roleOf(el: Element, tag: string): string {
  const r = el.getAttribute('role');
  if (r) return r.split(/\s/)[0];
  switch (tag) {
    case 'a':
      return 'link';
    case 'button':
    case 'summary':
      return 'button';
    case 'select':
    case 'textarea':
    case 'img':
    case 'dialog':
    case 'nav':
    case 'main':
    case 'form':
    case 'table':
    case 'header':
    case 'footer':
    case 'aside':
      return tag;
    case 'input': {
      const t = (el as HTMLInputElement).type;
      if (t === 'checkbox' || t === 'radio' || t === 'file') return t;
      if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
      return t === 'range' ? 'slider' : 'input';
    }
  }
  return (el as HTMLElement).isContentEditable ? 'textbox' : tag;
}

function isInteractive(el: Element, tag: string, role: string, newPointer: boolean) {
  switch (tag) {
    case 'a':
      return el.hasAttribute('href') || IN_ROLES.has(role);
    case 'button':
    case 'select':
    case 'textarea':
    case 'summary':
      return true;
    case 'input':
      return (el as HTMLInputElement).type !== 'hidden';
    case 'body':
    case 'html':
    case 'label':
      return false;
  }
  if (IN_ROLES.has(role)) return true;
  const h = el as HTMLElement;
  if (h.isContentEditable && !(h.parentElement as HTMLElement | null)?.isContentEditable) return true;
  if (el.hasAttribute('onclick')) return true;
  const ti = el.getAttribute('tabindex');
  if (ti !== null && Number(ti) >= 0) return true;
  return newPointer; // cursor:pointer that doesn't just inherit from a clickable parent
}

function nameOf(el: Element, tag: string, useText = true): string {
  const lb = el.getAttribute('aria-labelledby');
  if (lb) {
    const t = lb
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (t.trim()) return clip(t, 80);
  }
  const al = el.getAttribute('aria-label');
  if (al?.trim()) return clip(al, 80);
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const i = el as HTMLInputElement;
    const btn = ['button', 'submit', 'reset'].includes(i.type) ? i.value : '';
    return clip(
      labelOf(i).trim() || i.getAttribute('placeholder') || i.getAttribute('title') || btn || i.getAttribute('name'),
      80,
    );
  }
  const h = el as HTMLElement;
  if (h.isContentEditable) return clip(el.getAttribute('placeholder') ?? el.getAttribute('data-placeholder'), 80);
  if (tag === 'img') return clip(el.getAttribute('alt'), 80);
  if (useText) {
    const t = clip(h.innerText ?? el.textContent, 80);
    if (t) return t;
  }
  return clip(
    el.getAttribute('title') ??
      el.querySelector('img[alt]')?.getAttribute('alt') ??
      el.querySelector('svg title')?.textContent ??
      '',
    80,
  );
}

function extras(el: Element, tag: string, role: string): string {
  let s = '';
  if (tag === 'input') {
    const i = el as HTMLInputElement;
    const t = i.type;
    if (role === 'input' && t !== 'text') s += ` [${t}]`;
    if (t === 'checkbox' || t === 'radio') {
      if (i.checked) s += ' checked';
    } else if (t === 'file') {
      if (i.files?.length) s += ` =${i.files.length} file(s)`;
    } else if (i.value && role !== 'button') s += ` ="${t === 'password' ? '***' : q(clip(i.value, 40))}"`;
  } else if (tag === 'textarea') {
    const v = (el as HTMLTextAreaElement).value;
    if (v) s += ` ="${q(clip(v, 60))}"`;
  } else if (tag === 'select') {
    const sel = el as HTMLSelectElement;
    const o = sel.selectedOptions[0];
    if (o) s += ` ="${q(clip(o.text, 30))}"`;
    const n = sel.options.length;
    s += n <= 8 ? ` {${[...sel.options].map((x) => q(clip(x.text, 20))).join('|')}}` : ` {${n} options}`;
  } else if ((el as HTMLElement).isContentEditable) {
    const t = clip((el as HTMLElement).innerText, 60);
    if (t) s += ` ="${q(t)}"`;
  }
  if (el.getAttribute('aria-checked') === 'true') s += ' checked';
  const cur = el.getAttribute('aria-current');
  if (el.getAttribute('aria-selected') === 'true' || (cur && cur !== 'false')) s += ' current';
  const ex = el.getAttribute('aria-expanded');
  if (ex) s += ex === 'true' ? ' expanded' : ' collapsed';
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') s += ' disabled';
  if (tag === 'a') {
    const h = shortHref(el.getAttribute('href'));
    if (h) s += ` →${h}`;
  }
  return s;
}

function shortHref(h: string | null) {
  if (!h || h.startsWith('#') || /^javascript:/i.test(h)) return '';
  try {
    const u = new URL(h, location.href);
    return clip(u.origin === location.origin ? u.pathname + u.search : u.host + u.pathname, 50);
  } catch {
    return '';
  }
}

function find(query: string) {
  if (!query) throw new Error('find needs q');
  if (query.startsWith('css:')) {
    const els = [...document.querySelectorAll(query.slice(4))].slice(0, 30);
    return (
      els
        .map((el) => {
          const tag = el.localName;
          const role = roleOf(el, tag);
          const n = nameOf(el, tag);
          return remember(refOf(el), `${refOf(el)} ${role}${n ? ` "${q(n)}"` : ''}${extras(el, tag, role)}`);
        })
        .join('\n') || 'no match'
    );
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (
    collect(document.body, true)
      .map((e) => ({ e, s: words.filter((w) => e.hay.includes(w)).length / words.length + (e.ref ? 0.01 : 0) }))
      .filter((x) => x.s >= 0.5)
      .sort((a, b) => b.s - a.s)
      .slice(0, 20)
      .map((x) => x.e.line)
      .join('\n') || `no match for "${query}"`
  );
}

export function notices(limit: number) {
  const out: string[] = [];
  const sel = '[role=alert],[role=status],[role=alertdialog],[role=dialog],dialog[open],[aria-live=assertive],[aria-live=polite]';
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    if (out.length >= limit) break;
    if (!el.getClientRects().length) continue;
    const t = clip(el.innerText, 120);
    if (!t) continue;
    const role = el.getAttribute('role') ?? (el.localName === 'dialog' ? 'dialog' : 'live');
    out.push(`${role} "${q(t)}"`);
  }
  return out;
}
