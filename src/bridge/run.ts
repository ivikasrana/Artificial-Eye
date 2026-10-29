import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { TOOLS } from '../shared/tools';
import type { AgentClient } from './client';

const TIMEOUT = 300_000;
/** Bare string argument -> the tool's main parameter, so scripts read `await nav('example.com')`. */
const MAIN: Record<string, string> = { nav: 'url', js: 'code' };

type Args = Record<string, unknown>;

/**
 * Run an agent-written script with one async helper per tool, so loops, conditions and
 * several steps cost one tool call and one context round trip. Helpers return text;
 * images are saved to a temp file and their path is returned. Output is whatever the
 * script prints with console.log.
 */
export async function runScript(client: AgentClient, code: string): Promise<string> {
  const out: string[] = [];
  const print = (...a: unknown[]) => out.push(a.map((v) => (typeof v === 'string' ? v : inspect(v, { depth: 4 }))).join(' '));

  const helpers: Record<string, (a?: unknown, b?: Args) => Promise<string>> = {};
  for (const { name } of TOOLS) {
    helpers[name] = async (a?: unknown, b: Args = {}) => {
      const args: Args = typeof a === 'string' ? { [MAIN[name] ?? 'a']: a, ...b } : { ...(a as Args), ...b };
      const r = await client.call(name, args);
      if (!r.image) return r.text ?? 'ok';
      const p = join(tmpdir(), `aeye-shot-${Date.now()}.jpg`);
      writeFileSync(p, Buffer.from(r.image.data, 'base64'));
      return `image ${p}${r.text ? ' ' + r.text : ''}`;
    };
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 30_000)));

  const names = ['console', 'sleep', ...Object.keys(helpers)];
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => (...v: unknown[]) => Promise<void>;
  const fn = new AsyncFunction(...names, code);
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error('script timed out')), TIMEOUT)));
  try {
    await Promise.race([fn({ log: print, error: print, warn: print, info: print }, sleep, ...Object.values(helpers)), limit]);
  } catch (e) {
    out.push(`error: ${(e as Error).message}`);
    throw Object.assign(new Error(out.join('\n')), { partial: true });
  } finally {
    clearTimeout(timer!);
  }
  return out.join('\n') || 'ok';
}

export function readScript(args: string[]): string {
  if (args[0] === '-e') return args[1] ?? '';
  if (args[0] && args[0] !== '-') return readFileSync(args[0], 'utf8');
  return readFileSync(0, 'utf8');
}
