import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { discoverInstalledClis } from '../../src/agent/cliDiscovery.js';

test('只返回 PATH 中存在且可执行的已知 CLI', () => {
  const root = join(tmpdir(), `agent-company-cli-discovery-${Date.now()}`);
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'traecli'), '#!/bin/sh\n');
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\n');
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\n');
  chmodSync(join(bin, 'traecli'), 0o755);
  chmodSync(join(bin, 'claude'), 0o755);

  try {
    assert.deepEqual(
      discoverInstalledClis({ pathEnv: bin, homeDir: root }),
      [
        {
          id: 'trae-cli',
          label: 'Trae CLI',
          executable: 'traecli',
          path: join(bin, 'traecli'),
          preset: 'trae',
        },
        {
          id: 'claude-code',
          label: 'Claude Code',
          executable: 'claude',
          path: join(bin, 'claude'),
        preset: 'claude',
        },
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('重复目录、空值和 hostile PATH 不会产生重复项或抛错', () => {
  const root = join(tmpdir(), `agent-company-cli-discovery-hostile-${Date.now()}`);
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'gemini'), '#!/bin/sh\n');
  chmodSync(join(bin, 'gemini'), 0o755);

  try {
    assert.doesNotThrow(() => discoverInstalledClis({
      pathEnv: `${bin}::${bin}:__proto__:constructor`,
      homeDir: root,
    }));
    assert.equal(
      discoverInstalledClis({ pathEnv: `${bin}:${bin}`, homeDir: root }).length,
      1,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
