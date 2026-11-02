import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { PORT } from '../shared/protocol';

export const WIN = platform() === 'win32';
export const MAC = platform() === 'darwin';
export const dataDir = join(homedir(), '.aeye');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tokenPath = join(dataDir, 'token');
let token: string | undefined;

export function getToken(): string {
  if (token) return token;
  if (process.env.AEYE_TOKEN) return (token = process.env.AEYE_TOKEN.trim());
  if (existsSync(tokenPath)) token = readFileSync(tokenPath, 'utf8').trim();
  if (!token) {
    mkdirSync(dataDir, { recursive: true });
    token = randomBytes(24).toString('hex');
    writeFileSync(tokenPath, token, { mode: 0o600 });
  }
  return token;
}

export const getBind = () => process.env.AEYE_BIND || '127.0.0.1';
export const getHubHost = () => process.env.AEYE_HOST || '127.0.0.1';
export const isRemote = () => !!process.env.AEYE_HOST && process.env.AEYE_HOST !== '127.0.0.1' && process.env.AEYE_HOST !== 'localhost';
export const getPort = () => Number(process.env.AEYE_PORT) || PORT;

/** Diagnostics go to stderr: stdout is the protocol channel in both MCP and native mode. */
export const warn = (...a: unknown[]) => process.stderr.write('[aeye] ' + a.join(' ') + '\n');
