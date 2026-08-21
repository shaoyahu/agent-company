#!/usr/bin/env node
/**
 * ac - Agent Company CLI
 *
 * 命令:
 *   ac start              启动 server (dev mode)
 *   ac status             查看公司状态
 *   ac list / ac ls       列出项目
 *   ac new <title>        新建项目
 *   ac tick <project-id>  推进项目
 *   ac show <project-id>  查看项目详情
 *   ac say <project-id> <msg>  老板发消息
 *   ac web                打开 dashboard
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = process.env.PORT ?? 4000;
const BASE = `http://localhost:${PORT}/api`;

const args = process.argv.slice(2);
const cmd = args[0];

function log(o) {
  if (typeof o === 'string') console.log(o);
  else console.log(JSON.stringify(o, null, 2));
}

async function http(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    console.error(`❌ HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}

function loadYamlConfig() {
  const path = resolve(ROOT, 'company.yaml');
  if (!existsSync(path)) {
    console.error('❌ company.yaml 不存在,先 `npm run init`');
    process.exit(1);
  }
  return readFileSync(path, 'utf-8');
}

switch (cmd) {
  case 'start':
    console.log('🚀 启动 server...');
    console.log('提示:请在另一个终端运行 `cd ' + ROOT + ' && npm run dev -w server`');
    console.log('或者运行 `npm run dev` (同时启动 server + web)');
    break;

  case 'init':
    console.log('⚠️  init 命令已废弃。所有配置在 Web Dashboard 上完成:');
    console.log('   1. npm run dev');
    console.log('   2. 打开 http://localhost:5173');
    console.log('   3. 左侧导航「部门 / Agent」配置组织');
    break;

  case 'status':
    const info = await http('GET', '/company');
    log(`🏢 ${info.name}`);
    log(`👤 老板: ${info.boss}`);
    log(`\n📦 LLM Providers (${info.providers.length}):`);
    for (const p of info.providers) {
      log(`   • [${p.type}] ${p.id} → ${p.model}${p.endpoint ? ' @ ' + p.endpoint : ''}`);
    }
    log(`\n🤖 Agents (${info.agents.length}):`);
    for (const a of info.agents) {
      log(`   • [${a.role}] ${a.id} (${a.department}${a.team ? '/' + a.team : ''}) → ${a.llm}`);
    }
    break;

  case 'list':
  case 'ls':
    const projects = await http('GET', '/projects');
    if (projects.length === 0) {
      log('(暂无项目)运行 `ac new "项目名"` 创建一个');
    } else {
      for (const p of projects) {
        const bar = '█'.repeat(Math.floor((getPhaseProgress(p.phase)) * 20)).padEnd(20, '░');
        log(`${p.id}  ${bar}  ${p.status.padEnd(8)}  ${p.title}`);
      }
    }
    break;

  case 'new': {
    const title = args[1];
    if (!title) {
      console.error('用法: ac new "项目标题"');
      process.exit(1);
    }
    const cfg = loadYamlConfig();
    // 找第一个 dev agent 作为初始 assignee
    const firstDevMatch = cfg.match(/id:\s*([\w-]+)[\s\S]*?department:\s*dev[\s\S]*?role:\s*(head|worker)/);
    const assignee = firstDevMatch?.[1] ?? 'dev-frontend-1';
    const project = await http('POST', '/projects', {
      title,
      description: args.slice(2).join(' ') || undefined,
      initialTasks: [
        {
          phase: 'prd',
          dept: 'product',
          title: '写产品需求文档',
          prompt: `为"${title}"写一份简洁的 PRD,包括:\n1. 目标用户\n2. 核心功能(3-5 个)\n3. 关键页面 / 流程\n4. 验收标准\n\n输出到 prd.md。`,
          assignee: 'dev-frontend-1', // Phase 1 简化:先用一个 agent 走通
        },
      ],
    });
    log(`✅ 项目已创建: ${project.id}`);
    log(`   标题: ${project.title}`);
    log(`\n下一步: 启动 server 后,运行`);
    log(`   ac tick ${project.id}`);
    break;
  }

  case 'tick': {
    const id = args[1];
    if (!id) {
      console.error('用法: ac tick <project-id>');
      process.exit(1);
    }
    const project = await http('POST', `/projects/${id}/tick`);
    log(`项目 ${project.id} → ${project.phase} (${project.status})`);
    break;
  }

  case 'show': {
    const id = args[1];
    if (!id) {
      console.error('用法: ac show <project-id>');
      process.exit(1);
    }
    const data = await http('GET', `/projects/${id}`);
    log(`📋 ${data.project.title} (${data.project.id})`);
    log(`   状态: ${data.project.status} / phase: ${data.project.phase}`);
    log(`\n📝 任务 (${data.tasks.length}):`);
    for (const t of data.tasks) {
      const icon = t.status === 'done' ? '✅' : t.status === 'running' ? '🔄' : t.status === 'failed' ? '❌' : '⏳';
      log(`   ${icon} [${t.phase}] ${t.title} → ${t.assignee} (${t.status})`);
    }
    log(`\n💬 最近消息 (${data.messages.length}):`);
    for (const m of data.messages.slice(-10)) {
      log(`   [${m.fromName}]: ${m.content.slice(0, 100)}`);
    }
    break;
  }

  case 'say': {
    const id = args[1];
    const content = args.slice(2).join(' ');
    if (!id || !content) {
      console.error('用法: ac say <project-id> "消息内容"');
      process.exit(1);
    }
    await http('POST', `/projects/${id}/say`, { content });
    log('✅ 消息已发送');
    break;
  }

  case 'web':
    log(`🌐 打开 http://localhost:5173 (启动 web: npm run dev -w web)`);
    break;

  case 'help':
  case '--help':
  case '-h':
  default:
    log(`ac - Agent Company CLI

用法:
  ac init                          初始化 company.yaml
  ac start                         启动 server
  ac status                        查看公司状态(LLM / agents)
  ac list                          列出项目
  ac new "项目标题"                新建项目
  ac tick <project-id>             推进项目一个 step
  ac show <project-id>             查看项目详情
  ac say <project-id> "消息"       老板发消息
  ac web                           打开 web dashboard 地址

示例:
  ac init
  ac new "做个健康科普网页"
  ac tick proj-1234-abc
  ac show proj-1234-abc
`);
    break;
}

function getPhaseProgress(phase) {
  const map = { idea: 0.1, prd: 0.25, design: 0.4, dev: 0.6, qa: 0.8, delivery: 0.95, done: 1, failed: 0.5 };
  return map[phase] ?? 0;
}
