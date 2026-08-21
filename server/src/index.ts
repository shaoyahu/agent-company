import 'dotenv/config';
import { startAgentCompanyServer } from './bootstrap.js';

async function main(): Promise<void> {
  const server = await startAgentCompanyServer({
    host: '127.0.0.1',
    port: 4000,
  });

  console.log(`🏢 Agent Company  ·  ${server.origin}`);

  const shutdown = async (): Promise<void> => {
    try {
      await server.close();
      process.exit(0);
    } catch (error) {
      console.error('关闭失败:', error);
      process.exit(1);
    }
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error('启动失败:', error);
  process.exit(1);
});
