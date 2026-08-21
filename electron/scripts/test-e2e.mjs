import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  runAbiRestoreCli,
  runWithAbiRestore,
} from './abi-restore.mjs';

const INSTALL_COMMAND = 'npm run install:app-deps -w electron';
const PLAYWRIGHT_COMMAND = 'npm run test:e2e:playwright -w electron';
const RESTORE_COMMAND = 'npm rebuild better-sqlite3 --build-from-source';

export async function runElectronE2E(runCommand) {
  return runWithAbiRestore({
    commands: [INSTALL_COMMAND, PLAYWRIGHT_COMMAND],
    restoreCommand: RESTORE_COMMAND,
    runCommand,
    dualFailureMessage: 'Electron E2E 失败，且恢复 Node ABI 时再次失败',
  });
}

function spawnCommand(command) {
  return spawn('/bin/sh', ['-c', command], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: process.env,
    stdio: 'inherit',
  });
}

export async function runElectronE2ECli({
  signalTarget = process,
  spawnCommand: startCommand = spawnCommand,
  reportError = console.error,
} = {}) {
  return runAbiRestoreCli({
    execute: runElectronE2E,
    restoreCommand: RESTORE_COMMAND,
    signalTarget,
    spawnCommand: startCommand,
    reportError,
    interruptedMessage: (signal) => `Electron E2E 被 ${signal} 中断`,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runElectronE2ECli();
}
