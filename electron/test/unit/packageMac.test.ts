import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  packageMac,
  runPackageMacCli,
} from '../../scripts/package-mac.mjs';

const INSTALL_COMMAND = 'npm run install:app-deps -w electron';
const BUILDER_COMMAND = 'npm run package:mac -w electron';
const RESTORE_COMMAND = 'npm rebuild better-sqlite3 --build-from-source';
type PackageCommandRunner = (command: string) => Promise<void>;

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
  const completion = runPackageMacCli({
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: 'v22.23.2',
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

test('macOS 打包成功后恢复普通 Node ABI', async () => {
  const commands: string[] = [];
  const runCommand: PackageCommandRunner = async (command) => {
    commands.push(command);
  };

  await packageMac({
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: 'v22.23.2',
    runCommand,
  });

  assert.deepEqual(commands, [
    INSTALL_COMMAND,
    BUILDER_COMMAND,
    RESTORE_COMMAND,
  ]);
});

test('builder 失败后仍恢复普通 Node ABI 并保留原始错误', async () => {
  const commands: string[] = [];
  const builderError = new Error('测试 builder 失败');
  const runCommand: PackageCommandRunner = async (command) => {
    commands.push(command);
    if (command === BUILDER_COMMAND) {
      throw builderError;
    }
  };

  await assert.rejects(
    packageMac({
      platform: 'darwin',
      arch: 'arm64',
      nodeVersion: 'v22.23.2',
      runCommand,
    }),
    (error) => error === builderError,
  );
  assert.deepEqual(commands, [
    INSTALL_COMMAND,
    BUILDER_COMMAND,
    RESTORE_COMMAND,
  ]);
});

test('打包和恢复都失败时 AggregateError 保留两个原始错误', async () => {
  const builderError = new Error('测试 builder 失败');
  const restoreError = new Error('测试恢复失败');

  await assert.rejects(
    packageMac({
      platform: 'darwin',
      arch: 'arm64',
      nodeVersion: 'v22.23.2',
      async runCommand(command: string) {
        if (command === BUILDER_COMMAND) throw builderError;
        if (command === RESTORE_COMMAND) throw restoreError;
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [builderError, restoreError]);
      assert.equal(error.cause, builderError);
      return true;
    },
  );
});

test('install 阶段收到信号会终止当前子进程并在恢复完成后按首信号退出', async () => {
  const { signalTarget, children, completion } = startCli();
  assert.equal(children[0]?.command, INSTALL_COMMAND);

  signalTarget.emit('SIGINT');
  assert.deepEqual(children[0]?.child.killedWith, ['SIGINT']);
  assert.equal(signalTarget.exitCode, 130);
  await nextTurn();

  assert.equal(children[1]?.command, RESTORE_COMMAND);
  signalTarget.emit('SIGTERM');
  assert.deepEqual(children[1]?.child.killedWith, []);
  children[1]?.child.succeed();

  await completion;
  assert.equal(signalTarget.exitCode, 130);
  assert.deepEqual(children.map(({ command }) => command), [
    INSTALL_COMMAND,
    RESTORE_COMMAND,
  ]);
});

test('builder 阶段收到信号会终止当前子进程且恢复阶段不可中断', async () => {
  const { signalTarget, children, completion } = startCli();
  children[0]?.child.succeed();
  await nextTurn();
  assert.equal(children[1]?.command, BUILDER_COMMAND);

  signalTarget.emit('SIGTERM');
  assert.deepEqual(children[1]?.child.killedWith, ['SIGTERM']);
  await nextTurn();

  assert.equal(children[2]?.command, RESTORE_COMMAND);
  signalTarget.emit('SIGINT');
  assert.deepEqual(children[2]?.child.killedWith, []);
  children[2]?.child.succeed();

  await completion;
  assert.equal(signalTarget.exitCode, 143);
});

test('restore 阶段首次收到信号不会终止恢复子进程且等待恢复完成', async () => {
  const { signalTarget, children, completion } = startCli();
  children[0]?.child.succeed();
  await nextTurn();
  children[1]?.child.succeed();
  await nextTurn();
  assert.equal(children[2]?.command, RESTORE_COMMAND);

  signalTarget.emit('SIGINT');
  signalTarget.emit('SIGTERM');
  assert.deepEqual(children[2]?.child.killedWith, []);
  assert.equal(signalTarget.exitCode, 130);
  children[2]?.child.succeed();
  children[2]?.child.succeed();

  await completion;
  assert.equal(signalTarget.exitCode, 130);
});

test('包装器拒绝非 darwin arm64 和非 Node.js 22 运行时', async () => {
  const runCommand: PackageCommandRunner = async () => {
    assert.fail('环境校验失败时不应运行打包命令');
  };

  await assert.rejects(
    packageMac({
      platform: 'linux',
      arch: 'arm64',
      nodeVersion: 'v22.23.2',
      runCommand,
    }),
    /仅支持 darwin arm64/,
  );
  await assert.rejects(
    packageMac({
      platform: 'darwin',
      arch: 'x64',
      nodeVersion: 'v22.23.2',
      runCommand,
    }),
    /仅支持 darwin arm64/,
  );
  await assert.rejects(
    packageMac({
      platform: 'darwin',
      arch: 'arm64',
      nodeVersion: 'v24.10.0',
      runCommand,
    }),
    /仅支持 Node\.js 22/,
  );
});
