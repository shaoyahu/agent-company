import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export interface ProjectAttachmentPayload {
  name: string;
  size: number;
  contentBase64: string;
}

const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function assertAttachmentArray(value: unknown): ProjectAttachmentPayload[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('attachments 必须是数组');
  if (value.length > MAX_ATTACHMENTS) throw new Error('附件最多 8 个');
  return value as ProjectAttachmentPayload[];
}

function normalizeAttachmentName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('附件文件名非法');
  const name = value.trim();
  if (
    name === ''
    || name === '.'
    || name === '..'
    || name !== basename(name)
    || name.includes('/')
    || name.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(name)
  ) {
    throw new Error('附件文件名非法');
  }
  return name;
}

function decodeAttachmentContent(attachment: ProjectAttachmentPayload): Buffer {
  if (typeof attachment.size !== 'number' || !Number.isFinite(attachment.size) || attachment.size < 0) {
    throw new Error('附件大小非法');
  }
  if (attachment.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('单个附件不能超过 5MB');
  }
  if (typeof attachment.contentBase64 !== 'string') {
    throw new Error('附件内容必须是 base64');
  }
  if (attachment.contentBase64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.contentBase64)) {
    throw new Error('附件内容必须是 base64');
  }
  const content = Buffer.from(attachment.contentBase64, 'base64');
  if (content.length !== attachment.size) {
    throw new Error('附件大小与内容不一致');
  }
  return content;
}

export async function saveProjectAttachments(projectDir: string, value: unknown): Promise<string[]> {
  const attachments = assertAttachmentArray(value);
  if (attachments.length === 0) return [];

  const names = new Set<string>();
  const prepared = attachments.map((attachment) => {
    const name = normalizeAttachmentName(attachment?.name);
    if (names.has(name)) throw new Error(`附件文件名重复: ${name}`);
    names.add(name);
    return {
      name,
      content: decodeAttachmentContent(attachment),
    };
  });

  const attachmentsDir = join(projectDir, '.agent-company', 'attachments');
  await mkdir(attachmentsDir, { recursive: true });

  const inputFiles: string[] = [];
  for (const item of prepared) {
    await writeFile(join(attachmentsDir, item.name), item.content);
    inputFiles.push(`.agent-company/attachments/${item.name}`);
  }
  return inputFiles;
}
