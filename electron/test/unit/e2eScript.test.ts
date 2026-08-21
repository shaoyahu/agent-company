import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  runElectronE2E,
  runElectronE2ECli,
} from '../../scripts/test-e2e.mjs';

const INSTALL = 'npm run install:app-deps -w electron';
const PLAYWRIGHT = 'npm run test:e2e:playwright -w electron';
const RESTORE = 'npm rebuild better-sqlite3 --build-from-source';

class FakeChild extends EventEmitter {
  readonly killedWith: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals): boolean {
    this.killedWith.push(signal);
    queueMicrotask(() => this.emit('close', null, signal));
    return true;
  }

  succeed(): void {
    this.emit('close', 0, null);
  }
}

class FakeProcess extends EventEmitter {
  exitCode: number | undefined;
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function startCli() {
  const signalTarget = new FakeProcess();
  const children: Array<{ command: string; child: FakeChild }> = [];
  const completion = runElectronE2ECli({
    signalTarget,
    spawnCommand(command: string) {
      const child = new FakeChild();
      children.push({ command, child });
      return child;
    },
    reportError() {},
  });
  return { signalTarget, children, completion };
}

test('Electron E2E 成功后恢复普通 Node ABI', async () => {
  const commands: string[] = [];
  await runElectronE2E(async (command: string) => {
    commands.push(command);
  });
  assert.deepEqual(commands, [INSTALL, PLAYWRIGHT, RESTORE]);
});

test('Playwright 失败后仍恢复 Node ABI并保留原始错误', async () => {
  const commands: string[] = [];
  const playwrightError = new Error('Playwright 失败');
  await assert.rejects(
    runElectronE2E(async (command: string) => {
      commands.push(command);
      if (command === PLAYWRIGHT) throw playwrightError;
    }),
    (error) => error === playwrightError,
  );
  assert.deepEqual(commands, [INSTALL, PLAYWRIGHT, RESTORE]);
});

test('Playwright 与 ABI 恢复都失败时保留两个错误', async () => {
  const playwrightError = new Error('Playwright 失败');
  const restoreError = new Error('ABI 恢复失败');
  await assert.rejects(
    runElectronE2E(async (command: string) => {
      if (command === PLAYWRIGHT) throw playwrightError;
      if (command === RESTORE) throw restoreError;
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [playwrightError, restoreError]);
      return true;
    },
  );
});

test('E2E install 阶段收到 SIGINT 会终止子进程、恢复 ABI 后退出 130', async () => {
  const { signalTarget, children, completion } = startCli();
  assert.equal(children[0]?.command, INSTALL);

  signalTarget.emit('SIGINT');
  assert.deepEqual(children[0]?.child.killedWith, ['SIGINT']);
  await nextTurn();

  assert.equal(children[1]?.command, RESTORE);
  signalTarget.emit('SIGTERM');
  assert.deepEqual(children[1]?.child.killedWith, []);
  children[1]?.child.succeed();

  await completion;
  assert.equal(signalTarget.exitCode, 130);
});

test('E2E Playwright 阶段收到 SIGTERM 会终止子进程、恢复 ABI 后退出 143', async () => {
  const { signalTarget, children, completion } = startCli();
  children[0]?.child.succeed();
  await nextTurn();
  assert.equal(children[1]?.command, PLAYWRIGHT);

  signalTarget.emit('SIGTERM');
  assert.deepEqual(children[1]?.child.killedWith, ['SIGTERM']);
  await nextTurn();

  assert.equal(children[2]?.command, RESTORE);
  children[2]?.child.succeed();
  await completion;
  assert.equal(signalTarget.exitCode, 143);
});

test('E2E restore 阶段收到信号会延迟到恢复完成并采用首信号退出码', async () => {
  const { signalTarget, children, completion } = startCli();
  children[0]?.child.succeed();
  await nextTurn();
  children[1]?.child.succeed();
  await nextTurn();
  assert.equal(children[2]?.command, RESTORE);

  signalTarget.emit('SIGTERM');
  signalTarget.emit('SIGINT');
  assert.deepEqual(children[2]?.child.killedWith, []);
  children[2]?.child.succeed();

  await completion;
  assert.equal(signalTarget.exitCode, 143);
});
