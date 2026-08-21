import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ParticipantStateBar } from '../../src/features/messages/ParticipantStateBar.tsx';

function source(name: string): string {
  return readFileSync(
    new URL(`../../src/features/messages/${name}`, import.meta.url),
    'utf8',
  );
}

const pageSource = source('MessagesPage.tsx');
const listSource = source('ConversationList.tsx');
const timelineSource = source('ConversationTimeline.tsx');
const composerSource = source('ConversationComposer.tsx');
const detailsSource = source('ConversationDetails.tsx');
const modalSource = source('CreateConversationModal.tsx');
const modelSource = source('messageModel.ts');
const stateBarSource = source('ParticipantStateBar.tsx');

test('MessagesPage 加载会话列表并在选中后读取详情和消息', () => {
  assert.match(pageSource, /api\.conversations\(\)/);
  assert.match(pageSource, /api\.conversation\(conversationId\)/);
  assert.match(pageSource, /api\.conversationMessages\(conversationId/);
  assert.match(pageSource, /Promise\.all/);
});

test('MessagesPage 发送成功按 id 合并并清空输入', () => {
  assert.match(pageSource, /api\.sendConversationMessage/);
  assert.match(pageSource, /mergeConversationMessage/);
  assert.match(pageSource, /setComposerValue\(''\)/);
  assert.match(composerSource, /busy=\{disabled \|\| sending\}/);
});

test('会话加载结果与期间收到的实时消息合并，不覆盖当前消息', () => {
  assert.match(pageSource, /messages: \[\]/);
  assert.match(
    pageSource,
    /nextMessages\.reduce\(\s*\(merged, message\) => mergeConversationMessage\(merged, message\),\s*current\.messages,\s*\)/,
  );
});

test('详情加载期间输入框和 Enter 发送都被禁用', () => {
  assert.match(composerSource, /busy=\{disabled \|\| sending\}/);
  assert.match(
    pageSource,
    /if \(!conversationId \|\| !detail \|\| conversationLoading \|\| !content \|\| sending\) return/,
  );
});

test('建聊弹窗使用 Agent 复选框且不使用原生 select', () => {
  assert.match(modalSource, /type="checkbox"/);
  assert.doesNotMatch(modalSource, /<select[\s>]/);
  assert.match(modalSource, /filterEnabledAgents/);
  assert.match(modalSource, /私聊必须正好选择一个 Agent/);
  assert.match(modalSource, /群聊至少需要两个 Agent/);
  assert.match(modalSource, /群聊标题不能为空/);
});

test('建群弹窗必须配置隐藏调度器且支持 LLM 或 Agent 二选一', () => {
  assert.match(modalSource, /schedulerMode/);
  assert.match(modalSource, /schedulerLlm/);
  assert.match(modalSource, /schedulerAgentId/);
  assert.match(modalSource, /调度器 LLM/);
  assert.match(modalSource, /调度器 Agent/);
  assert.match(modelSource, /群聊必须配置调度器/);
  assert.match(pageSource, /providers=\{providers\}/);
});

test('会话输入复用 MentionTextarea，操作按钮使用共享 Button 和 lucide 图标', () => {
  assert.match(composerSource, /MentionTextarea/);
  assert.match(composerSource, /<Button/);
  assert.match(composerSource, /Send/);
  assert.match(listSource, /MessageSquarePlus/);
  assert.match(detailsSource, /UserPlus|UserMinus|Pause|Play/);
});

test('会话消息内容使用 MarkdownText 渲染 LLM markdown 输出', () => {
  assert.match(timelineSource, /MarkdownText/);
  assert.match(timelineSource, /className="messages-message-content"/);
  assert.match(timelineSource, /value=\{message\.content\}/);
});

test('创建成功后使用 History API 导航且不使用 hash', () => {
  assert.match(pageSource, /history\.pushState/);
  assert.match(pageSource, /\/messages\//);
  assert.doesNotMatch(pageSource, /location\.hash/);
});

test('列表、时间线和详情覆盖摘要、未读、排序、名称与成员回读', () => {
  assert.match(listSource, /lastMessage/);
  assert.match(listSource, /messages-conversation-unread/);
  assert.match(timelineSource, /sequence/);
  assert.match(timelineSource, /getConversationSenderName/);
  assert.match(detailsSource, /api\.addConversationMember/);
  assert.match(detailsSource, /api\.removeConversationMember/);
  assert.match(detailsSource, /api\.conversation\(conversation\.id\)/);
  assert.match(detailsSource, /filterEnabledAgents/);
  assert.match(detailsSource, /useConfirm/);
});

test('MessagesPage 使用统一事件归约并把当前参与者状态交给状态条', () => {
  assert.match(pageSource, /reduceConversationEvent/);
  assert.match(pageSource, /participantStates=/);
  assert.doesNotMatch(pageSource, /<ParticipantStateBar/);
  assert.match(detailsSource, /getParticipantStateMeta/);
  assert.match(detailsSource, /participantStates/);
  assert.match(detailsSource, /messages-member-status/);
});

test('会话列表支持右键菜单、置顶、免打扰、未读数量和删除操作', () => {
  assert.match(listSource, /onContextMenu/);
  assert.match(listSource, /messages-conversation-menu/);
  assert.match(listSource, /置顶|取消置顶/);
  assert.match(listSource, /免打扰|关闭免打扰/);
  assert.match(listSource, /删除消息/);
  assert.match(listSource, /unreadCount/);
  assert.match(listSource, /VolumeX/);
  assert.match(listSource, /Pin/);
});

test('会话详情资料默认只读,点击编辑后支持标题、预设头像和本地上传头像', () => {
  assert.match(detailsSource, /api\.updateConversationProfile/);
  assert.match(detailsSource, /editingProfile/);
  assert.match(detailsSource, /编辑资料/);
  assert.match(detailsSource, /messages-avatar-presets/);
  assert.match(detailsSource, /type="file"/);
  assert.match(detailsSource, /readAsDataURL/);
  assert.match(detailsSource, /保存资料/);
  assert.match(listSource, /conversation\.avatar/);
});

test('成员详情承载 Agent 状态和可搜索添加成员入口', () => {
  assert.match(detailsSource, /messages-member-list/);
  assert.match(detailsSource, /messages-member-list--scroll/);
  assert.match(detailsSource, /addMemberQuery/);
  assert.match(detailsSource, /placeholder="搜索 Agent"/);
  assert.match(detailsSource, /UserPlus/);
});

test('WebSocket 真实断线重连后回读列表、当前 detail 和消息', () => {
  assert.match(pageSource, /connectionGenerationRef/);
  assert.match(pageSource, /reduceConversationConnectionGeneration/);
  assert.match(pageSource, /previousGeneration === connectionGeneration/);
  assert.match(pageSource, /api\.conversations\(\)/);
  assert.match(pageSource, /api\.conversation\(conversationId\)/);
  assert.match(pageSource, /api\.conversationMessages\(conversationId\)/);
});

test('删除会话事件清空当前详情,不得回读已删除会话并弹刷新失败', () => {
  assert.match(pageSource, /event\.type === 'conversation_deleted'/);
  assert.match(pageSource, /setDetail\(null\)/);
  assert.match(pageSource, /history\.replaceState\(\{\}, '', '\/messages'\)/);
  assert.match(pageSource, /event\.type === 'conversation_updated'/);
});

test('参与者状态条通过 getParticipantStateMeta 兜底且只显示 Agent', () => {
  assert.match(stateBarSource, /getParticipantStateMeta/);
  assert.match(stateBarSource, /memberType === 'agent'/);
  assert.doesNotMatch(stateBarSource, /pending/i);
});

test('会话整体暂停时所有 Agent 都显示已暂停，包括无 actor 状态的成员', () => {
  const html = renderToStaticMarkup(createElement(ParticipantStateBar, {
    members: [
      {
        conversationId: 'c-1',
        memberId: 'agent-a',
        memberType: 'agent',
        enabled: true,
        paused: false,
        joinedAt: 1,
      },
      {
        conversationId: 'c-1',
        memberId: 'agent-b',
        memberType: 'agent',
        enabled: true,
        paused: false,
        joinedAt: 1,
      },
    ],
    agents: [
      { id: 'agent-a', name: '甲' },
      { id: 'agent-b', name: '乙' },
    ] as any,
    participantStates: new Map([
      ['agent-b', { state: 'error' as const, since: 2 }],
    ]),
    conversationPaused: true,
  }));

  assert.equal(html.match(/已暂停/g)?.length, 2);
  assert.doesNotMatch(html, /异常|空闲/);
});

test('会话详情中缺失的 Agent 成员显示不存在提示,不渲染运行态 tag', () => {
  assert.match(detailsSource, /const agentMissing = member\.memberType === 'agent' && !agent/);
  assert.match(detailsSource, /Agent 不存在/);
  assert.match(detailsSource, /!agentMissing &&/);
});

test('会话未暂停时保留成员手动暂停和 actor error 状态', () => {
  const html = renderToStaticMarkup(createElement(ParticipantStateBar, {
    members: [
      {
        conversationId: 'c-1',
        memberId: 'agent-a',
        memberType: 'agent',
        enabled: true,
        paused: true,
        joinedAt: 1,
      },
      {
        conversationId: 'c-1',
        memberId: 'agent-b',
        memberType: 'agent',
        enabled: true,
        paused: false,
        joinedAt: 1,
      },
    ],
    agents: [
      { id: 'agent-a', name: '甲' },
      { id: 'agent-b', name: '乙' },
    ] as any,
    participantStates: new Map([
      ['agent-b', { state: 'error' as const, since: 2 }],
    ]),
    conversationPaused: false,
  }));

  assert.equal(html.match(/已暂停/g)?.length, 1);
  assert.equal(html.match(/异常/g)?.length, 1);
});

test('时间线只渲染已持久化消息，不创建 pending Agent 气泡', () => {
  assert.doesNotMatch(timelineSource, /pending/i);
  assert.doesNotMatch(timelineSource, /正在输入|正在思考|生成中/);
});

test('会话和成员暂停恢复、移出操作使用图标菜单并在写入后回读 detail', () => {
  assert.match(detailsSource, /MoreHorizontal/);
  assert.match(detailsSource, /Pause/);
  assert.match(detailsSource, /Play/);
  assert.match(detailsSource, /UserMinus/);
  assert.match(detailsSource, /runConversationMutation/);
  assert.match(detailsSource, /createPortal/);
  assert.match(detailsSource, /memberMenuPosition/);
  assert.match(detailsSource, /api\.conversation\(conversation\.id\)/);
  for (const operation of [
    'pauseConversation',
    'resumeConversation',
    'pauseConversationAgent',
    'resumeConversationAgent',
    'removeConversationMember',
  ]) {
    assert.match(detailsSource, new RegExp(`api\\.${operation}`));
  }
});

test('页面提供中文加载、错误和空状态', () => {
  for (const copy of [
    '正在加载会话',
    '会话加载失败',
    '暂无会话',
    '请选择一个会话',
    '暂无消息',
  ]) {
    assert.ok(
      pageSource.includes(copy)
        || listSource.includes(copy)
        || timelineSource.includes(copy),
      `缺少中文状态文案：${copy}`,
    );
  }
});

test('消息页面 eyebrow 文案全部使用中文', () => {
  assert.match(listSource, />会话列表</);
  assert.match(pageSource, /\? '群聊' : '私聊'/);
  assert.match(detailsSource, />详情</);

  const messagePageSources = [listSource, pageSource, detailsSource].join('\n');
  for (const englishCopy of ['CONVERSATIONS', 'GROUP', 'DIRECT', 'DETAILS']) {
    assert.ok(
      !messagePageSources.includes(englishCopy),
      `仍存在英文 UI 文案：${englishCopy}`,
    );
  }
});

test('消息页面详情面板点击打开且卡片不超过 8px 圆角', () => {
  const listPane = pageSource.indexOf('className="messages-list-pane"');
  const chatPane = pageSource.indexOf('className="messages-chat-pane"');
  const detailsPane = pageSource.indexOf('className="messages-details-pane"');
  assert.ok(listPane > -1);
  assert.ok(chatPane > listPane);
  assert.ok(detailsPane > chatPane);
  assert.match(pageSource, /detailsOpen && detail &&/);
  assert.match(pageSource, /aria-label="打开会话详情"/);
  for (const componentSource of [
    listSource,
    timelineSource,
    composerSource,
    detailsSource,
    modalSource,
  ]) {
    assert.doesNotMatch(componentSource, /borderRadius:\s*(?:9|[1-9]\d+)\b/);
  }
});
