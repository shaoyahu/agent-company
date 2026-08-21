import type { WorkflowNodeControlResult } from '../types/company.js';

type ParsedDecision = {
  outputText: string;
  controlResult: WorkflowNodeControlResult;
};

function parseDecision(
  text: unknown,
  label: '条件判断' | '循环判断',
  pattern: RegExp,
  toResult: (value: string) => WorkflowNodeControlResult | null,
): ParsedDecision {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(`${label}控制标记无效：必须提供包含正文和控制标记的文本`);
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const markerIndexes = lines
    .map((line, index) => pattern.test(line.trim()) ? index : -1)
    .filter((index) => index >= 0);
  if (markerIndexes.length !== 1 || markerIndexes[0] !== lines.length - 1) {
    throw new Error(`${label}控制标记无效：必须在最后一行且只能出现一次`);
  }
  const marker = lines.at(-1)?.trim() ?? '';
  const value = marker.match(pattern)?.[1];
  const controlResult = value ? toResult(value) : null;
  if (!controlResult) {
    throw new Error(`${label}控制标记无效：控制值不受支持`);
  }
  const outputText = lines.slice(0, -1).join('\n').trim();
  if (!outputText) {
    throw new Error(`${label}控制标记无效：控制标记前必须包含非空正文`);
  }
  return { outputText, controlResult };
}

export function parseConditionDecision(text: unknown): ParsedDecision {
  return parseDecision(
    text,
    '条件判断',
    /^\[\[匹配:\s*(是|否)\]\]$/,
    (value) => value === '是'
      ? { type: 'condition', matched: true }
      : value === '否'
        ? { type: 'condition', matched: false }
        : null,
  );
}

export function parseLoopDecision(text: unknown): ParsedDecision {
  return parseDecision(
    text,
    '循环判断',
    /^\[\[循环:\s*(继续|结束)\]\]$/,
    (value) => value === '继续'
      ? { type: 'loop', action: 'continue' }
      : value === '结束'
        ? { type: 'loop', action: 'end' }
        : null,
  );
}
