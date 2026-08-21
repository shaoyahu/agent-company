import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyMentionKeyDown,
  decideMentionKeyDown,
  extractMentionIds,
    filterEnabledAgents,
  filterMentionAgents,
  findMentionState,
  getActiveMentionAgents,
  insertMention,
  syncMentionStateForValue,
} from '../../src/features/chat/mentions.ts';

test('识别光标所在的 @ 查询', () => {
  assert.deepEqual(findMentionState('你好 @tra', 7), {
    open: true,
    query: 'tra',
    start: 3,
    selectedIndex: 0,
  });
});

test('只识别行首或空白后的最近 @ 查询', () => {
  assert.equal(findMentionState('mail@example.com', 16).open, false);
  assert.equal(findMentionState('中文@tra', 6).open, false);
  assert.equal(findMentionState('先 @old 再\n@new', 13).query, 'new');
  assert.equal(findMentionState('你好 @tra 后续', 8).open, false);
});

test('插入 Agent id 并保留前后文本', () => {
  const state = findMentionState('问 @tr 后续', 5);
  assert.deepEqual(insertMention('问 @tr 后续', state, 'trae-dev-A'), {
    value: '问 @trae-dev-A  后续',
    caret: 14,
  });
});

test('插入拒绝空白和 hostile Agent id', () => {
  const state = findMentionState('@a', 2);
  for (const id of ['', '   ', '__proto__', 'constructor', 'prototype']) {
    assert.throws(
      () => insertMention('@a', state, id),
      /无效的 Agent id/,
    );
  }
});

test('插入拒绝 hostile value 和陈旧提及状态', () => {
  const validState = findMentionState('@agent', 6);
  for (const value of [undefined, null, '', '   ']) {
    assert.throws(
      () => insertMention(value as string, validState, 'ok'),
      /无效的提及文本/,
    );
  }
  for (const value of ['__proto__', 'constructor']) {
    assert.throws(
      () => insertMention(value, validState, 'ok'),
      /无效的提及状态/,
    );
  }

  const invalidStates = [
    undefined,
    null,
    { ...validState, open: false },
    { ...validState, query: 'other' },
    { ...validState, query: 'bad query' },
    { ...validState, start: -1 },
    { ...validState, start: Number.NaN },
    { ...validState, start: 99 },
  ];
  for (const state of invalidStates) {
    assert.throws(
      () => insertMention('@agent', state as typeof validState, 'ok'),
      /无效的提及状态/,
    );
  }
});

test('键盘决策对 hostile input 返回无操作', () => {
  for (const input of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.deepEqual(
      decideMentionKeyDown(input as never),
      { action: 'none', preventDefault: false },
    );
  }
});

test('键盘决策在 IME 输入时不拦截也不发送', () => {
  assert.deepEqual(decideMentionKeyDown({
    key: 'Enter',
    shiftKey: false,
    isComposing: true,
    mentionOpen: true,
    candidateCount: 2,
    selectedIndex: 0,
  }), { action: 'none', preventDefault: false });
});

test('键盘决策区分候选选择、关闭、移动和发送', () => {
  const base = {
    shiftKey: false,
    isComposing: false,
    mentionOpen: true,
    candidateCount: 2,
    selectedIndex: 0,
  };
  assert.deepEqual(decideMentionKeyDown({ ...base, key: 'ArrowDown' }), {
    action: 'move',
    selectedIndex: 1,
    preventDefault: true,
  });
  assert.deepEqual(decideMentionKeyDown({ ...base, key: 'ArrowUp', selectedIndex: 1 }), {
    action: 'move',
    selectedIndex: 0,
    preventDefault: true,
  });
  assert.deepEqual(decideMentionKeyDown({ ...base, key: 'Enter' }), {
    action: 'select',
    selectedIndex: 0,
    preventDefault: true,
  });
  assert.deepEqual(decideMentionKeyDown({ ...base, key: 'Tab' }), {
    action: 'select',
    selectedIndex: 0,
    preventDefault: true,
  });
  assert.deepEqual(decideMentionKeyDown({ ...base, key: 'Escape' }), {
    action: 'close',
    preventDefault: true,
  });
  assert.deepEqual(decideMentionKeyDown({
    ...base,
    key: 'Enter',
    mentionOpen: false,
    candidateCount: 0,
  }), { action: 'send', preventDefault: true });
  assert.deepEqual(decideMentionKeyDown({
    ...base,
    key: 'Enter',
    shiftKey: true,
    mentionOpen: false,
    candidateCount: 0,
  }), { action: 'none', preventDefault: false });
});

test('键盘事件适配器只执行决策对应的回调', () => {
  const calls: string[] = [];
  applyMentionKeyDown({
    key: 'Enter',
    shiftKey: false,
    isComposing: false,
    mentionOpen: true,
    candidateCount: 2,
    selectedIndex: 1,
  }, {
    preventDefault: () => calls.push('prevent'),
    close: () => calls.push('close'),
    move: index => calls.push(`move:${index}`),
    select: index => calls.push(`select:${index}`),
    send: () => calls.push('send'),
  });
  assert.deepEqual(calls, ['prevent', 'select:1']);
});

test('键盘事件适配器在 IME 输入时不执行任何回调', () => {
  const calls: string[] = [];
  applyMentionKeyDown({
    key: 'Enter',
    shiftKey: false,
    isComposing: true,
    mentionOpen: false,
    candidateCount: 0,
    selectedIndex: 0,
  }, {
    preventDefault: () => calls.push('prevent'),
    close: () => calls.push('close'),
    move: () => calls.push('move'),
    select: () => calls.push('select'),
    send: () => calls.push('send'),
  });
  assert.deepEqual(calls, []);
});

test('父级清空 value 时关闭候选，普通更新保留当前状态', () => {
  const open = findMentionState('@agent', 6);
  assert.deepEqual(syncMentionStateForValue('', open), {
    open: false,
    query: '',
    start: 0,
    selectedIndex: 0,
  });
  assert.strictEqual(syncMentionStateForValue('@agent', open), open);
  for (const value of [undefined, null, '   ', '__proto__', 'constructor']) {
    assert.deepEqual(syncMentionStateForValue(value, open), {
      open: false,
      query: '',
      start: 0,
      selectedIndex: 0,
    });
  }
});

test('Agent API 响应只返回 active 中有效的提及候选', () => {
  assert.deepEqual(
    getActiveMentionAgents({
      active: [
        { id: 'agent-a', name: '甲', enabled: true },
        { id: '__proto__', name: '非法', enabled: true },
      ],
      disabled: [{ id: 'agent-b', name: '乙', enabled: false }],
    }).map(agent => agent.id),
    ['agent-a'],
  );
  for (const result of [undefined, null, '', '   ', '__proto__', 'constructor', {}]) {
    assert.deepEqual(getActiveMentionAgents(result), []);
  }
});

test('过滤 hostile Agent 和查询', () => {
  const agents = [
    { id: 'ok', name: '正常', enabled: true },
    { id: '__proto__', enabled: true },
    { id: 'constructor', enabled: true },
    { id: 'prototype', enabled: true },
    { id: '', enabled: true },
  ];
  assert.deepEqual(filterMentionAgents(agents, undefined).map(a => a.id), ['ok']);
  assert.deepEqual(filterMentionAgents(agents, null).map(a => a.id), ['ok']);
  assert.deepEqual(filterMentionAgents(agents, '').map(a => a.id), ['ok']);
  assert.deepEqual(filterMentionAgents(agents, '   ').map(a => a.id), ['ok']);
});

test('候选只接受 enabled=true 且安全的 Agent，缺失 enabled 时保守排除', () => {
  const agents = [
    { id: 'enabled', name: '可用', enabled: true },
    { id: 'disabled', name: '停用', enabled: false },
    { id: 'missing-enabled', name: '缺字段' },
    { id: 'null-enabled', name: '空字段', enabled: null },
    { id: '__proto__', enabled: true },
    { id: 'constructor', enabled: true },
    null,
    undefined,
  ];
  assert.deepEqual(
    filterEnabledAgents(agents as any).map(agent => agent.id),
    ['enabled'],
  );
  assert.deepEqual(
    filterMentionAgents(agents as any, '').map(agent => agent.id),
    ['enabled'],
  );
  for (const hostile of [undefined, null, '', '   ', '__proto__', 'constructor', {}]) {
    assert.doesNotThrow(() => filterEnabledAgents(hostile as any));
    assert.deepEqual(filterEnabledAgents(hostile as any), []);
  }
});

test('按 id、中文名称、部门和角色过滤且不区分大小写', () => {
  const agents = [
    { id: 'Trae-Dev-A', name: '小明', department: '研发部', role: 'Worker', enabled: true },
    { id: 'design-lead', name: '小红', department: '设计部', role: 'Leader', enabled: true },
  ];
  assert.deepEqual(filterMentionAgents(agents, 'TRAE').map(a => a.id), ['Trae-Dev-A']);
  assert.deepEqual(filterMentionAgents(agents, '小红').map(a => a.id), ['design-lead']);
  assert.deepEqual(filterMentionAgents(agents, '研发').map(a => a.id), ['Trae-Dev-A']);
  assert.deepEqual(filterMentionAgents(agents, 'leader').map(a => a.id), ['design-lead']);
});

test('过滤限制结果数量并处理越界 limit', () => {
  const agents = Array.from(
    { length: 12 },
    (_, index) => ({ id: `agent-${index}`, enabled: true }),
  );
  assert.equal(filterMentionAgents(agents, '').length, 8);
  assert.equal(filterMentionAgents(agents, '', 2).length, 2);
  assert.deepEqual(filterMentionAgents(agents, '', 0), []);
  assert.deepEqual(filterMentionAgents(agents, '', -1), []);
  assert.equal(filterMentionAgents(agents, '', Number.POSITIVE_INFINITY).length, 8);
});

test('提取 Agent id 并按首次出现顺序去重', () => {
  assert.deepEqual(
    extractMentionIds('请 @trae-dev-A 和 @design-lead 处理，@trae-dev-A 复核'),
    ['trae-dev-A', 'design-lead'],
  );
  assert.deepEqual(extractMentionIds('@小明\n再问 @小明'), ['小明']);
});

test('提取提及忽略 hostile id 和非字符串内容', () => {
  assert.deepEqual(extractMentionIds('@__proto__ @constructor @prototype @ok'), ['ok']);
  for (const content of [undefined, null, '', '   ']) {
    assert.deepEqual(extractMentionIds(content), []);
  }
});

test('提及模型对 hostile value 安全关闭', () => {
  for (const value of [undefined, null, '', '   ', '__proto__', 'constructor']) {
    assert.equal(findMentionState(value as string, 0).open, false);
  }
});

test('提及模型对非法 caret 安全关闭', () => {
  for (const caret of [
    undefined,
    null,
    '',
    '   ',
    '__proto__',
    'constructor',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    7,
    1.5,
  ]) {
    assert.equal(findMentionState('@agent', caret as number).open, false);
  }
});
