import Database from 'better-sqlite3';
import { resolve, join } from 'node:path';
import { resolveRuntimeDataDir } from '../runtimePaths.js';
import { mkdirSync, existsSync } from 'node:fs';

let dbInstance: Database.Database | null = null;
let dbPathInstance: string | null = null;

function conversationMessagesTableSql(
  tableName = 'conversation_messages',
  ifNotExists = true,
): string {
  return `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${tableName} (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    sender_id TEXT NOT NULL,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('human', 'agent', 'system')),
    content TEXT NOT NULL,
    mentions TEXT NOT NULL DEFAULT '[]',
    protection_boundary TEXT CHECK (
      protection_boundary IS NULL
      OR protection_boundary IN ('discussion_limit_resume')
    ),
    created_at INTEGER NOT NULL,
    UNIQUE (conversation_id, sequence),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  )`;
}

function conversationsTableSql(
  tableName = 'conversations',
  ifNotExists = true,
): string {
  return `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${tableName} (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
    title TEXT NOT NULL,
    avatar TEXT,
    created_by TEXT NOT NULL,
    agent_message_limit INTEGER NOT NULL DEFAULT 30,
    max_consecutive_speeches INTEGER NOT NULL DEFAULT 2,
    max_message_chars INTEGER NOT NULL DEFAULT 300,
    cooldown_ms INTEGER NOT NULL DEFAULT 5000,
    paused INTEGER NOT NULL DEFAULT 0,
    pause_reason TEXT CHECK (pause_reason IN ('manual', 'limit', 'scheduler')),
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    muted INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),
    last_read_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_read_sequence >= 0),
    scheduler_mode TEXT NOT NULL DEFAULT 'none' CHECK (scheduler_mode IN ('none', 'llm', 'agent')),
    scheduler_llm TEXT,
    scheduler_agent_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`;
}

function hasProtectionBoundaryCheck(createSql: string): boolean {
  return /protection_boundary\s+TEXT\s+CHECK\s*\(\s*protection_boundary\s+IS\s+NULL\s+OR\s+protection_boundary\s+IN\s*\(\s*'discussion_limit_resume'\s*\)\s*\)/i
    .test(createSql);
}

function hasSchedulerPauseReasonCheck(createSql: string): boolean {
  return /pause_reason\s+TEXT\s+CHECK\s*\(\s*pause_reason\s+IN\s*\(\s*'manual'\s*,\s*'limit'\s*,\s*'scheduler'\s*\)\s*\)/i
    .test(createSql);
}

function migrateConversationsPauseReasonCheck(db: Database.Database): void {
  const table = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'conversations'`,
  ).get() as { sql: string | null } | undefined;
  if (!table?.sql || hasSchedulerPauseReasonCheck(table.sql)) return;

  const columns = db.prepare(`PRAGMA table_info(conversations)`).all() as Array<{
    name: string;
  }>;
  const hasColumn = (name: string) => columns.some((column) => column.name === name);
  const indexes = db.prepare(
    `SELECT sql FROM sqlite_master
     WHERE type = 'index'
       AND tbl_name = 'conversations'
       AND sql IS NOT NULL
     ORDER BY name`,
  ).all() as Array<{ sql: string }>;
  const foreignKeysEnabled = db.pragma('foreign_keys', { simple: true }) === 1;

  if (foreignKeysEnabled) db.pragma('foreign_keys = OFF');
  try {
    const rebuild = db.transaction(() => {
      db.exec(conversationsTableSql('conversations_new', false));
      db.exec(`
        INSERT INTO conversations_new (
          id, kind, title, avatar, created_by, agent_message_limit, max_consecutive_speeches,
          max_message_chars, cooldown_ms, paused, pause_reason, pinned, muted,
          last_read_sequence, scheduler_mode, scheduler_llm, scheduler_agent_id,
          created_at, updated_at
        )
        SELECT
          id, kind, title,
          ${hasColumn('avatar') ? 'avatar' : 'NULL'},
          created_by, agent_message_limit, max_consecutive_speeches,
          max_message_chars, cooldown_ms, paused, pause_reason,
          ${hasColumn('pinned') ? 'pinned' : '0'},
          ${hasColumn('muted') ? 'muted' : '0'},
          ${hasColumn('last_read_sequence') ? 'last_read_sequence' : '0'},
          ${hasColumn('scheduler_mode') ? 'scheduler_mode' : `'none'`},
          ${hasColumn('scheduler_llm') ? 'scheduler_llm' : 'NULL'},
          ${hasColumn('scheduler_agent_id') ? 'scheduler_agent_id' : 'NULL'},
          created_at, updated_at
        FROM conversations
      `);
      db.exec(`DROP TABLE conversations`);
      db.exec(`ALTER TABLE conversations_new RENAME TO conversations`);
      for (const index of indexes) db.exec(index.sql);

      const violations = [
        ...(db.pragma(
          'foreign_key_check(conversation_members)',
        ) as Array<Record<string, unknown>>),
        ...(db.pragma(
          'foreign_key_check(conversation_messages)',
        ) as Array<Record<string, unknown>>),
        ...(db.pragma(
          'foreign_key_check(conversation_deliveries)',
        ) as Array<Record<string, unknown>>),
      ];
      if (violations.length > 0) {
        throw new Error('conversations 迁移后外键校验失败');
      }
    });
    rebuild();
  } finally {
    if (foreignKeysEnabled) db.pragma('foreign_keys = ON');
  }
}

function migrateConversationMessagesProtectionBoundary(db: Database.Database): void {
  const table = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'conversation_messages'`,
  ).get() as { sql: string | null } | undefined;
  if (!table?.sql || hasProtectionBoundaryCheck(table.sql)) return;

  const columns = db.prepare(`PRAGMA table_info(conversation_messages)`).all() as Array<{
    name: string;
  }>;
  const hasProtectionBoundary = columns.some((column) =>
    column.name === 'protection_boundary');
  const indexes = db.prepare(
    `SELECT sql FROM sqlite_master
     WHERE type = 'index'
       AND tbl_name = 'conversation_messages'
       AND sql IS NOT NULL
     ORDER BY name`,
  ).all() as Array<{ sql: string }>;
  const foreignKeysEnabled = db.pragma('foreign_keys', { simple: true }) === 1;

  if (foreignKeysEnabled) db.pragma('foreign_keys = OFF');
  try {
    const rebuild = db.transaction(() => {
      db.exec(conversationMessagesTableSql('conversation_messages_new', false));
      db.exec(`
        INSERT INTO conversation_messages_new (
          id, conversation_id, sequence, sender_id, sender_type, content, mentions,
          protection_boundary, created_at
        )
        SELECT
          id, conversation_id, sequence, sender_id, sender_type, content, mentions,
          ${hasProtectionBoundary ? 'protection_boundary' : 'NULL'}, created_at
        FROM conversation_messages
      `);
      db.exec(`DROP TABLE conversation_messages`);
      db.exec(`ALTER TABLE conversation_messages_new RENAME TO conversation_messages`);
      for (const index of indexes) db.exec(index.sql);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_conversation_messages_order
        ON conversation_messages(conversation_id, sequence)
      `);

      const violations = [
        ...(db.pragma(
          'foreign_key_check(conversation_messages)',
        ) as Array<Record<string, unknown>>),
        ...(db.pragma(
          'foreign_key_check(conversation_deliveries)',
        ) as Array<Record<string, unknown>>),
      ];
      if (violations.length > 0) {
        throw new Error('conversation_messages 迁移后外键校验失败');
      }
    });
    rebuild();
  } finally {
    if (foreignKeysEnabled) db.pragma('foreign_keys = ON');
  }
}

function addColumnIfMissing(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.length > 0 && !columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

function migrateConversationMetadataColumns(db: Database.Database): void {
  addColumnIfMissing(
    db,
    'conversations',
    'avatar',
    'avatar TEXT',
  );
  addColumnIfMissing(
    db,
    'conversations',
    'pinned',
    'pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))',
  );
  addColumnIfMissing(
    db,
    'conversations',
    'muted',
    'muted INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1))',
  );
  addColumnIfMissing(
    db,
    'conversations',
    'last_read_sequence',
    'last_read_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_read_sequence >= 0)',
  );
  addColumnIfMissing(
    db,
    'conversations',
    'scheduler_mode',
    `scheduler_mode TEXT NOT NULL DEFAULT 'none' CHECK (scheduler_mode IN ('none', 'llm', 'agent'))`,
  );
  addColumnIfMissing(
    db,
    'conversations',
    'scheduler_llm',
    'scheduler_llm TEXT',
  );
  addColumnIfMissing(
    db,
    'conversations',
    'scheduler_agent_id',
    'scheduler_agent_id TEXT',
  );
}

/**
 * 初始化 SQLite 数据库
 * - 自动建表
 * - 单例模式
 * - 默认路径位于用户数据目录，不写入源码仓库
 */
export function getDB(dbPath?: string): Database.Database {
  if (dbInstance) return dbInstance;

  const finalPath = dbPath ?? join(resolveRuntimeDataDir(), 'company.db');
  const absPath = resolve(finalPath);
  const dir = absPath.substring(0, absPath.lastIndexOf('/'));
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(absPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    initSchema(db);
    dbPathInstance = absPath;
    dbInstance = db;
    return db;
  } catch (error) {
    try {
      db.close();
    } catch {}
    throw error;
  }
}

function initSchema(db: Database.Database): void {
  // 迁移:为已存在的 departments 表加 parent_id 列
  const cols = db.prepare(`PRAGMA table_info(departments)`).all() as any[];
  if (cols.length > 0 && !cols.some((c: any) => c.name === 'parent_id')) {
    db.exec(`ALTER TABLE departments ADD COLUMN parent_id TEXT REFERENCES departments(id) ON DELETE SET NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments(parent_id)`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      boss TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idea',
      phase TEXT NOT NULL DEFAULT 'idea',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      workflow_node_id TEXT,
      workflow_iteration INTEGER NOT NULL DEFAULT 0,
      department TEXT NOT NULL,
      assignee TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      input_files TEXT NOT NULL DEFAULT '[]',
      output_files TEXT NOT NULL DEFAULT '[]',
      output_summary TEXT,
      depends_on TEXT NOT NULL DEFAULT '[]',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);

    CREATE TABLE IF NOT EXISTS workflow_node_outputs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workflow_node_id TEXT NOT NULL,
      workflow_node_type TEXT NOT NULL,
      run_id TEXT NOT NULL,
      iteration INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      input_snapshot TEXT NOT NULL DEFAULT '[]',
      output_text TEXT NOT NULL DEFAULT '',
      output_task_ids TEXT NOT NULL DEFAULT '[]',
      output_file_refs TEXT NOT NULL DEFAULT '[]',
      control_result TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE (project_id, run_id)
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_node_outputs_lookup
      ON workflow_node_outputs (
        project_id, workflow_node_id, iteration, status, completed_at DESC
      );

    CREATE TABLE IF NOT EXISTS deliverables (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT,
      type TEXT NOT NULL,
      path TEXT NOT NULL,
      mime_type TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_deliverables_project ON deliverables(project_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      task_id TEXT,
      channel TEXT NOT NULL,
      from_id TEXT NOT NULL,
      from_name TEXT NOT NULL,
      from_role TEXT,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'message',
      tool_name TEXT,
      tool_input TEXT,
      mentions TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id);
    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

    ${conversationsTableSql()};

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      member_type TEXT NOT NULL CHECK (member_type IN ('human', 'agent')),
      enabled INTEGER NOT NULL DEFAULT 1,
      paused INTEGER NOT NULL DEFAULT 0,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, member_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    ${conversationMessagesTableSql()};

    CREATE INDEX IF NOT EXISTS idx_conversation_messages_order
      ON conversation_messages(conversation_id, sequence);

    CREATE TABLE IF NOT EXISTS conversation_deliveries (
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

    CREATE INDEX IF NOT EXISTS idx_conversation_deliveries_pending
      ON conversation_deliveries(conversation_id, agent_id, status, delivered_at);

    CREATE TABLE IF NOT EXISTS agent_status (
      agent_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'idle',
      current_task_id TEXT,
      last_active_at INTEGER NOT NULL
    );

    -- LLM Providers (Web 配置,运行时)
    CREATE TABLE IF NOT EXISTS llm_providers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,            -- 'anthropic' | 'openai'
      api_key TEXT NOT NULL DEFAULT '',
      endpoint TEXT,
      model TEXT NOT NULL,
      max_tokens INTEGER,
      temperature REAL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Departments (Web 配置,可覆盖 yaml)
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      head TEXT,
      teams TEXT,                   -- JSON array
      parent_id TEXT,               -- 上级部门 id(用于层级)
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES departments(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments(parent_id);

    -- Agents (Web 配置,可覆盖 yaml)
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT,
      department TEXT NOT NULL,
      team TEXT,
      role TEXT NOT NULL,           -- 'head' | 'leader' | 'worker'
      llm TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      tools TEXT NOT NULL DEFAULT '[]',  -- JSON array
      description TEXT,
      avatar TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agents_dept ON agents(department);

    -- 自定义工具(Web 配置)
    CREATE TABLE IF NOT EXISTS custom_tools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,            -- 调用名(agent 勾的就是这个)
      type TEXT NOT NULL,            -- 'http' | 'shell' | 'prompt' | 'cli'
      description TEXT NOT NULL DEFAULT '',
      config TEXT NOT NULL DEFAULT '{}',  -- JSON
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_custom_tools_name ON custom_tools(name);

      -- 公司开发流程(Web 配置)
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        stages TEXT NOT NULL DEFAULT '[]',
        templates TEXT NOT NULL DEFAULT '{}',
        graph TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workflows_updated ON workflows(updated_at);
  `);

  addColumnIfMissing(db, 'workflows', 'graph', 'graph TEXT');
  addColumnIfMissing(db, 'tasks', 'workflow_node_id', 'workflow_node_id TEXT');
  addColumnIfMissing(
    db,
    'tasks',
    'workflow_iteration',
    'workflow_iteration INTEGER NOT NULL DEFAULT 0',
  );
  addColumnIfMissing(
    db,
    'workflow_node_outputs',
    'control_result',
    'control_result TEXT',
  );
  migrateConversationMetadataColumns(db);
  migrateConversationsPauseReasonCheck(db);
  migrateConversationMessagesProtectionBoundary(db);

  // 迁移:为已存在的 agents 表加 skills / executor / cli_tool 列
  // 球球 review 2026-08-16:之前重复声明 agentCols(L211 + L225),单测 tsx 编译报错。已合并。
  const agentCols = db.prepare(`PRAGMA table_info(agents)`).all() as any[];
  if (agentCols.length > 0) {
    if (!agentCols.some((c: any) => c.name === 'skills')) {
      db.exec(`ALTER TABLE agents ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!agentCols.some((c: any) => c.name === 'executor')) {
      db.exec(`ALTER TABLE agents ADD COLUMN executor TEXT NOT NULL DEFAULT 'llm'`);
    }
    if (!agentCols.some((c: any) => c.name === 'cli_tool')) {
      db.exec(`ALTER TABLE agents ADD COLUMN cli_tool TEXT`);
    }
    if (!agentCols.some((c: any) => c.name === 'cli_model')) {
      db.exec(`ALTER TABLE agents ADD COLUMN cli_model TEXT`);
    }
  }

  // 迁移:为已存在的 llm_providers 表加 path 列(自定义 API path,NULL = 走协议标准 path)
  const llmCols = db.prepare(`PRAGMA table_info(llm_providers)`).all() as any[];
  if (llmCols.length > 0 && !llmCols.some((c: any) => c.name === 'path')) {
    db.exec(`ALTER TABLE llm_providers ADD COLUMN path TEXT`);
  }
}

export function getDBPath(): string {
  if (!dbPathInstance) throw new Error('数据库尚未初始化');
  return dbPathInstance;
}

export function closeDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbPathInstance = null;
  }
}
