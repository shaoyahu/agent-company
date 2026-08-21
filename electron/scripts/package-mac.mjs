import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  runAbiRestoreCli,
  runWithAbiRestore,
} from './abi-restore.mjs';

const INSTALL_COMMAND = 'npm run install:app-deps -w electron';
const BUILDER_COMMAND = 'npm run package:mac -w electron';
const RESTORE_COMMAND = 'npm rebuild better-sqlite3 --build-from-source';
const SUPPORTED_NODE_MAJOR = 22;

function validateRuntime(platform, arch, nodeVersion) {
  if (platform !== 'darwin' || arch !== 'arm64') {
    throw new Error(
      `macOS 打包仅支持 darwin arm64，当前为 ${platform} ${arch}`,
    );
  }
  const nodeMajor = Number.parseInt(nodeVersion.replace(/^v/, ''), 10);
  if (nodeMajor !== SUPPORTED_NODE_MAJOR) {
    throw new Error(
      `macOS 打包仅支持 Node.js 22，当前为 ${nodeVersion}`,
    );
  }
}

export async function packageMac({
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.version,
  runCommand,
}) {
  validateRuntime(platform, arch, nodeVersion);

  return runWithAbiRestore({
    commands: [INSTALL_COMMAND, BUILDER_COMMAND],
    restoreCommand: RESTORE_COMMAND,
    runCommand,
    dualFailureMessage: 'macOS 打包失败，且恢复 Node ABI 时再次失败',
  });
}

function spawnCommand(command) {
  return spawn('/bin/sh', ['-c', command], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: process.env,
    stdio: 'inherit',
  });
}

export async function runPackageMacCli({
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.version,
  signalTarget = process,
  spawnCommand: startCommand = spawnCommand,
  reportError = console.error,
} = {}) {
  return runAbiRestoreCli({
    execute: (runCommand) => packageMac({
      platform,
      arch,
      nodeVersion,
      runCommand,
    }),
    restoreCommand: RESTORE_COMMAND,
    signalTarget,
    spawnCommand: startCommand,
    reportError,
    interruptedMessage: (signal) => `打包被 ${signal} 中断`,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runPackageMacCli();
}
