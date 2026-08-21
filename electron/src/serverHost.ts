import { join, resolve } from 'node:path';
import type {
  RunningServer,
  startAgentCompanyServer as StartAgentCompanyServer,
} from '../../server/src/bootstrap.js';

const SERVER_BOOTSTRAP_MODULE = '@agent-company/server/dist/bootstrap.js';

export type DesktopServerPaths = {
  companyRoot: string;
  dataDir: string;
};

export function resolveDesktopServerPaths(userData: string): DesktopServerPaths {
  const companyRoot = resolve(userData);
  return {
    companyRoot,
    dataDir: join(companyRoot, 'data'),
  };
}

export async function startServerHost(
  paths: DesktopServerPaths,
): Promise<RunningServer> {
  const serverModule = await import(SERVER_BOOTSTRAP_MODULE) as {
    startAgentCompanyServer: typeof StartAgentCompanyServer;
  };
  return serverModule.startAgentCompanyServer({
    host: '127.0.0.1',
    port: 0,
    dataDir: paths.dataDir,
    companyRoot: paths.companyRoot,
  });
}
