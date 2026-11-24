import { api, clip, isFirefox, sleep, type Pt as Point } from './env';
import { captureVisible, bitmapOf, gifFrame, isRecording } from './image';
import { ensureAllowed } from './permissions';
import { agentTabs } from './state';

export type Args = Record<string, any>;
export type Tab = chrome.tabs.Tab & { id: number };
export type Pt = Point & { cover?: string };

/** Maps last screenshot pixels to document CSS px: doc = o + px * k. */
export const shotMap = new Map<number, { ox: number; oy: number; k: number }>();

interface Group {
  tab?: number;
  win?: number;
  tgid?: number;
}

export const groups = new Map<string, Group>();
export const owner = new Map<number, string>();

const store = (api.storage as any).session as chrome.storage.StorageArea | undefined;

export const restored: Promise<void> = (store?.get(['groups', 'owner']) ?? Promise.resolve({} as Record<string, any>))
  .then((r: Record<string, any>) => {
    for (const [k, v] of (r.groups ?? []) as [string, Group][]) groups.set(k, v);
    for (const [k, v] of (r.owner ?? []) as [number, string][]) owner.set(k, v);
  })
  .catch(() => {});

function persist() {
  store?.set({ groups: [...groups], owner: [...owner] }).catch(() => {});
}

export function groupOf(sid: string): Group {
  let g = groups.get(sid);
  if (!g) groups.set(sid, (g = {}));
  return g;
}

export function own(tabId: number, sid: string, select: boolean) {
  owner.set(tabId, sid);
  if (select) groupOf(sid).tab = tabId;
  persist();
}

export const foreign = (tabId: number, sid: string) => {
  const o = owner.get(tabId);
  return o != null && o !== sid;
};

export const others = (sid: string) => [...owner.values()].some((o) => o !== sid);

export function check(tabId: number, sid: string, force?: boolean) {
  const o = owner.get(tabId);
  if (o != null && o !== sid && !force)
    throw new Error(`Tab ${tabId} belongs to agent group "${o}". Use your own tabs, or tabs a=select tab=${tabId} force=true to take it.`);
}

export function forgetTab(tabId: number) {
  owner.delete(tabId);
  for (const g of groups.values()) if (g.tab === tabId) g.tab = undefined;
  persist();
}

export function forgetWindow(winId: number) {
  for (const g of groups.values()) if (g.win === winId) g.win = undefined;
  persist();
}

export function release(sid: string) {
  for (const [t, o] of owner) if (o === sid) owner.delete(t);
  groups.delete(sid);
  persist();
}

async function openWindow(sid: string): Promise<Tab> {
  const w: chrome.windows.Window | undefined = await api.windows.create({ focused: false, ...(isFirefox ? { titlePreface: `[${sid}] ` } : {}) } as chrome.windows.CreateData);
  const t = w?.tabs?.[0];
  if (w?.id == null || t?.id == null) throw new Error('Could not open a window for this agent group');
  groupOf(sid).win = w.id;
  own(t.id, sid, true);
  await addToGroup(t.id, sid);
  return t as Tab;
}

export async function getTab(a: Args, sid: string): Promise<Tab> {
  await restored;
  const g = groupOf(sid);
  if (a.tab != null) {
    const t = await api.tabs.get(a.tab).catch(() => null);
    if (!t) throw new Error(`No tab ${a.tab}`);
    check(a.tab, sid, a.force);
    own(a.tab, sid, false);
    return t as Tab;
  }
  if (g.tab != null) {
    const t = await api.tabs.get(g.tab).catch(() => null);
    if (t?.id != null && !foreign(t.id, sid)) return t as Tab;
    g.tab = undefined;
  }
  if (g.win != null) {
    const [t] = await api.tabs.query({ active: true, windowId: g.win }).catch(() => [] as chrome.tabs.Tab[]);
    if (t?.id != null && !foreign(t.id, sid)) {
      own(t.id, sid, true);
      return t as Tab;
    }
    if (!t) g.win = undefined;
  }
  if (g.win == null && !others(sid)) {
    const [t] = await api.tabs.query({ active: true, lastFocusedWindow: true });
    if (t?.id != null && !foreign(t.id, sid)) {
      g.win = t.windowId;
      own(t.id, sid, true);
      return t as Tab;
    }
  }
  return openWindow(sid);
}

export async function home(sid: string): Promise<number> {
  const g = groupOf(sid);
  if (g.win != null && (await api.windows.get(g.win).catch(() => null))) return g.win;
  return (await getTab({}, sid)).windowId;
}

export async function target(a: Args, sid: string): Promise<Tab> {
  const tab = await getTab(a, sid);
  ensureAllowed(tab.url);
  agentTabs.add(tab.id);
  return tab;
}

/** Message the tab's content script, injecting it if the tab predates the extension. */
export async function cs<T = any>(tabId: number, msg: Args): Promise<T> {
  ensureAllowed((await api.tabs.get(tabId)).url);
  let r: any;
  try {
    r = await api.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch (e) {
    if (!/Receiving end|Could not establish/i.test(String(e))) throw e;
    await api.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch((err) => {
      if (!/showing error page/i.test(String(err))) throw err;
      throw new Error('Tab shows a browser error page (site unreachable); navigate to a working URL first.');
    });
    await api.scripting.executeScript({ target: { tabId }, files: ['hook.js'], world: 'MAIN' } as any).catch(() => {});
    r = await api.tabs.sendMessage(tabId, msg, { frameId: 0 });
  }
  if (r?.error) throw new Error(r.error);
  return r?.value as T;
}

export async function waitLoad(tabId: number, ms = 20_000, delay = 150) {
  await sleep(delay);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await api.tabs.get(tabId).catch(() => null);
    if (!t || t.status === 'complete') return;
    await sleep(150);
  }
}

export function normUrl(u: string) {
  if (/^(localhost|\[::1\]|\d+\.\d+\.\d+\.\d+)([:/?#]|$)/i.test(u)) return 'http://' + u;
  if (/^[a-z][\w+.-]*:(?!\d)/i.test(u)) return u;
  return 'https://' + u;
}

export const tabLine = (t: chrome.tabs.Tab, marks = '') => `${t.id}${marks} ${clip(t.title, 60)} | ${clip(t.url, 100)}`;

const COLORS = ['orange', 'blue', 'green', 'purple', 'cyan', 'pink', 'yellow', 'red'] as const;

function colorOf(sid: string) {
  let h = 0;
  for (const c of sid) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export async function addToGroup(tabId: number, sid: string) {
  if (isFirefox || !chrome.tabGroups) return;
  const g = groupOf(sid);
  try {
    const tab = await api.tabs.get(tabId);
    if (g.tgid != null) {
      const tg = await chrome.tabGroups.get(g.tgid).catch(() => null);
      if (!tg || tg.windowId !== tab.windowId) g.tgid = undefined;
    }
    g.tgid = await chrome.tabs.group({ tabIds: [tabId], ...(g.tgid != null ? { groupId: g.tgid } : {}) });
    await chrome.tabGroups.update(g.tgid, { title: sid, color: colorOf(sid) });
    persist();
  } catch {
    /* tab groups are cosmetic */
  }
}

export async function frame(tab: Tab, mark?: Pt) {
  if (!isRecording(tab.id)) return;
  try {
    const t = await api.tabs.get(tab.id);
    if (!t.active) return;
    const bmp = await bitmapOf(await captureVisible(t.windowId));
    const k = bmp.width / (t.width || bmp.width);
    gifFrame(tab.id, bmp, mark && { x: mark.x * k, y: mark.y * k });
  } catch {
    /* a missed frame is fine */
  }
}

/** Resolve a target point in viewport CSS px from a ref or screenshot pixels. */
export async function point(tabId: number, a: Args): Promise<Pt> {
  if (a.ref) return cs(tabId, { op: 'locate', ref: a.ref });
  if (a.x == null || a.y == null) throw new Error('Give ref or x,y');
  const m = shotMap.get(tabId);
  const doc = m ? { x: m.ox + a.x * m.k, y: m.oy + a.y * m.k } : null;
  return cs(tabId, { op: 'ensurePoint', x: a.x, y: a.y, doc });
}
