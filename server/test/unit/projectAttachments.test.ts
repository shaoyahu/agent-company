import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveProjectAttachments } from '../../src/api/projectAttachments.js';

test('saveProjectAttachments:校验并写入项目附件,返回首轮任务可读相对路径', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'project-attachments-'));
  try {
    const inputFiles = await saveProjectAttachments(projectDir, [
      {
        name: '需求.txt',
        size: Buffer.byteLength('附件内容'),
        contentBase64: Buffer.from('附件内容').toString('base64'),
      },
    ]);

    assert.deepEqual(inputFiles, ['.agent-company/attachments/需求.txt']);
    const filePath = join(projectDir, '.agent-company', 'attachments', '需求.txt');
    assert.equal(readFileSync(filePath, 'utf8'), '附件内容');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('saveProjectAttachments:拒绝路径穿越文件名且不落盘', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'project-attachments-bad-name-'));
  try {
    await assert.rejects(
      saveProjectAttachments(projectDir, [
        {
          name: '../secret.txt',
          size: 1,
          contentBase64: Buffer.from('x').toString('base64'),
        },
      ]),
      /附件文件名非法/,
    );
    assert.equal(existsSync(join(projectDir, '.agent-company')), false);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('saveProjectAttachments:拒绝数量和大小越界', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'project-attachments-limit-'));
  try {
    await assert.rejects(
      saveProjectAttachments(projectDir, Array.from({ length: 9 }, (_, i) => ({
        name: `f${i}.txt`,
        size: 1,
        contentBase64: Buffer.from('x').toString('base64'),
      }))),
      /附件最多 8 个/,
    );
    await assert.rejects(
      saveProjectAttachments(projectDir, [
        {
          name: 'big.txt',
          size: 5 * 1024 * 1024 + 1,
          contentBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'),
        },
      ]),
      /单个附件不能超过 5MB/,
    );
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
