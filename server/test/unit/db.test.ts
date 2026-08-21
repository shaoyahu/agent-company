/**
 * db.ts 单测:单例 + schema + 迁移
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDB, closeDB, getDBPath } from '../../src/store/db.js';

const ALL_TABLES = [
  'projects',
  'tasks',
  'deliverables',
  'messages',
  'agent_status',
  'llm_providers',
  'departments',
  'agents',
  'custom_tools',
  'workflows',
  'conversations',
  'conversation_members',
  'conversation_messages',
  'conversation_deliveries',
];

const CONVERSATION_COLUMNS: Record<string, string[]> = {
  conversations: [
    'id',
    'kind',
    'title',
    'avatar',
    'created_by',
    'agent_message_limit',
    'max_consecutive_speeches',
    'max_message_chars',
    'cooldown_ms',
    'paused',
    'pause_reason',
    'pinned',
    'muted',
    'last_read_sequence',
    'scheduler_mode',
    'scheduler_llm',
    'scheduler_agent_id',
    'created_at',
    'updated_at',
  ],
  conversation_members: [
    'conversation_id',
    'member_id',
    'member_type',
    'enabled',
    'paused',
    'joined_at',
  ],
  conversation_messages: [
    'id',
    'conversation_id',
    'sequence',
    'sender_id',
    'sender_type',
    'content',
    'mentions',
    'protection_boundary',
    'created_at',
  ],
  conversation_deliveries: [
    'conversation_id',
    'message_id',
    'agent_id',
    'status',
    'batch_id',
    'delivered_at',
    'processed_at',
    'error',
  ],
};

function freshTmp(): { dir: string; path: string } {
  closeDB();
  const dir = mkdtempSync(join(tmpdir(), 'agent-co-db-'));
  const path = join(dir, 'test.db');
  return { dir, path };
}

function cleanup(dir: string, path: string) {
  closeDB();
  for (const p of [path, `${path}-journal`, `${path}-shm`, `${path}-wal`]) {
    if (existsSync(p)) {
      try { rmSync(p); } catch {}
    }
  }
  if (existsSync(dir)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

test('getDB 第一次调用创建 db 并返回实例', () => {
  const { dir, path } = freshTmp();
  try {
    const db = getDB(path);
    assert.ok(db, '应返回 db 实例');
    assert.equal(existsSync(path), true, 'db 文件应存在');
  } finally {
    cleanup(dir, path);
  }
});

test('getDB 单例:同一 path 多次调用返同实例', () => {
  const { dir, path } = freshTmp();
  try {
    const a = getDB(path);
    const b = getDB(path);
    assert.strictEqual(a, b, '单例应返同实例');
  } finally {
    cleanup(dir, path);
  }
});

test('getDB 单例:有实例后再传不同 path 仍返旧实例', () => {
  const { dir, path } = freshTmp();
  try {
    const a = getDB(path);
    const b = getDB('/tmp/some-other.db');
    assert.strictEqual(a, b, '单例存在时 path 参数被忽略');
  } finally {
    cleanup(dir, path);
  }
});

test('closeDB 后再 getDB 创建新实例', () => {
  const { dir, path } = freshTmp();
  try {
    const a = getDB(path);
    assert.ok(a.open, '应开着');
    closeDB();
    const b = getDB(path);
    assert.notStrictEqual(a, b, 'closeDB 后应创建新实例');
  } finally {
    cleanup(dir, path);
  }
});

test('schema 初始化失败会关闭局部句柄且随后可打开正常 DB', () => {
  const { dir, path } = freshTmp();
  const normalPath = join(dir, 'normal.db');
  const malformed = new Database(path);
  malformed.exec('CREATE VIEW departments AS SELECT 1 AS id');
  malformed.close();

  try {
    assert.throws(() => getDB(path), /Cannot add a column to a view/);
    assert.equal(existsSync(`${path}-wal`), false, '失败后的 WAL 句柄应已关闭');
    assert.equal(existsSync(`${path}-shm`), false, '失败后的 SHM 句柄应已关闭');

    const db = getDB(normalPath);
    assert.equal(db.open, true, '初始化失败后应能打开正常 DB');
  } finally {
    cleanup(dir, path);
  }
});

test('schema 包含全部业务表', () => {
  const { dir, path } = freshTmp();
  try {
    const db = getDB(path);
    const rows = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    ).all() as Array<{ name: string }>;
    const names = new Set(rows.map((r) => r.name));
    for (const t of ALL_TABLES) {
      assert.ok(names.has(t), `缺表 ${t}`);
    }
  } finally {
    cleanup(dir, path);
  }
});

test('schema 含必要索引', () => {
  const { dir, path } = freshTmp();
  try {
    const db = getDB(path);
    const rows = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`,
    ).all() as Array<{ name: string }>;
    const names = new Set(rows.map((r) => r.name));
    // 关键索引(子集断言,允许后续加新索引)
    const expected = [
      'idx_tasks_project',
      'idx_tasks_status',
      'idx_tasks_assignee',
      'idx_messages_project',
      'idx_messages_channel',
      'idx_agents_dept',
      'idx_custom_tools_name',
      'idx_conversation_messages_order',
      'idx_conversation_deliveries_pending',
    ];
    for (const i of expected) {
      assert.ok(names.has(i), `缺索引 ${i}`);
    }
  } finally {
    cleanup(dir, path);
  }
});

test('conversation schema 包含全部列', () => {
  const { dir, path } = freshTmp();
  try {
    const db = getDB(path);
    for (const [table, expected] of Object.entries(CONVERSATION_COLUMNS)) {
      const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      assert.deepEqual(rows.map((row) => row.name), expected, `${table} 列定义不完整`);
    }
  } finally {
    cleanup(dir, path);
  }
});

test('conversation schema 外键和唯一约束完整', () => {
  const { dir, path } = freshTmp();
  try {
    const db = getDB(path);
    const memberFks = db.prepare(`PRAGMA foreign_key_list(conversation_members)`).all() as Array<{
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }>;
    assert.ok(memberFks.some((fk) =>
      fk.table === 'conversations'
      && fk.from === 'conversation_id'
      && fk.to === 'id'
      && fk.on_delete === 'CASCADE'));

    const messageFks = db.prepare(`PRAGMA foreign_key_list(conversation_messages)`).all() as typeof memberFks;
    assert.ok(messageFks.some((fk) =>
      fk.table === 'conversations'
      && fk.from === 'conversation_id'
      && fk.to === 'id'
      && fk.on_delete === 'CASCADE'));

    const deliveryFks = db.prepare(`PRAGMA foreign_key_list(conversation_deliveries)`).all() as typeof memberFks;
    assert.ok(deliveryFks.some((fk) =>
      fk.table === 'conversations'
      && fk.from === 'conversation_id'
      && fk.to === 'id'
      && fk.on_delete === 'CASCADE'));
    assert.ok(deliveryFks.some((fk) =>
      fk.table === 'conversation_messages'
      && fk.from === 'message_id'
      && fk.to === 'id'
      && fk.on_delete === 'CASCADE'));

    const messageIndexes = db.prepare(`PRAGMA index_list(conversation_messages)`).all() as Array<{
      name: string;
      unique: number;
    }>;
    const sequenceUnique = messageIndexes.find((index) => {
      if (index.unique !== 1) return false;
      const columns = db.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{ name: string }>;
      return columns.map((column) => column.name).join(',') === 'conversation_id,sequence';
    });
    assert.ok(sequenceUnique, 'conversation_messages 缺少 conversation_id + sequence 唯一约束');

    const memberPk = db.prepare(`PRAGMA table_info(conversation_members)`).all() as Array<{
      name: string;
      pk: number;
    }>;
    assert.deepEqual(
      memberPk.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name),
      ['conversation_id', 'member_id'],
    );

    const deliveryPk = db.prepare(`PRAGMA table_info(conversation_deliveries)`).all() as typeof memberPk;
    assert.deepEqual(
      deliveryPk.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name),
      ['message_id', 'agent_id'],
    );
  } finally {
    cleanup(dir, path);
  }
});

test('旧 conversation_messages 无 CHECK 时安全重建且重复 init 保留数据和约束', () => {
  const { dir, path } = freshTmp();
  const legacy = new Database(path);
  legacy.pragma('foreign_keys = ON');
  legacy.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
      title TEXT NOT NULL,
      created_by TEXT NOT NULL,
      agent_message_limit INTEGER NOT NULL DEFAULT 30,
      max_consecutive_speeches INTEGER NOT NULL DEFAULT 2,
      max_message_chars INTEGER NOT NULL DEFAULT 300,
      cooldown_ms INTEGER NOT NULL DEFAULT 5000,
      paused INTEGER NOT NULL DEFAULT 0,
      pause_reason TEXT CHECK (pause_reason IN ('manual', 'limit')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      sender_id TEXT NOT NULL,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('human', 'agent', 'system')),
      content TEXT NOT NULL,
      mentions TEXT NOT NULL DEFAULT '[]',
      protection_boundary TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (conversation_id, sequence),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_conversation_messages_order
      ON conversation_messages(conversation_id, sequence);
    CREATE INDEX idx_conversation_messages_sender
      ON conversation_messages(conversation_id, sender_id);
    CREATE TABLE conversation_deliveries (
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
      batch_id TEXT,
      delivered_at INTEGER NOT NULL,
      processed_at INTEGER,
      error TEXT,
      PRIMARY KEY (message_id, agent_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES conversation_messages(id) ON DELETE CASCADE
    );
    INSERT INTO conversations (
      id, kind, title, created_by, created_at, updated_at
    ) VALUES ('legacy-conversation', 'group', '旧会话', 'boss', 1, 2);
    INSERT INTO conversation_messages (
      id, conversation_id, sequence, sender_id, sender_type, content, mentions,
      protection_boundary, created_at
    ) VALUES
      (
        'legacy-human', 'legacy-conversation', 3, 'boss', 'human', '旧人类消息',
        '["agent-a","agent-b"]', NULL, 10
      ),
      (
        'legacy-boundary', 'legacy-conversation', 8, 'system', 'system', '旧保护边界',
        '[]', 'discussion_limit_resume', 20
      );
    INSERT INTO conversation_deliveries (
      conversation_id, message_id, agent_id, status, delivered_at
    ) VALUES ('legacy-conversation', 'legacy-human', 'agent-a', 'pending', 11);
  `);
  legacy.close();

  try {
    const assertMigrated = (db: Database.Database) => {
      const messages = db.prepare(
        `SELECT id, sequence, mentions, protection_boundary
         FROM conversation_messages
         ORDER BY sequence`,
      ).all();
      assert.deepEqual(messages, [
        {
          id: 'legacy-human',
          sequence: 3,
          mentions: '["agent-a","agent-b"]',
          protection_boundary: null,
        },
        {
          id: 'legacy-boundary',
          sequence: 8,
          mentions: '[]',
          protection_boundary: 'discussion_limit_resume',
        },
      ]);
      assert.deepEqual(
        db.prepare(
          `SELECT conversation_id, message_id, agent_id, status
           FROM conversation_deliveries`,
        ).get(),
        {
          conversation_id: 'legacy-conversation',
          message_id: 'legacy-human',
          agent_id: 'agent-a',
          status: 'pending',
        },
      );
      assert.deepEqual(
        db.prepare(
          `SELECT avatar, scheduler_mode, scheduler_llm, scheduler_agent_id
           FROM conversations
           WHERE id = 'legacy-conversation'`,
        ).get(),
        {
          avatar: null,
          scheduler_mode: 'none',
          scheduler_llm: null,
          scheduler_agent_id: null,
        },
      );
      const indexes = db.prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND tbl_name = 'conversation_messages'`,
      ).all() as Array<{ name: string }>;
      assert.ok(indexes.some((index) => index.name === 'idx_conversation_messages_order'));
      assert.ok(indexes.some((index) => index.name === 'idx_conversation_messages_sender'));
      const foreignKeys = db.prepare(
        `PRAGMA foreign_key_list(conversation_messages)`,
      ).all() as Array<{ table: string; from: string; to: string; on_delete: string }>;
      assert.ok(foreignKeys.some((foreignKey) =>
        foreignKey.table === 'conversations'
        && foreignKey.from === 'conversation_id'
        && foreignKey.to === 'id'
        && foreignKey.on_delete === 'CASCADE'));
      const deliveryForeignKeys = db.prepare(
        `PRAGMA foreign_key_list(conversation_deliveries)`,
      ).all() as Array<{ table: string; from: string; to: string; on_delete: string }>;
      assert.ok(deliveryForeignKeys.some((foreignKey) =>
        foreignKey.table === 'conversation_messages'
        && foreignKey.from === 'message_id'
        && foreignKey.to === 'id'
        && foreignKey.on_delete === 'CASCADE'));
      assert.throws(
        () => db.prepare(
          `UPDATE conversation_messages
           SET protection_boundary = 'invalid'
           WHERE id = 'legacy-human'`,
        ).run(),
        /CHECK constraint failed/,
      );
      assert.doesNotThrow(() => db.prepare(
        `UPDATE conversations
         SET pause_reason = 'scheduler'
         WHERE id = 'legacy-conversation'`,
      ).run());
    };

    const first = getDB(path);
    assertMigrated(first);
    closeDB();
    const second = getDB(path);
    assertMigrated(second);
  } finally {
    cleanup(dir, path);
  }
});

test('agents 表包含 skills / executor / cli_tool / cli_model 列(迁移就位)', () => {
  const { dir, path } = freshTmp();
  try {
    const db = getDB(path);
    const cols = db.prepare(`PRAGMA table_info(agents)`).all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    for (const c of ['skills', 'executor', 'cli_tool', 'cli_model']) {
      assert.ok(names.has(c), `agents 缺列 ${c}`);
    }
  } finally {
    cleanup(dir, path);
  }
});

test('llm_providers 表包含 path 列(自定义 API path)', () => {
  const { dir, path } = freshTmp();
  try {
    const db = getDB(path);
    const cols = db.prepare(`PRAGMA table_info(llm_providers)`).all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    assert.ok(names.has('path'), 'llm_providers 应有 path 列');
  } finally {
    cleanup(dir, path);
  }
});

test('新建 workflows 表包含 graph 列', () => {
  const { dir, path } = freshTmp();
  try {
    const db = getDB(path);
    const cols = db.prepare(`PRAGMA table_info(workflows)`).all() as Array<{ name: string }>;
    assert.ok(cols.some((column) => column.name === 'graph'), 'workflows 应有 graph 列');
  } finally {
    cleanup(dir, path);
  }
});

test('新建 tasks 表包含 workflow node 与 iteration 列', () => {
  const { dir, path } = freshTmp();
  try {
    const db = getDB(path);
    const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const workflowNode = cols.find((column) => column.name === 'workflow_node_id');
    const workflowIteration = cols.find(
      (column) => column.name === 'workflow_iteration',
    );
    assert.ok(workflowNode, 'tasks 应有 workflow_node_id 列');
    assert.ok(workflowIteration, 'tasks 应有 workflow_iteration 列');
    assert.equal(workflowIteration.notnull, 1);
    assert.equal(workflowIteration.dflt_value, '0');
  } finally {
    cleanup(dir, path);
  }
});

test('旧 tasks 表幂等迁移 workflow 列并让旧任务 iteration=0', () => {
  const { dir, path } = freshTmp();
  closeDB();
  const legacy = new Database(path);
  legacy.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      boss TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idea',
      phase TEXT NOT NULL DEFAULT 'idea',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      department TEXT NOT NULL,
      assignee TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      input_files TEXT NOT NULL DEFAULT '[]',
      output_files TEXT NOT NULL DEFAULT '[]',
      depends_on TEXT NOT NULL DEFAULT '[]',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    INSERT INTO projects (
      id, title, boss, status, phase, metadata, created_at, updated_at
    ) VALUES ('legacy-project', '旧项目', '球球', 'dev', 'dev', '{}', 1, 2);
    INSERT INTO tasks (
      id, project_id, phase, department, assignee, title, prompt, created_at
    ) VALUES (
      'legacy-task', 'legacy-project', 'dev', 'dev', 'agent-dev',
      '旧任务', '继续执行', 3
    );
  `);
  legacy.close();

  try {
    const assertMigrated = (db: Database.Database) => {
      const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{
        name: string;
      }>;
      assert.equal(
        cols.filter((column) => column.name === 'workflow_node_id').length,
        1,
      );
      assert.equal(
        cols.filter((column) => column.name === 'workflow_iteration').length,
        1,
      );
      assert.deepEqual(
        db.prepare(
          `SELECT id, workflow_node_id, workflow_iteration
           FROM tasks
           WHERE id = 'legacy-task'`,
        ).get(),
        {
          id: 'legacy-task',
          workflow_node_id: null,
          workflow_iteration: 0,
        },
      );
    };

    assertMigrated(getDB(path));
    closeDB();
    assertMigrated(getDB(path));
  } finally {
    cleanup(dir, path);
  }
});

test('旧 workflows 表幂等迁移 graph 列并保留旧行', () => {
  const { dir, path } = freshTmp();
  closeDB();
  const legacy = new Database(path);
  legacy.exec(`
    CREATE TABLE workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      stages TEXT NOT NULL DEFAULT '[]',
      templates TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO workflows (
      id, name, description, stages, templates, created_at, updated_at
    ) VALUES (
      'legacy-flow', '旧流程', NULL, '["prd"]', '{}', 1, 2
    );
  `);
  legacy.close();

  try {
    const assertMigrated = (db: Database.Database) => {
      const cols = db.prepare(`PRAGMA table_info(workflows)`).all() as Array<{ name: string }>;
      assert.equal(cols.filter((column) => column.name === 'graph').length, 1);
      assert.deepEqual(
        db.prepare(`SELECT id, graph FROM workflows WHERE id = 'legacy-flow'`).get(),
        { id: 'legacy-flow', graph: null },
      );
    };

    assertMigrated(getDB(path));
    closeDB();
    assertMigrated(getDB(path));
  } finally {
    cleanup(dir, path);
  }
});

test('旧 workflow_node_outputs 表幂等迁移 control_result 列', () => {
  const { dir, path } = freshTmp();
  closeDB();
  const legacy = new Database(path);
  legacy.exec(`
    CREATE TABLE workflow_node_outputs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workflow_node_id TEXT NOT NULL,
      workflow_node_type TEXT NOT NULL,
      run_id TEXT NOT NULL,
      iteration INTEGER NOT NULL,
      status TEXT NOT NULL,
      input_snapshot TEXT NOT NULL,
      output_text TEXT NOT NULL,
      output_task_ids TEXT NOT NULL,
      output_file_refs TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `);
  legacy.close();
  try {
    const assertMigrated = (db: Database.Database) => {
      const cols = db.prepare(`PRAGMA table_info(workflow_node_outputs)`).all() as Array<{ name: string }>;
      assert.equal(cols.filter(column => column.name === 'control_result').length, 1);
    };
    assertMigrated(getDB(path));
    closeDB();
    assertMigrated(getDB(path));
  } finally {
    cleanup(dir, path);
  }
});

test('departments 表包含 parent_id 列(迁移就位)', () => {
  const { dir, path } = freshTmp();
  try {
    const db = getDB(path);
    const cols = db.prepare(`PRAGMA table_info(departments)`).all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    assert.ok(names.has('parent_id'), 'departments 应有 parent_id 列');
  } finally {
    cleanup(dir, path);
  }
});

test('WAL 模式已启用', () => {
  const { dir, path } = freshTmp();
  try {
    const db = getDB(path);
    const mode = db.pragma('journal_mode', { simple: true });
    assert.equal(mode, 'wal', 'journal_mode 应为 wal');
  } finally {
    cleanup(dir, path);
  }
});

test('外键约束已开启', () => {
  const { dir, path } = freshTmp();
  try {
    const db = getDB(path);
    const fk = db.pragma('foreign_keys', { simple: true });
    assert.equal(fk, 1, 'foreign_keys 应为 1');
  } finally {
    cleanup(dir, path);
  }
});

test('幂等 init:多次 getDB 不会破坏 schema', () => {
  const { dir, path } = freshTmp();
  try {
    const db1 = getDB(path);
    db1.exec(`INSERT INTO departments (id, name, head, created_at, updated_at) VALUES ('d1', '研发', 'a1', 1, 1)`);
    closeDB();
    const db2 = getDB(path);
    const row = db2.prepare(`SELECT name FROM departments WHERE id = ?`).get('d1') as any;
    assert.ok(row, '数据应保留');
    assert.equal(row.name, '研发');
  } finally {
    cleanup(dir, path);
  }
});

test('getDBPath 返回当前打开的 DB 绝对路径', () => {
  const { dir, path } = freshTmp();
  try {
    closeDB();
    getDB(path);
    assert.equal(getDBPath(), path);
  } finally {
    cleanup(dir, path);
  }
});
