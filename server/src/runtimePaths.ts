import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';

export function resolveRuntimeDataDir(
  env: NodeJS.ProcessEnv = process.env,
  osPlatform: NodeJS.Platform = platform(),
): string {
  if (env.AGENT_COMPANY_DATA_DIR?.trim()) {
    return resolve(env.AGENT_COMPANY_DATA_DIR);
  }
  if (osPlatform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Agent Company');
  }
  if (osPlatform === 'win32') {
    return join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Agent Company');
  }
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'agent-company');
}
