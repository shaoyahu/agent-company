import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

type EnvLike = Record<string, string | undefined>;

function electronDevApiGuard() {
  return {
    name: 'agent-company-electron-dev-api-guard',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        const url = typeof req.url === 'string' ? req.url : '';
        if (url === '/ws' || url.startsWith('/ws?')) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Electron 开发模式下 WebSocket 请通过内置 Server 访问');
          return;
        }
        if (url === '/api' || url.startsWith('/api/')) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            error: 'Electron 开发模式下请在 Electron 窗口访问，浏览器页面不会代理到 4000',
          }));
          return;
        }
        next();
      });
    },
  };
}

export function createViteConfig(env: EnvLike = process.env) {
  const electronRenderer = env.AGENT_COMPANY_ELECTRON_RENDERER === '1';

  return defineConfig({
    base: './',
    plugins: [
      react(),
      ...(electronRenderer ? [electronDevApiGuard()] : []),
    ],
    optimizeDeps: {
      include: ['react-dom'],
    },
    server: {
      port: 5173,
      ...(electronRenderer
        ? {}
        : {
            proxy: {
              '/api': 'http://localhost:4000',
              '/ws': {
                target: 'ws://localhost:4000',
                ws: true,
              },
            },
          }),
    },
  });
}

export default createViteConfig();
