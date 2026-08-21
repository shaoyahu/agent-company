import { test, expect, _electron as electron } from '@playwright/test';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';
import { cleanupElectronE2E } from './e2eCleanup.js';

const electronDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const desktopApiKeys = [
  'getAppInfo',
  'getServerOrigin',
  'isElectron',
  'openExternal',
  'selectProjectDirectory',
];

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolveConnection) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolveConnection(true);
    });
    socket.once('error', () => resolveConnection(false));
  });
}

test('真实 Electron 在所选目录运行显式 CLI 并在退出后释放 Server', async () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'agent-company-e2e-'));
  const homeDir = join(testRoot, 'home');
  const userDataDir = join(testRoot, 'user-data');
  const projectPath = join(testRoot, 'project');
  const cliPath = join(testRoot, 'task6-cli.sh');
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(userDataDir, { recursive: true });
  mkdirSync(projectPath, { recursive: true });
  const projectDir = realpathSync(projectPath);
  writeFileSync(
    cliPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "--models" ]; then',
      "  printf 'task6-model\\n'",
      '  exit 0',
      'fi',
      "printf '%s' \"$PWD\" > task6-cwd.txt",
      "printf 'Task 6 Electron E2E\\n' > task6-result.txt",
      "printf 'done\\n'",
      '',
    ].join('\n'),
  );
  chmodSync(cliPath, 0o755);

  const productionDb = join(
    process.env.HOME ?? '',
    'Library/Application Support/Agent Company/data/company.db',
  );
  const productionDbMtime = existsSync(productionDb)
    ? statSync(productionDb).mtimeMs
    : null;
  let serverPort: number | undefined;
  let electronApp: Awaited<ReturnType<typeof electron.launch>> | undefined;

  try {
    electronApp = await electron.launch({
      args: [
        join(electronDir, 'dist/main.js'),
        `--user-data-dir=${userDataDir}`,
      ],
      cwd: electronDir,
      env: {
        ...process.env,
        HOME: homeDir,
        NODE_ENV: 'test',
        AGENT_COMPANY_TEST_PROJECT_DIR: projectDir,
        AGENT_COMPANY_RENDERER_URL: '',
      },
    });

    const page = await electronApp.firstWindow();
    await expect(page.locator('body')).not.toHaveText('');
    expect(await page.evaluate(() => (
      Object.keys(window.agentCompanyDesktop ?? {}).sort()
    ))).toEqual(desktopApiKeys);

    const serverOrigin = await page.evaluate(() => (
      window.agentCompanyDesktop!.getServerOrigin()
    ));
    serverPort = Number(new URL(serverOrigin).port);
    expect(await canConnect(serverPort)).toBe(true);

    const createResponse = await page.evaluate(
      async ({ origin, command }) => {
        const post = async (path: string, body: unknown) => {
          const response = await fetch(`${origin}/api/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error ?? `HTTP ${response.status}`);
          }
          return data;
        };

        await post('departments', {
          id: 'task6-dept',
          name: 'Task 6 测试部门',
          head: 'task6-agent',
          teams: [],
        });
        await post('tools', {
          id: 'task6-cli',
          name: 'task6-cli',
          type: 'cli',
          description: 'Task 6 真实临时 CLI',
          enabled: true,
          config: {
            command,
            argsTemplate: '{prompt:q} {model:q}',
            modelsCommand: '--models',
            modelsParser: { type: 'lines' },
            timeoutMs: 10_000,
          },
        });
        await post('agents', {
          id: 'task6-agent',
          name: 'Task 6 Agent',
          department: 'task6-dept',
          role: 'worker',
          llm: '',
          systemPrompt: '执行测试任务',
          tools: [],
          skills: [],
          executor: 'cli',
          cliTool: 'task6-cli',
          cliModel: 'task6-model',
        });
        return true;
      },
      { origin: serverOrigin, command: cliPath },
    );
    expect(createResponse).toBe(true);

    await page.reload();
    await expect(page.getByText('Task 6 Agent').first()).toBeVisible();
    await page.getByRole('button', { name: /选择文件夹/ }).first().click();
    await expect(page.getByText(`项目目录: ${projectDir}`)).toBeVisible();

    await page.getByPlaceholder('输入消息... (输入 / 唤起命令)').fill(
      'Task 6 Electron E2E',
    );
    const projectCreated = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url() === `${serverOrigin}/api/projects`
    ));
    await page.locator('button[title="发送并开始(Enter)"]').click();
    const projectResponse = await projectCreated;
    expect(projectResponse.ok()).toBe(true);
    const project = await projectResponse.json() as { id: string };

    await expect.poll(() => existsSync(join(projectDir, 'task6-result.txt'))).toBe(true);
    expect(
      await page.evaluate(
        async ({ origin, projectId }) => {
          const response = await fetch(`${origin}/api/projects/${projectId}`);
          return response.json();
        },
        { origin: serverOrigin, projectId: project.id },
      ),
    ).toMatchObject({
      project: {
        metadata: {
          projectDir,
          projectOwnerAgentId: 'task6-agent',
        },
      },
    });
    expect(
      await import('node:fs/promises').then(({ readFile }) => (
        readFile(join(projectDir, 'task6-cwd.txt'), 'utf8')
      )),
    ).toBe(projectDir);
    expect(existsSync(join(userDataDir, 'data/company.db'))).toBe(true);
  } finally {
    const closedServerPort = serverPort;
    await cleanupElectronE2E({
      closeElectron: async () => {
        await electronApp?.close();
      },
      assertPortReleased: closedServerPort === undefined
        ? undefined
        : async () => {
            await expect.poll(() => canConnect(closedServerPort), {
              timeout: 10_000,
            }).toBe(false);
          },
      removeTestRoot: () => {
        rmSync(testRoot, { recursive: true, force: true });
      },
    });
  }

  expect(existsSync(testRoot)).toBe(false);
  expect(
    existsSync(productionDb) ? statSync(productionDb).mtimeMs : null,
  ).toBe(productionDbMtime);
});
