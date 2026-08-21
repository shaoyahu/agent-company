import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { resolveDesktopServerPaths } from '../../src/serverHost.js';

test('Electron 以 userData 作为稳定 companyRoot 并将数据库放入 data 子目录', () => {
  const userData = resolve('/private/tmp/agent-company-user-data');

  assert.deepEqual(resolveDesktopServerPaths(userData), {
    companyRoot: userData,
    dataDir: resolve(userData, 'data'),
  });
});
