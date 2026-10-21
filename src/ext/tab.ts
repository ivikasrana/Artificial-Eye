import { cdpEnabled } from './cdp';
import { api, clip, isFirefox, sleep } from './env';
import { captureVisible, bitmapOf, gifFrame, isRecording } from './image';
import { ensureAllowed } from './permissions';
import { agentTabs } from './state';

export type Args = Record<string, any>;
export type Tab = chrome.tabs.Tab & { id: number };
export type Pt = { x: number; y: number; cover?: string };

/** Selected tab per agent session. */
export const sessionTab = new Map<string, number>();
/** Maps last screenshot pixels to document CSS px: doc = o + px * k. */
export const shotMap = new Map<number, { ox: number; oy: number; k: number }>();
let agentGroup: number | undefined;

export async function getTab(a: Args, sid: string): Promise<Tab> {
  const id: number | undefined = a.tab ?? sessionTab.get(sid);
  if (id != null) {
    try {
      return (await api.tabs.get(id)) as Tab;
    } catch {
      if (a.tab != null) throw new Error(`No tab ${id}`);
      sessionTab.delete(sid);
    }
  }
  const [t] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  if (t?.id == null) throw new Error('No active tab');
  sessionTab.set(sid, t.id);
  return t as Tab;
}

export async function target(a: Args, sid: string): Promise<Tab> {
  const tab = await getTab(a, sid);
  ensureAllowed(tab.url);
  agentTabs.add(tab.id);
  return tab;
}

/** Message the tab's content script, injecting it if the tab predates the extension. */
export async function cs<T = any>(tabId: number, msg: Args): Promise<T> {
  let r: any;
  try {
    r = await api.tabs.sendMessage(tabId, msg, { frameId: 0 });
  } catch (e) {
    if (!/Receiving end|Could not establish/i.test(String(e))) throw e;
    await api.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await api.scripting.executeScript({ target: { tabId }, files: ['hook.js'], world: 'MAIN' } as any).catch(() => {});
    r = await api.tabs.sendMessage(tabId, msg, { frameId: 0 });
  }
  if (r?.error) throw new Error(r.error);
  return r?.value as T;
}

export async function waitLoad(tabId: number, ms = 20_000) {
  await sleep(150);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await api.tabs.get(tabId).catch(() => null);
    if (!t || t.status === 'complete') return;
    await sleep(150);
  }
}

export function normUrl(u: string) {
  if (/^[a-z][\w+.-]*:/i.test(u)) return u;
  if (/^(localhost|127\.|\[?::1|\d+\.\d+\.\d+\.\d+)/.test(u)) return 'http://' + u;
  return 'https://' + u;
}

export const tabLine = (t: chrome.tabs.Tab, marks = '') => `${t.id}${marks} ${clip(t.title, 60)} | ${clip(t.url, 100)}`;

export async function addToGroup(tabId: number) {
  if (isFirefox || !chrome.tabGroups) return;
  try {
    if (agentGroup != null) await chrome.tabGroups.get(agentGroup).catch(() => (agentGroup = undefined));
    agentGroup = await chrome.tabs.group({ tabIds: [tabId], ...(agentGroup != null ? { groupId: agentGroup } : {}) });
    await chrome.tabGroups.update(agentGroup, { title: 'Agent', color: 'orange' });
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

export async function tryCdp(run: () => Promise<unknown>, fallback: () => Promise<unknown>) {
  if (!cdpEnabled()) return fallback();
  try {
    return await run();
  } catch {
    return fallback();
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
