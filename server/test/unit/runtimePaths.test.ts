import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveRuntimeDataDir } from '../../src/runtimePaths.js';

test('resolveRuntimeDataDir 使用显式环境变量', () => {
  assert.equal(
    resolveRuntimeDataDir({ AGENT_COMPANY_DATA_DIR: '/tmp/agent-company-data' }),
    '/tmp/agent-company-data',
  );
});

test('resolveRuntimeDataDir 在 macOS 使用 Application Support', () => {
  assert.equal(
    resolveRuntimeDataDir({}, 'darwin'),
    join(homedir(), 'Library', 'Application Support', 'Agent Company'),
  );
});

test('resolveRuntimeDataDir 在 Linux 使用 XDG_DATA_HOME', () => {
  assert.equal(
    resolveRuntimeDataDir({ XDG_DATA_HOME: '/tmp/xdg' }, 'linux'),
    join('/tmp/xdg', 'agent-company'),
  );
});
