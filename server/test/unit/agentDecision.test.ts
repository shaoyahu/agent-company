import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseConditionDecision,
  parseLoopDecision,
} from '../../src/workflows/agentDecision.js';

test('条件判断剥离最后一行控制标记并保留正文', () => {
  assert.deepEqual(
    parseConditionDecision('验收项全部通过。\n[[匹配: 是]]'),
    { outputText: '验收项全部通过。', controlResult: { type: 'condition', matched: true } },
  );
  assert.deepEqual(
    parseConditionDecision('仍有阻塞问题。\n[[匹配: 否]]'),
    { outputText: '仍有阻塞问题。', controlResult: { type: 'condition', matched: false } },
  );
});

test('循环判断剥离最后一行控制标记并保留正文', () => {
  assert.deepEqual(
    parseLoopDecision('修复尚未完成。\n[[循环: 继续]]'),
    { outputText: '修复尚未完成。', controlResult: { type: 'loop', action: 'continue' } },
  );
  assert.deepEqual(
    parseLoopDecision('所有问题均已关闭。\n[[循环: 结束]]'),
    { outputText: '所有问题均已关闭。', controlResult: { type: 'loop', action: 'end' } },
  );
});

test('控制标记拒绝缺失、重复、非末行、空正文和 hostile 输入', () => {
  const invalid = [
    undefined, null, '', '   ', '__proto__', 'constructor',
    '没有控制标记',
    '正文\n[[匹配: 是]]\n额外内容',
    '正文\n[[匹配: 是]]\n[[匹配: 否]]',
    '[[匹配: 是]]',
    '正文\n[[匹配: 也许]]',
  ];
  for (const text of invalid) {
    assert.throws(
      () => parseConditionDecision(text as string),
      /^Error: 条件判断控制标记无效：/,
      String(text),
    );
  }
  assert.throws(
    () => parseLoopDecision('正文\n[[循环: 未知]]'),
    /^Error: 循环判断控制标记无效：/,
  );
});
