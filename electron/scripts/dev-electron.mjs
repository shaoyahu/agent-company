import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronDir = resolve(scriptDir, '..');
const rootDir = resolve(electronDir, '..');
const rendererUrl = 'http://127.0.0.1:5173';
const electronBin = join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');

let electronProcess = null;
let restarting = false;
let stopping = false;
let debounceTimer = null;

function log(message) {
  process.stdout.write(`[electron-dev] ${message}\n`);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      stdio: options.stdio ?? 'inherit',
      env: {
        ...process.env,
        ...(options.env ?? {}),
      },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} 失败: code=${code ?? 'null'} signal=${signal ?? 'null'}`));
    });
  });
}

async function waitForRenderer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(rendererUrl, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Vite 仍在启动,继续等待。
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 300));
  }
  throw new Error(`等待 Vite 超时: ${rendererUrl}`);
}

async function buildElectron() {
  await run('npm', ['run', 'build', '-w', 'electron'], { cwd: rootDir });
}

function startElectron() {
  log('启动 Electron');
  electronProcess = spawn(electronBin, ['.'], {
    cwd: electronDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      AGENT_COMPANY_RENDERER_URL: rendererUrl,
    },
  });
  electronProcess.once('exit', (code, signal) => {
    const expected = stopping || restarting;
    electronProcess = null;
    if (!expected) {
      process.exitCode = code ?? (signal ? 1 : 0);
      stopWatchers();
    }
  });
}

async function stopElectron() {
  if (!electronProcess) return;
  const child = electronProcess;
  let exited = false;
  await new Promise(resolvePromise => {
    child.once('exit', () => {
      exited = true;
      resolvePromise();
    });
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!exited) child.kill('SIGKILL');
    }, 3000).unref();
  });
}

async function restartElectron(reason, shouldBuildElectron) {
  if (restarting) return;
  restarting = true;
  try {
    log(`${reason},重启 Electron`);
    if (shouldBuildElectron) await buildElectron();
    await stopElectron();
    if (!stopping) startElectron();
  } catch (error) {
    console.error('[electron-dev] 重启失败:', error instanceof Error ? error.message : String(error));
  } finally {
    restarting = false;
  }
}

function scheduleRestart(reason, shouldBuildElectron) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void restartElectron(reason, shouldBuildElectron);
  }, 250);
}

const watchers = [];

function watchDirectory(path, reason, shouldBuildElectron) {
  if (!existsSync(path)) return;
  watchers.push(watch(path, { recursive: true }, () => {
    scheduleRestart(reason, shouldBuildElectron);
  }));
}

function stopWatchers() {
  stopping = true;
  for (const watcher of watchers) watcher.close();
  void stopElectron().finally(() => process.exit(process.exitCode ?? 0));
}

process.once('SIGINT', stopWatchers);
process.once('SIGTERM', stopWatchers);

await waitForRenderer();
await buildElectron();
startElectron();
watchDirectory(join(rootDir, 'server', 'dist'), 'Server 已重新构建', false);
watchDirectory(join(electronDir, 'src'), 'Electron Main 源码已变化', true);
