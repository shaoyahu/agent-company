import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatServerOrigin,
  startAgentCompanyServer,
  type RunningServer,
} from '../../src/bootstrap.js';

function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'agent-company-host-'));
}

function removeDataDir(dataDir: string): void {
  rmSync(dataDir, { recursive: true, force: true });
}

function createMalformedSchema(dataDir: string): void {
  const db = new Database(join(dataDir, 'company.db'));
  try {
    db.exec('CREATE VIEW departments AS SELECT 1 AS id');
  } finally {
    db.close();
  }
}

async function assertPortCanBind(host: string, port: number): Promise<void> {
  const probe = createNetServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen({ host, port }, resolve);
  });
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => error ? reject(error) : resolve());
  });
}

test('port 0 启动后返回实际 localhost 端口', async () => {
  const dataDir = makeDataDir();
  const server = await startAgentCompanyServer({ port: 0, dataDir });
  try {
    assert.equal(server.host, '127.0.0.1');
    assert.ok(server.port > 0, '应返回操作系统分配的实际端口');
    assert.equal(server.origin, `http://${server.host}:${server.port}`);
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
});

test('origin 格式化正确支持 IPv4 和 IPv6 host', () => {
  assert.equal(formatServerOrigin('127.0.0.1', 4000), 'http://127.0.0.1:4000');
  assert.equal(formatServerOrigin('::1', 4000), 'http://[::1]:4000');
  assert.equal(formatServerOrigin('[::1]', 4000), 'http://[::1]:4000');
});

test('自定义 dataDir 创建 company.db', async () => {
  const dataDir = makeDataDir();
  const server = await startAgentCompanyServer({ port: 0, dataDir });
  try {
    assert.equal(existsSync(join(dataDir, 'company.db')), true);
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
});

test('CORS 预检允许 PATCH,避免桌面端保存会话资料 Failed to fetch', async () => {
  const dataDir = makeDataDir();
  const server = await startAgentCompanyServer({ port: 0, dataDir });
  try {
    const response = await fetch(`${server.origin}/api/conversations/test-id`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.match(response.headers.get('access-control-allow-methods') ?? '', /\bPATCH\b/);
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
});

test('显式 companyRoot 不受进程 cwd 影响并承载默认项目目录', async () => {
  const dataDir = makeDataDir();
  const companyRoot = makeDataDir();
  const server = await startAgentCompanyServer({
    port: 0,
    dataDir,
    companyRoot,
  });
  try {
    const response = await fetch(`${server.origin}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '显式 companyRoot 测试' }),
    });
    assert.equal(response.status, 200);
    const project = await response.json() as { id: string };
    assert.equal(
      existsSync(join(companyRoot, 'projects', project.id)),
      true,
      '默认项目目录必须位于显式 companyRoot',
    );
  } finally {
    await server.close();
    removeDataDir(dataDir);
    removeDataDir(companyRoot);
  }
});

test('活动 Server 拒绝第二次启动且关闭后允许顺序重启', async () => {
  const firstDataDir = makeDataDir();
  const secondDataDir = makeDataDir();
  const first = await startAgentCompanyServer({ port: 0, dataDir: firstDataDir });
  let unexpectedSecond: RunningServer | undefined;
  try {
    await assert.rejects(
      async () => {
        unexpectedSecond = await startAgentCompanyServer({
          port: 0,
          dataDir: secondDataDir,
        });
      },
      /已有活动的 Agent Company Server/,
    );

    const response = await fetch(`${first.origin}/api/projects`);
    assert.equal(response.status, 200, '第二次启动被拒后首个实例仍应可请求');
  } finally {
    await unexpectedSecond?.close();
    await first.close();
  }

  const restarted = await startAgentCompanyServer({
    port: 0,
    dataDir: secondDataDir,
  });
  try {
    const response = await fetch(`${restarted.origin}/api/projects`);
    assert.equal(response.status, 200, '首个实例关闭后应允许顺序重启');
  } finally {
    await restarted.close();
    removeDataDir(firstDataDir);
    removeDataDir(secondDataDir);
  }
});

test('DB 初始化失败后允许正常启动', async () => {
  const malformedDataDir = makeDataDir();
  const normalDataDir = makeDataDir();
  createMalformedSchema(malformedDataDir);

  try {
    await assert.rejects(
      startAgentCompanyServer({ port: 0, dataDir: malformedDataDir }),
      /Cannot add a column to a view/,
    );

    const server = await startAgentCompanyServer({ port: 0, dataDir: normalDataDir });
    try {
      const response = await fetch(`${server.origin}/api/projects`);
      assert.equal(response.status, 200);
    } finally {
      await server.close();
    }
  } finally {
    removeDataDir(malformedDataDir);
    removeDataDir(normalDataDir);
  }
});

test('close 释放端口且并发调用安全', async () => {
  const dataDir = makeDataDir();
  const server = await startAgentCompanyServer({ port: 0, dataDir });
  const { host, port } = server;
  try {
    await Promise.all([server.close(), server.close(), server.close()]);
    await assertPortCanBind(host, port);
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
});

test('DB 初始化前同步失败后允许正常启动', async () => {
  const dataDir = makeDataDir();
  const cwdDescriptor = Object.getOwnPropertyDescriptor(process, 'cwd');
  assert.ok(cwdDescriptor);

  try {
    Object.defineProperty(process, 'cwd', {
      ...cwdDescriptor,
      value: () => {
        throw new Error('测试 cwd 初始化失败');
      },
    });
    await assert.rejects(
      startAgentCompanyServer({ port: 0, dataDir }),
      /测试 cwd 初始化失败/,
    );
  } finally {
    Object.defineProperty(process, 'cwd', cwdDescriptor);
  }

  let server: RunningServer | undefined;
  try {
    server = await startAgentCompanyServer({ port: 0, dataDir });
    const response = await fetch(`${server.origin}/api/projects`);
    assert.equal(response.status, 200, '同步失败后下一次启动应成功');
  } finally {
    await server?.close();
    removeDataDir(dataDir);
  }
});

test('数据导出接口返回 zip 附件', async () => {
  const dataDir = makeDataDir();
  const server = await startAgentCompanyServer({ port: 0, dataDir });
  try {
    const response = await fetch(`${server.origin}/api/data/export`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/zip/);
    assert.match(response.headers.get('content-disposition') ?? '', /agent-company-backup-.*\.zip/);
    const body = Buffer.from(await response.arrayBuffer());
    assert.ok(body.length > 0);
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
});

test('数据导入接口缺 fileBase64 返回中文错误', async () => {
  const dataDir = makeDataDir();
  const server = await startAgentCompanyServer({ port: 0, dataDir });
  try {
    const response = await fetch(`${server.origin}/api/data/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await response.json() as { error: string };
    assert.equal(response.status, 400);
    assert.match(data.error, /fileBase64/);
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
});

test('一键还原接口确认 token 错误时拒绝执行', async () => {
  const dataDir = makeDataDir();
  const server = await startAgentCompanyServer({ port: 0, dataDir });
  try {
    const response = await fetch(`${server.origin}/api/data/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'wrong' }),
    });
    const data = await response.json() as { error: string };
    assert.equal(response.status, 400);
    assert.match(data.error, /确认/);
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
});
