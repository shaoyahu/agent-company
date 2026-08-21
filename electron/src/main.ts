import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
} from 'electron';
import type { RunningServer } from '../../server/src/bootstrap.js';
import {
  isDevToolsToggleInput,
  shouldAutoOpenDevTools,
} from './debug.js';
import { registerTrustedIpcHandlers } from './ipcHandlers.js';
import {
  handleSecondInstance,
  ResourceLifecycle,
} from './lifecycle.js';
import {
  assertAllowedExternalUrl,
  assertDarwin,
  installRendererNavigationGuards,
  projectDirectoryDialogOptions,
  resolveRendererTarget,
  secureWebPreferences,
  type RendererTarget,
  withDesktopExecutablePaths,
} from './security.js';
import {
  resolveDesktopServerPaths,
  startServerHost,
} from './serverHost.js';
import {
  isElectronTestEnvironment,
  resolveTestProjectDirectory,
} from './testHooks.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const runtimeIconPath = resolve(currentDir, '../assets', 'icon.png');
let mainWindow: BrowserWindow | null = null;
const serverLifecycle = new ResourceLifecycle<RunningServer>();
let quitAfterShutdown = false;
let markDesktopBackendReady!: () => void;
const desktopBackendReady = new Promise<void>((resolveReady) => {
  markDesktopBackendReady = resolveReady;
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function openExternalInBrowser(url: unknown): Promise<void> {
  await shell.openExternal(assertAllowedExternalUrl(url));
}

function openExternalFromPage(url: string): void {
  void openExternalInBrowser(url).catch((error) => {
    console.error('打开外链失败:', errorMessage(error));
  });
}

function toggleDevTools(window: BrowserWindow): void {
  if (window.webContents.isDevToolsOpened()) {
    window.webContents.closeDevTools();
  } else {
    window.webContents.openDevTools({ mode: 'detach' });
  }
}

function registerIpcHandlers(target: RendererTarget): void {
  const testProjectDirectory = resolveTestProjectDirectory(
    process.env.NODE_ENV,
    process.env.AGENT_COMPANY_TEST_PROJECT_DIR,
  );
  registerTrustedIpcHandlers(
    {
      handle(channel, listener) {
        ipcMain.handle(
          channel,
          (event, ...args) => listener(event, ...args),
        );
      },
    },
    {
      target,
      getCurrentWebContents: () => (
        mainWindow && !mainWindow.isDestroyed()
          ? mainWindow.webContents
          : null
      ),
      getServerOrigin: () => {
        const runningServer = serverLifecycle.current;
        if (!runningServer) {
          throw new Error('内置 Server 尚未启动');
        }
        return runningServer.origin;
      },
      selectProjectDirectory: async () => {
        if (testProjectDirectory) {
          return {
            canceled: false as const,
            path: testProjectDirectory,
          };
        }
        const options = {
          properties: [...projectDirectoryDialogOptions.properties],
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        if (result.canceled) {
          return { canceled: true as const };
        }

        const selectedPath = result.filePaths[0];
        if (!selectedPath || !isAbsolute(selectedPath)) {
          throw new Error('Finder 未返回有效的绝对目录');
        }
        return { canceled: false as const, path: selectedPath };
      },
      openExternal: openExternalInBrowser,
      getAppInfo: () => ({
        version: app.getVersion(),
        platform: 'darwin' as const,
      }),
    },
  );
}

async function createMainWindow(target: RendererTarget): Promise<void> {
  if (!serverLifecycle.canCreateWindow) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    icon: runtimeIconPath,
    webPreferences: {
      ...secureWebPreferences,
      preload: join(currentDir, 'preload.cjs'),
    },
  });
  mainWindow = window;

  window.webContents.on('before-input-event', (event, input) => {
    if (isDevToolsToggleInput(input)) {
      event.preventDefault();
      toggleDevTools(window);
    }
  });

  installRendererNavigationGuards(
    window.webContents,
    target,
    openExternalFromPage,
  );
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  if (target.kind === 'url') {
    await window.loadURL(target.url);
  } else {
    await window.loadFile(target.filePath);
  }

  if (shouldAutoOpenDevTools()) {
    window.webContents.openDevTools({ mode: 'detach' });
  }
}

async function startDesktopApp(): Promise<void> {
  assertDarwin(process.platform);
  process.env.PATH = withDesktopExecutablePaths(process.env.PATH, homedir());
  console.info(`[electron] PATH=${process.env.PATH ?? ''}`);
  const rendererTarget = resolveRendererTarget(
    app.isPackaged,
    process.env.AGENT_COMPANY_RENDERER_URL,
    resolve(currentDir, '../../web/dist/index.html'),
  );

  if (
    !isElectronTestEnvironment(process.env.NODE_ENV)
    && !app.requestSingleInstanceLock()
  ) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    void handleSecondInstance(
      desktopBackendReady,
      () => mainWindow,
      () => createMainWindow(rendererTarget),
    ).catch((error) => {
      dialog.showErrorBox('窗口启动失败', errorMessage(error));
    });
  });

  await app.whenReady();
  app.dock?.setIcon(runtimeIconPath);

  const serverPaths = resolveDesktopServerPaths(app.getPath('userData'));
  await mkdir(serverPaths.dataDir, { recursive: true });
  await serverLifecycle.start(() => startServerHost(serverPaths));
  if (!serverLifecycle.canCreateWindow) return;

  registerIpcHandlers(rendererTarget);
  markDesktopBackendReady();
  await createMainWindow(rendererTarget);

  app.on('activate', () => {
    if (!mainWindow) {
      void createMainWindow(rendererTarget).catch((error) => {
        dialog.showErrorBox('窗口启动失败', errorMessage(error));
      });
    }
  });
}

app.on('window-all-closed', () => {
  // macOS 应用在最后一个窗口关闭后继续运行。
});

app.on('before-quit', (event) => {
  if (quitAfterShutdown) return;

  event.preventDefault();
  void serverLifecycle.close()
    .catch((error) => {
      console.error('关闭内置 Server 失败:', errorMessage(error));
    })
    .finally(() => {
      quitAfterShutdown = true;
      app.quit();
    });
});

void startDesktopApp().catch(async (error) => {
  await serverLifecycle.close().catch((closeError) => {
    console.error('关闭内置 Server 失败:', errorMessage(closeError));
  });
  dialog.showErrorBox('Agent Company 启动失败', errorMessage(error));
  app.exit(1);
});
