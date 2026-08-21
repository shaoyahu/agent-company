# AGENTS.md — Agent Company 项目的工程硬约束

> 给所有 AI agent / 人类贡献者看的协作规范。这些不是建议,是**踩过的坑总结出来的硬约束**。
> 球球 2026-08-15 / 2026-08-16 多轮 review 后沉淀。

---

## 0. 测试必写(球球 2026-08-15 反复强调)

**所有核心函数 + 所有接口都要有单测或接口测试。** "所有" = 真的所有,不是核心。

- 跑法:
  ```bash
  cd server && npm test            # unit + smoke
  cd web && npm run test:unit
  ```
- 工具:`node:test` (内置) + `tsx` (跑 .ts) — 0 新依赖
- 期望覆盖率:**server unit 380+ / smoke 25+ / web unit 67+**(2026-08-16 现状)
- 单测抓真 bug 才是有用的(本次 5 个真 bug 都是写测试时抓到):
  - `isPrivateIPv6` fe80::/10 漏 fe81-febf 段
  - `db.ts` 重复声明 `agentCols`
  - `message-bus.ts` 中文 @mention regex
  - `chat-router.ts` unhandledRejection
  - `agent/tools.ts` alias resolveName 失效
  - `helperAgent.ts` ESM 用了 `require('node:fs')`
  - `runtime.ts` cli 失败详情丢失

---

## 1. 端点路径必须前后端一致(球球 review 触发)

任何 API endpoint,**server 路径和 client 调用路径必须 1:1 匹配**。

- 之前踩过坑:`/api/apply-template` (server) vs `/api/templates/apply` (client) → 404
- 修法:
  1. `server/test/api.smoke.test.mjs` 列了**所有端点表**(20+ 条),跑 `npm run test:smoke` 验证
  2. `web/test/unit/api.test.ts` 锁住每个 `api.*` 方法的 URL + method
  3. 任何新接口先在两边文件加测试,再写实现

---

## 2. "key→obj.xxx" 查表必须 `?? default` 兜底(2026-08-16 踩)

任何**用动态 key 查表然后访问属性**的代码,必须有兜底:

```ts
// ❌ 错:未知 key 返 undefined,后续 .xxx 崩
const meta = TYPE_META[t.type];
const Icon = meta.icon;  // TypeError: Cannot read properties of undefined

// ✅ 对:抽 getXxx() 工具函数统一兜底
export function getToneMeta(tone: string) {
  return TONE_META[tone] ?? TONE_META.info;
}
const meta = getToneMeta(tone);
const Icon = meta.Icon;  // 安全
```

**适用场景**:
- `KEY[dynamicKey].field` 查 tone / role / status / type / platform id
- `arr.find(x => x.id === id).field` — `find` 返 undefined 后访问
- `company.providers.find(p => p.id === a.llm).model` — 同上
- 后端返的对象字段(后端 schema 升级漏字段,前端崩)

**已抽出的兜底函数**:
- `getToneMeta(tone)` in `web/src/components/ui/Toast.tsx` — 未知 tone 走 `info`
- `getTagToneStyle(tone)` in `web/src/components/ui/Tag.tsx` — 未知 tone 走 `neutral`
- `typeMeta(t)` in `web/src/components/settings/ToolsSettings.tsx` — 未知 type 走 `cli`
- `PlatformIcon` 内部 `if (!Icon) 渲染 ◇` fallback

**回归测试**:`web/test/unit/lookups.test.ts` — 用 `undefined / null / '' / __proto__ / constructor` 攻击,验证所有兜底函数不抛。

---

## 3. Server 端 schema 字段必须显式定义(防漂移)

`server/src/api/server.ts` 每个 endpoint 的返回对象字段:
- **加新字段**必须同步:`web/src/api/client.ts` 的类型 + 前端所有访问点
- **删字段**必须同步:所有前端消费者
- 防御做法:前端访问 `company.providers` 等用 `?.length ?? 0` 兜底(server schema 升级过渡期不会崩)

---

## 4. 不 mock,走不通就报错(球球硬约束)

- **完全不要 mock fallback** — 之前 `getOrMock()` 让任务"假装成功"是 P0 bug
- LLM provider 拿不到:`throw new Error(...)`,前端 toast 显示真实错因
- agent 找不到 LLM:`throw new Error("Agent 'X' 引用了不可用的 LLM 'Y'")`
- CLI tool 找不到 / 类型错:错误信息必须**透出真实原因**(不要只拼 `exit null`)
- 后端错因必须透出前端:`http()` helper 解析 `{ error, message }` body 塞到 `Error.message`

---

## 5. 持久化分层(球球 2026-08-15 决定)

| 类型 | 存哪 | 例子 |
|---|---|---|
| 系统配置 | SQLite (db) | LLM Provider / Department / Agent / Custom Tool |
| 个人偏好 | localStorage | UI 设置(密度/字号/圆角) / Sidebar 折叠态 / Settings tab |
| Skills | 文件系统 | `~/.minimax/skills/<name>/SKILL.md` |

**不要把个人偏好塞 db**(会跨用户串),**不要把系统配置塞 localStorage**(会跨设备丢)。

---

## 6. Modal 滚动规范(球球 2026-08-15)

**`Modal` 组件 body 默认 `overflow-y: auto`** — 滚动责任在 Modal 自己,不要让 caller 自己加。
- 11 个 Modal 调用点都受益,无需在每个 caller 写 `overflow-y: auto`
- LLM 弹窗左右栏有内部滚动不冲突(子元素 overflow 优先)

---

## 7. 下拉框必须用 `<Select />` 组件(球球硬约束)

```tsx
// ❌ 错:原生 <select> + inline style
<select style={selectStyle}>...</select>

// ✅ 对:统一组件,跟随 ui settings
<Select value={x} onChange={setX} options={[{ value, label }]} />
```

组件位置:`web/src/components/ui/Select.tsx`,支持 size / error / placeholder / disabled。

---

## 8. Toast 规范

- 位置:**右上角** `top: 16, right: 16`(离操作区最近)
- 宽度:**380px**
- danger tone 8s 自动关闭,**ERROR 徽章**
- 鼠标 hover 暂停计时 + 显示「⏸ 已暂停」
- 最多堆 5 个
- **err.message 必须透出后端 `{ error }` / `{ message }` 字段**(不只是 "HTTP 400")

---

## 9. 路由用 History API,不用 hash

- 不要用 `location.hash` 切换 view
- 用 `parseRoute(pathname)` / `navigate(view, projectId)` helper
- `App.tsx` 监听 `popstate` 同步 state
- Vite SPA fallback 自动支持(`/agents` `/project/abc` 全部 200)

---

## 10. SectionHeader 双层 hierarchy

每个 section:
```tsx
<SectionHeader eyebrow="CATEGORY" title="可读标题" count={n} meta="补充" />
```
- `eyebrow` = 分类(uppercase 小字)
- `title` = 实际标题
- 不要把分类和标题堆一行(信息密度低)

---

## 11. 密度设计原则(球球硬约束)

- 菜单项高度 ≥ **40px**
- 导航项间距 ≥ **2px**
- 三档 density 改成**连续 Slider**(0.5-2.0 系数),用户偏好无极调节
- 字号 10-26px / 圆角 0-24px 同样 Slider
- onChange 实时 apply CSS,onCommit 才 PUT 持久化(避免拖动时 100+ 次写库)
- 严格 throw > 静默 clamp:越界值直接 throw 400

---

## 12. 不联动原则(2026-08-15)

**任何两个独立维度都不应被隐式联动**。如 selectModel 不再自动 setP,平台列表点 model 才显式 setP。

UI 字段不自动填默认值,要么用户手填,要么显式从列表选,要么批量配。

---

## 13. JSON.parse 必 try/catch

`localStorage` / `req.body` / `WebSocket message` 任何来源的 JSON.parse 必须在 try/catch 里。**Web 端任何 outer 范围的 JSON.parse 必须包 try**。

---

## 14. find() 后访问属性必判空

```ts
// ❌ 错
const d = depts.find(x => x.id === id);
return d.name;  // 可能崩

// ✅ 对
const d = depts.find(x => x.id === id);
if (!d) return null;
return d.name;

// 或 inline
const d = depts.find(x => x.id === id);
return d ? d.name : null;
```

---

## 15. hostile input 测试必跑

任何对外函数(getter / parser / lookup)的单测,必须包含:
- `undefined` / `null` / `''` / `'   '`
- 字符串 `'__proto__'` / `'constructor'`(防原型链攻击)
- 超界数值(对 RANGES 类型的字段)

参考:`web/test/unit/lookups.test.ts`。

---

## 16. macOS 测试陷阱

- **没有 `/bin/false`**,用 `/bin/sh -c "exit 1"` 模拟非 0 退出
- macOS 上 `os.homedir()` **会**响应 `process.env.HOME`(可以测时换 HOME 到 temp)
- `process.chdir()` 改 cwd 后,要在 after 还原

---

## 17. ESM context 不能用 require

```ts
// ❌ 错
import { readFileSync } from 'node:fs';
function x() { return require('node:fs').readFileSync(...); }  // ReferenceError

// ✅ 对
import { readFileSync } from 'node:fs';
function x() { return readFileSync(...); }
```

`package.json` `"type": "module"` 下 `require` 是 undefined。`grep "require(" src/` 应在 import 块外没有命中。

---

## 18. mock 设计陷阱(测试自己)

测试时如果 mock 一个 EventEmitter,内部 emit 触发订阅者形成**递归回路**会让 OOM:
- 例:`ChatRouter` 订阅 `bus.on('message')`,内部 `bus.publish()` 触发自己 → 无限循环
- 修法:mock 的 `publish()` 不要 emit,测试用 `deliver()` helper 显式触发

参考:`server/test/unit/chatRouter.test.ts` 的 `FakeBus` + `deliver()`。

---

## 19. service registry mock

测试时如果 service 注册要过 env 校验(apiKey 必填之类),**直接操作内部 map 跳过 register 路径**:

```ts
(reg as any).providers.set('p1', fakeProvider);
(reg as any).metadata.set('p1', { source: 'test', enabled: true, model: 'm1', type: 'openai' });
```

避免 createPiProvider 调 pi-ai 内部 catalog(可能抛错或返回不可用对象)。

参考:`server/test/unit/orchestrator.test.ts` 的 `makeOrchestrator`。

---

## 20. db fixture 测试隔离

`getDB(path)` 接受 path + `closeDB()` 让重置。
- `before / after` 模式:套件级别 freshDB
- `beforeEach` 模式:truncate 表(保留 schema)
- Repo 测试涉及外键时:seed 父表行

参考:`server/test/helpers/db.ts` + 各 store/repo 测试。

---

## 21. 不要扩大 scope

- 修 bug 时**只改 bug**,不要顺手改无关代码
- 拒绝"千篇一律的 AI 套话"开头(球球 2026-08-15 明确反对)
- 拒绝"自动化配" / 隐式联动(球球 2026-08-15 明确反对)
- 改完不**总结自己的所有改动当业绩**(球球偏好直接给方案)

---

## 22. 中文硬约束

- UI 文案**全部中文**
- 错因消息中文
- 注释 / commit / skill 文档中文
- 标识符(code / path / CLI)保留英文
