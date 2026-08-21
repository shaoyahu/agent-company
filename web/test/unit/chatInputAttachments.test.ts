import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileToProjectAttachment, formatAttachmentSize } from '../../src/features/dashboard/attachments.js';

test('fileToProjectAttachment:把浏览器 File 转成 createProject 附件契约', async () => {
  const bytes = new Uint8Array([0, 1, 2, 255]);
  const file = {
    name: '截图.png',
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer,
  } as File;

  const attachment = await fileToProjectAttachment(file);

  assert.deepEqual(attachment, {
    name: '截图.png',
    size: 4,
    contentBase64: Buffer.from(bytes).toString('base64'),
  });
});

test('fileToProjectAttachment:剪贴板图片没有文件名时使用 png 文件名兜底', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const file = {
    name: '',
    type: 'image/png',
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer,
  } as File;

  const attachment = await fileToProjectAttachment(file, '粘贴图片-1.png');

  assert.deepEqual(attachment, {
    name: '粘贴图片-1.png',
    size: 4,
    contentBase64: Buffer.from(bytes).toString('base64'),
  });
});

test('formatAttachmentSize:小文件用 KB,大文件用 MB', () => {
  assert.equal(formatAttachmentSize(1536), '1.5 KB');
  assert.equal(formatAttachmentSize(2 * 1024 * 1024), '2.0 MB');
});
