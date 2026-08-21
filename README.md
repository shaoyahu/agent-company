# 🏢 Agent Company

> 一个可生长的多 agent AI 公司。老板说一句话,各部门 agent 协作完成从 PRD 到交付的全流程。

![status](https://img.shields.io/badge/status-MVP%20v0.1-c97b3f)
![node](https://img.shields.io/badge/node-%3E%3D20-2f6f5e)

## ✨ 特性

- 🤖 **多 LLM provider** — 任意 Anthropic / OpenAI 兼容 endpoint(Claude / GPT / DeepSeek / Moonshot / 通义千问 / OpenRouter 都能用)
- 🏢 **完整公司形态** — 产品 / 设计 / 研发 / QA / 运营 / HR 调度 6 部门,8+ 岗位 agent
- 💬 **多 agent 互相对话** — 像 Slack 群一样,agent 之间能相互 @ 和讨论
- 🌐 **Web Dashboard** — 实时看项目进度、agent 状态、对话流、token 消耗
- 🔧 **对话式配置** — 跟 Mavis 说"加个市场部"自动更新 `company.yaml`
- 🚀 **显式配置** — 未配置真实 LLM 或可用 CLI 时直接报错,不使用 mock fallback

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置真实 LLM(也可稍后在 Web 设置中添加)
cp .env.example .env
# 编辑 .env,填入 ANTHROPIC_API_KEY 或 OPENAI_API_KEY
# 或者直接在 Web 上添加 LLM Provider

# 3. 启动(同时启动 server + web)
npm run dev
```

启动后:
- **Web Dashboard**: http://localhost:5173
- **API Server**: http://localhost:4000
- **CLI**: `npm run ac -- status`

## 📖 目录结构

```
agent-company/
├── server/               # Node.js + TypeScript 后端
│   └── src/
│       ├── llm/          # LLM 抽象(pi-ai bridge,30+ provider)
│       ├── agent/        # Agent runtime + tools
│       ├── store/        # SQLite 存储
│       ├── orchestrator/ # 任务调度
│       └── api/          # REST + WebSocket
├── web/                  # React + Vite 前端
│   └── src/
│       ├── App.tsx       # Dashboard 主页面
│       ├── components/   # Kanban / Settings / Agents
│       └── api/          # API client
├── docs/
│   ├── PLAN.html         # 完整规划方案
│   └── multi-agent-chat-mockup.html  # UI mockup
└── scripts/
    └── ac.mjs            # CLI 工具
```

> ⚠️  **所有配置(部门/Agent/LLM Provider)都在 Web Dashboard 上维护。** `company.yaml` 已废弃,内容会被忽略。
>
> 运行态数据（SQLite、项目工作区、日志）不保存在仓库内。Server 默认使用系统用户数据目录；可通过 `AGENT_COMPANY_DATA_DIR` 指定本地开发目录。不要提交该目录、`.env` 或任何 Provider 密钥。

## 🎮 CLI 用法

```bash
npm run ac -- status                            # 查看公司(LLM + agent)
npm run ac -- list                              # 列出所有项目
npm run ac -- new "做个健康科普网页"            # 新建项目
npm run ac -- tick proj-20260813-abc123         # 推进项目
npm run ac -- show proj-20260813-abc123         # 查看详情
npm run ac -- say proj-xxx "下个版本加上XX"     # 老板发话
```

## ⚙️ 设置 — LLM / Tools / Skills 三块

打开 Web Dashboard → 「设置」页,左侧三个 tab:

### 🧠 LLM Providers
所有 LLM provider 都在这里配。支持 30+ provider(Anthropic / OpenAI / DeepSeek / Moonshot / Mistral / xAI / Groq / OpenRouter / Cloudflare / HuggingFace / Together / Cerebras / Baseten / Vercel / Bedrock / Vertex / Google / ZAI / MiniMax / OpenCode / 智谱 GLM / 通义千问 / 豆包 / 零一万物 / 本地 Ollama ...)— 底层由 [pi-mono](https://github.com/earendil-works/pi) 驱动。改完立即生效。

### 🛠 Tools
- **内置**:`bash` / `read` / `write` / `edit` / `glob` / `grep` / `list_files` / `web_fetch` — 8 个,代码里写死,无需配置
- **自定义**:三种类型
  - `http` — 调远端 webhook,input 作为 body / query
  - `shell` — 出于安全原因已禁用，不能执行 shell 命令模板
  - `prompt` — 渲染 prompt 模板,返回文本
  - 每个自定义 tool 都立刻注册到 runtime,agent 勾选就能用。有"测试"按钮现场跑一次

### 📚 Skills
可复用的领域知识包,每个 skill 是 `~/.minimax/skills/<name>/SKILL.md` 一份带 frontmatter 的 markdown。
agent 启用某个 skill 后,正文会注入到 system prompt(默认截断到 1500 字)。

**安装方式**(4 种):
- **直接写** — 在 Web textarea 里写 frontmatter + body,提交
- **URL** — 给一个 zip 下载地址,自动解压(根目录或单层子目录要有 SKILL.md)
- **上传 zip** — 选本地 zip 文件
- **Hub** — 从 `~/.minimax/skill-hub.json` 选已收录的

**卸载** = 删除本机副本,不动原始来源。

## 🤖 加 Agent / 部门

打开 Web Dashboard → 左侧导航「部门 / Agent」:

- **+ 部门**: 填 ID、名称、负责人
- **+ Agent**: 选模板(PM / 前端 / 后端 / 设计师 / QA / Ops / 全栈 / 数据 / 文案 / 视频 / 插画 / 研究员 一键填充)→ 选 LLM → 勾 **工具**(从设置里的内置 + 自定义里选)→ 勾 **Skills**(从已装里选)→ 写 system prompt → 完成
- 现有 agent 可以 **复制**、**测试**、**对话**、**编辑**、**删除**(全在 web 上)
- **对话**:点 agent 卡片右上角 💬 按钮(hover 才显示)或详情面板「对话」,打开多轮聊天 modal ——
  - LLM agent:多轮 + 工具循环(最多 5 轮),history 在前端维护
  - CLI agent(如 claude code / trae):单轮模式,每条消息独立 spawn 一次,history 拼到 prompt 前
  - 关闭再开同一个 agent,对话会自动续上;点「清空」重置

```yaml
agents:
  - id: my-new-agent
    name: 市场专员
    department: marketing    # 新部门可以加在 departments 里
    role: worker
    llm: claude-sonnet
    systemPrompt: |
      你是市场专员,负责写营销文案...
    tools: [read, write, send_slack]      # send_slack 是自定义 HTTP tool
    skills: [brand-voice]                  # 启用品牌话术 skill
```

或者**对话式**告诉 Mavis:
> "加一个市场部,有个营销 agent 负责写文案,用 claude-sonnet"

Mavis 会自动改 `company.yaml`(后续功能)。

## 🛠 添加部门 / 团队 leader

```yaml
departments:
  - id: marketing
    name: 市场部
    head: my-new-agent    # 部门负责人
```

## 🧰 内置工具

agent 可以用的工具(在 Web 上选):

| 工具 | 别名 | 用途 |
|---|---|---|
| `bash` | | 执行 shell 命令 |
| `read` | `read_file` | 读文件 |
| `write` | `write_file` | 写文件(自动建目录) |
| `edit` | `edit_file` | 精确字符串替换 |
| `glob` | `find` | 文件 glob 匹配 |
| `grep` | `search` | 内容搜索 |
| `list_files` | `list_dir` | 列出目录 |
| `web_fetch` | `web_search` | 抓网页 |

> yaml 里的旧工具名(`read_file` / `write_file` / `list_dir` 等)自动 alias 到新名。

## 🗺 路线图

- [x] **Phase 1 (地基)** — LLM 抽象 / Agent runtime / SQLite / Web Dashboard v1
- [x] **Phase 2 (骨架)** — 6 部门流水线 / 自动全流程 / QA 打回 / Kanban
- [x] **Phase 3 (血肉)** — 全 Web 化配置 / 30+ LLM provider (pi-ai 集成) / 12 模板 / Agent 复制+测试
- [ ] **Phase 4 (能力扩展)** — 多模态(视频/音乐/插画) / 跨项目记忆 / 自我反思

## 📜 License

MIT
