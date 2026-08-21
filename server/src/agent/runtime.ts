import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import type { LLMRegistry } from '../llm/registry.js';
import type { LLMMessage, StreamChunk, ToolCall, ChatResponse } from '../llm/types.js';
import { tools, type ToolContext, type ToolResult } from './tools.js';
import { getSkillsForAgent } from '../skills/scanner.js';
import { runCliAgent } from './cliExecutor.js';
import { discoverCliModels } from './cliModels.js';
import { CustomToolRepo } from '../store/customTools.js';
import { MessageRepo, TaskRepo, AgentStatusRepo, DeliverableRepo } from '../store/repository.js';
import type { AgentConfig, Task } from '../types/company.js';

/**
 * Agent 运行时事件 - 推给前端 / 日志
 */
export type AgentEvent =
  | { type: 'text'; taskId: string; text: string }
  | { type: 'tool_call'; taskId: string; toolCall: ToolCall }
  | { type: 'tool_result'; taskId: string; toolCallId: string; result: ToolResult }
  | { type: 'message'; taskId: string; role: 'user' | 'assistant' | 'tool'; content: string }
  | { type: 'done'; taskId: string; result: TaskRunResult }
  | { type: 'error'; taskId: string; error: string };

export interface TaskRunResult {
  taskId: string;
  success: boolean;
  outputFiles: string[];
  outputSummary: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  error?: string;
}

/**
 * Agent 运行时
 *
 * 负责:
 * 1. 加载 agent config + LLM provider + tools
 * 2. chat loop: 调 LLM → 解析 tool calls → 执行 → 反馈 → 循环
 * 3. 把所有事件 push 给事件订阅者
 * 4. 把消息记录到 message repo(供 dashboard 展示)
 */
export class AgentRuntime {
  private subscribers = new Set<(e: AgentEvent) => void>();
  private messageRepo: MessageRepo;
  private taskRepo: TaskRepo;
  private statusRepo: AgentStatusRepo;
  private deliverableRepo: DeliverableRepo;

  constructor(
    private llmRegistry: LLMRegistry,
    private companyRoot?: string,
  ) {
    this.messageRepo = new MessageRepo();
    this.taskRepo = new TaskRepo();
    this.statusRepo = new AgentStatusRepo();
    this.deliverableRepo = new DeliverableRepo();
  }

  subscribe(handler: (e: AgentEvent) => void): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  private emit(e: AgentEvent): void {
    for (const sub of this.subscribers) {
      try {
        sub(e);
      } catch (err) {
        console.error('[agent] subscriber error:', err);
      }
    }
  }

  /**
   * 跑一个任务
   * - task: 已创建的任务(包含 prompt, inputFiles 等)
   * - agent: 执行任务的 agent 配置
   * - projectDir: 任务工作目录(项目目录)
   * - channel: 消息发到哪个 channel
   */
  async runTask(
    task: Task,
    agent: AgentConfig,
    projectDir: string,
    channel: string = 'general',
    /**
     * 球球 review 2026-08-16:ChatInputBox 思考 + 授权开关真接
     * - thinking: 加 system prompt 指令(让 LLM 主动做 CoT)
     * - autoApprove: 'never' 时危险工具(bash / web_fetch / edit / write)直接返"老板拒绝"错误
     */
    opts: {
      thinking?: boolean;
      autoApprove?: 'always' | 'never' | 'prompt';
    } = {},
  ): Promise<TaskRunResult> {
    const start = Date.now();
    this.statusRepo.setStatus(agent.id, 'busy', task.id);
    this.taskRepo.updateStatus(task.id, 'running');

    // 1. 写一条"开始"消息
    this.messageRepo.create({
      id: randomUUID(),
      taskId: task.id,
      projectId: task.projectId,
      channel,
      fromId: agent.id,
      fromName: agent.name ?? agent.id,
      fromRole: `${agent.department} · ${agent.role}`,
      content: `📋 开始任务: ${task.title}`,
      type: 'system',
      mentions: [],
    });

    try {
      // 分流:executor=cli 直接 spawn 本地 CLI(claude code / trae)
      if (agent.executor === 'cli') {
        if (!agent.cliTool || !agent.cliModel) throw new Error(`Agent '${agent.id}' 未配置 CLI 工具或模型`);
        const cliTool = new CustomToolRepo().getByName(agent.cliTool);
        if (!cliTool) throw new Error(`CLI '${agent.cliTool}' 不存在`);
        const models = await discoverCliModels(cliTool);
        if (!models.available || !models.models.includes(agent.cliModel)) {
          throw new Error(models.error ?? `Agent '${agent.id}' 选择的 CLI 模型 '${agent.cliModel}' 当前不可用`);
        }
        const cliResult = await runCliAgent({ agent, task, projectDir });
        // 流式 emit 完整 output
        this.emit({ type: 'text', taskId: task.id, text: cliResult.output });
        // 写交付物:CLI 跑出的修改在 cwd(projectDir),由用户后续在 ProjectRepo 看
        // 这里不主动列文件
        const finalResult: TaskRunResult = {
          taskId: task.id,
          success: cliResult.success,
          outputFiles: [],
          outputSummary: cliResult.output.slice(0, 500),
          inputTokens: 0,
          outputTokens: 0,
          durationMs: cliResult.durationMs,
          // 球球 review:error 必须透出真实原因(cli 找不到 / 类型错 / 退出码)
          error: cliResult.success
            ? undefined
            : cliResult.exitCode !== null
              ? `exit ${cliResult.exitCode}: ${cliResult.output.slice(0, 200)}`
              : cliResult.output,
        };
        this.taskRepo.recordResult(task.id, {
          outputFiles: finalResult.outputFiles,
          outputSummary: finalResult.outputSummary,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: finalResult.durationMs,
          error: finalResult.error,
        });
        // 写"完成"消息
        this.messageRepo.create({
          id: randomUUID(),
          taskId: task.id,
          projectId: task.projectId,
          channel,
          fromId: agent.id,
          fromName: agent.name ?? agent.id,
          fromRole: `${agent.department} · ${agent.role}`,
          content: finalResult.success
            ? `✅ 完成(${cliResult.command} exit 0,${cliResult.durationMs}ms)\n\n${finalResult.outputSummary}`
            : `❌ 失败: ${finalResult.error}`,
          type: 'system',
          mentions: [],
        });
        this.statusRepo.setStatus(agent.id, 'idle');
        this.emit({ type: 'done', taskId: task.id, result: finalResult });
        return finalResult;
      }

      // executor=llm(默认):走 chat loop
      // 2. 构造 system prompt(把可用工具列出来)
      const toolDefs = tools.listForNames(agent.tools);
      const companyRoot = this.resolveCompanyRoot(projectDir);
      const systemPrompt = this.buildSystemPrompt(agent, toolDefs, companyRoot, opts);

      // 3. 构造 user message(task prompt + 输入文件)
      const userPrompt = await this.buildUserPrompt(task, projectDir);

      // 4. message history
      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      // 5. chat loop
      const result = await this.chatLoop(messages, toolDefs, agent, task, projectDir, channel, opts);

      // 6. 记录结果
      this.taskRepo.recordResult(task.id, {
        outputFiles: result.outputFiles,
        outputSummary: result.outputSummary,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs: Date.now() - start,
        error: result.error,
      });

      // 7. 写交付物
      for (const f of result.outputFiles) {
        this.deliverableRepo.create({
          id: randomUUID(),
          projectId: task.projectId,
          taskId: task.id,
          type: this.inferDeliverableType(f),
          path: f,
          metadata: {},
        });
      }

      // 8. 写"完成"消息
      this.messageRepo.create({
        id: randomUUID(),
        taskId: task.id,
        projectId: task.projectId,
        channel,
        fromId: agent.id,
        fromName: agent.name ?? agent.id,
        fromRole: `${agent.department} · ${agent.role}`,
        content: result.success
          ? `✅ 完成: ${result.outputSummary || task.title}\n📁 产出: ${result.outputFiles.join(', ') || '(无文件)'}`
          : `❌ 失败: ${result.error}`,
        type: 'system',
        mentions: [],
      });

      this.statusRepo.setStatus(agent.id, 'idle');

      this.emit({ type: 'done', taskId: task.id, result });
      return result;
    } catch (e: any) {
      const error = e.message ?? String(e);
      this.taskRepo.recordResult(task.id, {
        outputFiles: [],
        outputSummary: '',
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - start,
        error,
      });
      this.statusRepo.setStatus(agent.id, 'idle');
      this.emit({ type: 'error', taskId: task.id, error });
      return {
        taskId: task.id,
        success: false,
        outputFiles: [],
        outputSummary: '',
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - start,
        error,
      };
    }
  }

  private buildSystemPrompt(agent: AgentConfig, toolDefs: any[], companyRoot?: string, opts: { thinking?: boolean; autoApprove?: 'always' | 'never' | 'prompt' } = {}): string {
    const toolsList = toolDefs
      .map((t) => `- **${t.name}**: ${t.description}`)
      .join('\n');

    // Skills:如果 agent 配了 skills,扫描本地 + 注入正文摘要
    let skillsSection = '';
    if (companyRoot && agent.skills && agent.skills.length > 0) {
      const skillBodies = getSkillsForAgent(companyRoot, agent.skills);
      if (skillBodies.length > 0) {
        skillsSection = `

# 启用的 Skills
你应该遵循以下 skill 的约定(完整文件可读 ~/.minimax/skills/<name>/SKILL.md):

${skillBodies
  .map(
    (s) => `## ${s.name}
${s.description ? `> ${s.description}\n` : ''}
${s.body}`,
  )
  .join('\n\n---\n\n')}`;
      }
    }

    // 球球 review 2026-08-16:思考 toggle 真接 — system prompt 加指令影响 LLM 行为
    const thinkingMode = opts.thinking !== false; // 默认 true
    const thinkingHint = thinkingMode
      ? '\n# 思考模式\n你在动手前先在脑里过一遍计划:任务要做什么、用什么工具、可能的边界。\n不要直接跳到执行 — 简单分步骤思考后再调工具。\n'
      : '\n# 直答模式\n不要思考,不要解释,直接给结论或直接调工具。\n简短精炼,1-2 句话回复。\n';

    // 球球 review 2026-08-16:授权 toggle 真接 — 在 system prompt 提示"危险工具需确认"语义
    const approveMode = opts.autoApprove ?? 'never';
    const approveHint = approveMode === 'never'
      ? '\n# 授权模式: 绝不执行\n当前老板设了"从不授权" — 你可以读取(read/list_files/glob/grep),但任何"修改/执行"工具(edit/write/bash/web_fetch)都不要调,直接告知用户需要老板同意。\n'
      : approveMode === 'prompt'
        ? '\n# 授权模式: 每次询问\n当前运行环境无法接收逐次确认。你可以读取(read/list_files/glob/grep)，但不得调用修改、执行或联网工具；请说明需要用户确认的操作。\n'
        : '';  // 'always' 模式不加额外提示,跟以前一样

    return `${agent.systemPrompt}

# 你的身份
- 名字: ${agent.name ?? agent.id}
- 部门: ${agent.department}${agent.team ? ` / ${agent.team}` : ''}
- 角色: ${agent.role}

# 工作方式
1. 阅读任务,理解目标
2. 必要时用工具探索环境(read/list_files/glob/grep)
3. 写文件/执行命令完成任务
4. 完成后用一句话总结你做了什么(用 final_summary tool 或者直接说)

# 可用工具
${toolsList}
${skillsSection}
${thinkingHint}${approveHint}
# 输出要求
- 中文回复
- 简短精炼,不啰嗦
- 工具调用要果断,别问无关问题
`;
  }

  private async buildUserPrompt(task: Task, projectDir: string): Promise<string> {
    const parts: string[] = [];
    parts.push(`# 任务: ${task.title}\n${task.prompt}`);

    if (task.inputFiles.length > 0) {
      parts.push(`\n# 输入文件(你可以用 read tool 查看)\n${task.inputFiles.map((f) => `- ${f}`).join('\n')}`);
    }

    parts.push(`\n# 工作目录\n${projectDir}\n所有写操作都相对于此目录。`);

    return parts.join('\n');
  }

  private async chatLoop(
    messages: LLMMessage[],
    toolDefs: any[],
    agent: AgentConfig,
    task: Task,
    projectDir: string,
    channel: string,
    opts: { thinking?: boolean; autoApprove?: 'always' | 'never' | 'prompt' } = {},
  ): Promise<TaskRunResult> {
    const maxIterations = 30; // 防死循环
    let totalInTokens = 0;
    let totalOutTokens = 0;
    const producedFiles = new Set<string>();
    let finalSummary = '';
    const ctx: ToolContext = {
      cwd: projectDir,
      companyRoot: this.resolveCompanyRoot(projectDir),
      agentId: agent.id,
      taskId: task.id,
    };

    // 球球 review 2026-08-16:授权 'never' 模式 — 危险工具直接返"老板拒绝"错误
    // 危险工具列表:bash / write / edit / web_fetch(只读工具 read/glob/grep/list_files 不挡)
    const DANGEROUS_TOOLS = new Set(['bash', 'write', 'edit', 'web_fetch']);
    const autoApprove = opts.autoApprove ?? 'never';

    for (let i = 0; i < maxIterations; i++) {
      // 调 LLM
      // 球球要求"完全不要 mock,走不通就报错"——之前的 getOrMock 会在 agent.llm
      // 找不到或类型是 mock 时静默 fallback,导致任务跑出"假装成功"的内容。
      // 现在改成显式:agent 启动前必须配好真实 LLM,否则直接抛错。
      const provider = this.llmRegistry.get(agent.llm);
      if (!provider) {
        throw new Error(
          `Agent "${agent.name}" 引用了不可用的 LLM "${agent.llm}"。` +
          `请在「设置 → LLM」里加一个 provider,然后把 agent 的 LLM 字段改成真实 provider id。`,
        );
      }
      let response: ChatResponse;
      try {
        response = await provider.chat({
          messages,
          tools: toolDefs,
          metadata: { agentId: agent.id, taskId: task.id },
        });
      } catch (e: any) {
        return {
          taskId: task.id,
          success: false,
          outputFiles: [...producedFiles],
          outputSummary: finalSummary,
          inputTokens: totalInTokens,
          outputTokens: totalOutTokens,
          durationMs: 0,
          error: `LLM call failed: ${e.message}`,
        };
      }

      totalInTokens += response.usage.inputTokens;
      totalOutTokens += response.usage.outputTokens;

      // 把 assistant 消息加进 history
      messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });

      // 推送文本
      if (response.text) {
        this.emit({ type: 'text', taskId: task.id, text: response.text });
        this.messageRepo.create({
          id: randomUUID(),
          taskId: task.id,
          projectId: task.projectId,
          channel,
          fromId: agent.id,
          fromName: agent.name ?? agent.id,
          fromRole: `${agent.department} · ${agent.role}`,
          content: response.text,
          type: 'message',
          mentions: [],
        });
        // 检测"总结"标识
        const sumMatch = response.text.match(/\[SUMMARY\]([\s\S]*?)\[\/SUMMARY\]/);
        if (sumMatch) finalSummary = sumMatch[1]!.trim();
      }

      // 没有 tool call → 结束
      if (response.toolCalls.length === 0 || response.stopReason === 'end_turn') {
        if (!finalSummary && response.text) {
          finalSummary = response.text.slice(0, 300);
        }
        break;
      }

      // 执行 tool calls
      const toolResults: { id: string; result: ToolResult }[] = [];
      for (const tc of response.toolCalls) {
        this.emit({ type: 'tool_call', taskId: task.id, toolCall: tc });
        this.messageRepo.create({
          id: randomUUID(),
          taskId: task.id,
          projectId: task.projectId,
          channel,
          fromId: agent.id,
          fromName: agent.name ?? agent.id,
          fromRole: `${agent.department} · ${agent.role}`,
          content: `${tc.name}(${JSON.stringify(tc.input).slice(0, 200)})`,
          type: 'tool',
          toolName: tc.name,
          toolInput: tc.input,
          mentions: [],
        });

        const handler = tools.get(tc.name);
        if (!handler) {
          const result: ToolResult = { success: false, output: `Unknown tool: ${tc.name}` };
          toolResults.push({ id: tc.id, result });
          continue;
        }

        // 球球 review 2026-08-16:授权 'never' 模式真接 — 危险工具直接拒绝
        if ((autoApprove === 'never' || autoApprove === 'prompt') && DANGEROUS_TOOLS.has(tc.name)) {
          const result: ToolResult = {
            success: false,
            output: autoApprove === 'prompt'
              ? `🚫 当前运行环境无法处理逐次确认，拒绝执行危险工具 ${tc.name}。请由用户显式改为“始终授权”后重试。`
              : `🚫 老板设了"从不授权",拒绝执行危险工具 ${tc.name}。请由用户显式改为“始终授权”后重试。`,
          };
          toolResults.push({ id: tc.id, result });
          this.emit({ type: 'tool_result', taskId: task.id, toolCallId: tc.id, result });
          continue;
        }
        let result: ToolResult;
        try {
          result = await handler(tc.input, ctx);
        } catch (e: any) {
          result = { success: false, output: e.message };
        }
        if (result.producedFiles) {
          for (const f of result.producedFiles) producedFiles.add(f);
        }
        toolResults.push({ id: tc.id, result });
        this.emit({ type: 'tool_result', taskId: task.id, toolCallId: tc.id, result });
        this.messageRepo.create({
          id: randomUUID(),
          taskId: task.id,
          projectId: task.projectId,
          channel,
          fromId: 'tool',
          fromName: tc.name,
          content: result.output.slice(0, 5000),
          type: 'tool',
          toolName: tc.name,
          mentions: [],
        });
      }

      // 反馈给 LLM
      for (const tr of toolResults) {
        messages.push({
          role: 'tool',
          toolCallId: tr.id,
          content: tr.result.output,
        });
      }
    }

    return {
      taskId: task.id,
      success: true,
      outputFiles: [...producedFiles],
      outputSummary: finalSummary || '任务完成(无总结)',
      inputTokens: totalInTokens,
      outputTokens: totalOutTokens,
      durationMs: 0,
    };
  }

  private resolveCompanyRoot(projectDir: string): string {
    return this.companyRoot ?? resolve(projectDir, '..', '..');
  }

  private inferDeliverableType(path: string): 'prd' | 'design' | 'code' | 'test' | 'doc' | 'video' | 'audio' | 'image' | 'other' {
    if (path.includes('prd') || path.endsWith('prd.md')) return 'prd';
    if (path.includes('design') || path.match(/\.(png|jpg|jpeg|fig|sketch)$/i)) return 'design';
    if (path.includes('test') || path.match(/test|spec/i)) return 'test';
    if (path.match(/\.(ts|tsx|js|jsx|py|go|rs|java|cpp|c|h)$/)) return 'code';
    if (path.match(/\.(mp4|mov|avi)$/i)) return 'video';
    if (path.match(/\.(mp3|wav|flac)$/i)) return 'audio';
    if (path.match(/\.(md|txt|rst)$/i)) return 'doc';
    return 'other';
  }
}
