import { resolve, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { WebSocketServer } from 'ws';
import { LLMRegistry } from './llm/index.js';
import { Orchestrator } from './orchestrator/index.js';
import { createServer } from './api/server.js';
import { closeDB, getDB } from './store/db.js';
import { ProviderRepo } from './store/providers.js';
import { ConfigService } from './store/config-merge.js';
import { reloadCustomTools } from './agent/customTools.js';
import { resolveRuntimeDataDir } from './runtimePaths.js';

export type ServerStartOptions = {
  host?: string;
  port?: number;
  dataDir?: string;
  companyRoot?: string;
};

export type RunningServer = {
  host: string;
  port: number;
  origin: string;
  close(): Promise<void>;
};

let hasActiveServer = false;

export function formatServerOrigin(host: string, port: number): string {
  const originHost = host.includes(':') && !host.startsWith('[')
    ? `[${host}]`
    : host;
  return `http://${originHost}:${port}`;
}

async function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  for (const client of wss.clients) {
    client.terminate();
  }
  await new Promise<void>((resolveClose, rejectClose) => {
    wss.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

export async function startAgentCompanyServer(
  options: ServerStartOptions = {},
): Promise<RunningServer> {
  if (hasActiveServer) {
    throw new Error('已有活动的 Agent Company Server，关闭后才能再次启动');
  }
  hasActiveServer = true;

  let app: FastifyInstance | undefined;
  let wss: WebSocketServer | undefined;
  try {
    const host = options.host ?? '127.0.0.1';
    const requestedPort = options.port ?? 0;
    const companyRoot = resolve(options.companyRoot ?? process.cwd());
    const dbPath = join(resolve(options.dataDir ?? resolveRuntimeDataDir()), 'company.db');

    closeDB();
    getDB(dbPath);

    const providerRepo = new ProviderRepo();
    const configService = new ConfigService();
    const dbProviders = providerRepo.list();
    const mergedConfig = configService.merged();

    const llmRegistry = new LLMRegistry();
    llmRegistry.init([], dbProviders);

    reloadCustomTools();

    const orchestrator = new Orchestrator(llmRegistry, mergedConfig, companyRoot, {
      onLog: (level, message) => {
        if (level === 'error' || level === 'warn') {
          console.log(`[${level}] ${message}`);
        }
        },
      });

    const created = await createServer({
      orchestrator,
      llmRegistry,
      companyRoot,
      bossName: '球球',
      providerRepo,
      configService,
    }, {
      host,
      port: requestedPort,
    });
    app = created.app;
    wss = created.wss;

    const port = created.port;
    let closePromise: Promise<void> | undefined;
    return {
      host,
      port,
      origin: formatServerOrigin(host, port),
      close(): Promise<void> {
        closePromise ??= (async () => {
          try {
            try {
              await closeWebSocketServer(wss!);
            } finally {
              try {
                await app!.close();
              } finally {
                closeDB();
              }
            }
          } finally {
            hasActiveServer = false;
          }
        })();
        return closePromise;
      },
    };
  } catch (error) {
    try {
      if (wss) {
        await closeWebSocketServer(wss).catch(() => undefined);
      }
      if (app) {
        await app.close().catch(() => undefined);
      }
      closeDB();
    } finally {
      hasActiveServer = false;
    }
    throw error;
  }
}
