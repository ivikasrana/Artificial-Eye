import { PORT } from '../shared/protocol';
import { api, browserName, isFirefox } from './env';

export interface Settings {
  transport: 'auto' | 'native' | 'ws';
  port: number;
  token: string;
  blocked: string[];
  paused: boolean;
  /** Chromium only: use the debugger API for trusted input, full-page shots and CSP-proof JS. */
  debugger: boolean;
}

export const settings: Settings = {
  transport: 'auto',
  port: PORT,
  token: '',
  blocked: [],
  paused: false,
  debugger: true,
};

export const ready: Promise<void> = api.storage.local
  .get('settings')
  .then((r) => void Object.assign(settings, (r.settings as Partial<Settings>) ?? {}));

export async function saveSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  await api.storage.local.set({ settings });
  broadcast();
}

export const conn = { via: '' as '' | 'native' | 'ws', up: false, err: '' };

export interface Activity {
  t: number;
  tool: string;
  info: string;
  ok: boolean;
  ms: number;
}
export const activity: Activity[] = [];

export function logActivity(a: Activity) {
  activity.push(a);
  if (activity.length > 50) activity.shift();
  broadcast();
}

/** Tabs the agent has touched; their pages auto-accept dialogs and show the glow. */
export const agentTabs = new Set<number>();

export const snapshot = () => ({ settings, conn, activity, browser: browserName, firefox: isFirefox });

let pendingBroadcast: ReturnType<typeof setTimeout> | undefined;
export function broadcast() {
  clearTimeout(pendingBroadcast);
  pendingBroadcast = setTimeout(() => {
    api.runtime.sendMessage({ t: 'state', s: snapshot() }).catch(() => {});
  }, 100);
}
