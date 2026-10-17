# 新对话接手手册（HANDOVER）

> 目的：让一个没有历史上下文的新对话，在 ~10 分钟内理解本项目并安全接手。
> 配套：`README.md`（用户向快速开始）· `private/DEVLOG.md`（完整逐轮开发日志，gitignored，本机可读）。

## 1. 这是什么

DSH（DeepSeek Harness）的**智能体团队插件**：把 `templates/` 模板目录变成 Agent Teams
一键部署能力，并提供团队图谱工作台（成员星环 + 共享任务瀑布 + 管理浮窗）与一条**统一命令执行层**。

- **双端模型**：
  - `lib/index.js`（cordis 服务端）：安装 4 个部署工具（按 Agent scope，部署类 Lead-only）、
    注册唯一 slash 指令 `/dsh-agent`（import|member|task 三子命令）、JSON-RPC 路由。
  - `lib/client.js`（ModuleLoader 客户端 bundle，零构建）：注入 conversation.view 的
    「Agent 管理」tab（id `expert-team-templates`），渲染模板库 + 当前团队图谱。
- **执行内核** = 官方 `@deepseek-ai/dsh-experimental-agent-team`（agentTeam 投影/tasks/spawn）。
- **统一执行层**：GUI 浮窗按钮走 `POST /plugins/dsh-expert-team/<action>`（JSON RPC）
  → `resolveLeadAgent` → `buildActionRoutes`（缓存 `cachedAgentRoutes`）→ 与 `/dsh-agent`
  同一执行函数（`runAgentCommand`/`create*Command(...).handler()`）。**GUI 就是直呼 CLI**。

## 2. 代码地图

| 路径 | 职责 |
|---|---|
| `lib/index.js` | 服务端：工具安装、`/dsh-agent` 指令、RPC 路由、ANSI 彩色 banner |
| `lib/client.js` | 客户端：模板 tab + `CurrentTeamCanvas` 图谱（星环/瀑布/浮窗/活动光点） |
| `lib/templates.js` | 模板发现/解析（`DSH_EXPERT_TEAM_TEMPLATES` 可覆盖根目录） |
| `lib/deploy.js` | 模板 → spawn 请求 + 团队协作铁律 |
| `templates/` | members/<name>/（member.json + agent.md）· teams/<name>/（team.json）· skills/ |
| `archive/` | 成员归档快照（gitignored） |
| `test/cdp-e2e.cjs` | e2e：43 项 marks 断言（文本/源码双面） |
| `test/e2e-boot.ps1` | **一键回归**：profile 自愈 + 起服务 + 跑测 + 清理 |
| `test/resource-probe.cjs` | 资源审计探针 |
| `test/handler-unit.mjs` | 命令 handler 单元测试 |
| `test/legacy/` | 历史一次性 CDP 探针（保留存档，勿再引用） |

## 3. 核心机制（改代码前必读）

### 3.1 团队数据源 = 投影 ∪ 官方会话目录（历史 bug 重灾区）

`CurrentTeamCanvas`（约 `lib/client.js` L1038 起）成员解析链（**hooks 之前，纯数据变换**）：

1. `leadId`：当前会话行 `parentId` → `subagent.address.parentSessionId` → `header.parentSession` → 自己。
2. `team` = `snap.projectionsBySession[leadId].values.agentTeam`（rich：members/tasks/status/running）。
3. `members` = 投影 members（剔除 `id === leadId` 的"幽灵 lead"）**∪** `buildOfficialTeams(byId)[leadId]`
   （官方会话行父子分组，R56l 并轨）。
4. n===0 时的回退链：投影反向隶属 → 投影单团队代偿 → 官方 byId 源（本会话归属/单团队）→
   多团队索引空态。**代理时 `proxyNote` 横幅提示。**

官方父子关系 = `row.origin === "subagent" && row.parentId`（与宿主
`ConversationSession.deriveAncestry` 同源）；`buildOfficialTeams` 用此 + 旧字段兜底。

> ⚠️ `snap.byId` 需等 store 水合（首渲染可能空）；诊断日志（`[dsh-expert-team] current-team
> empty|body |`）已做水合感知重发（≤4 次）与行形状采样——调试现场用它们，别猜。

### 3.2 布局与 hooks 纪律

- 布局 localStorage key：`dsh-expert-team-graph-v4-<leadId>`；`cvLoadLayout` 迁移链 + **缺位补齐**
  （`ensureRing`，roster 重建后旧布局缺新成员名 → 补默认环形位，否则全体叠成一个点"看起来空"）。
- `stLay` 重载依赖 `memberSig`（leadId + 成员 id 串）：切会话 / byId 水合后成员变化都会重算布局。
- **铁律**：画布组件所有 `react.useState/useEffect/useRef` 必须位于空态早退（`if (n === 0) return`）
  **之前**，否则 React #310（hooks 数量变化）崩溃。新的回退/合并逻辑一律放数据区（hooks 之前）。

### 3.3 其他注意

- 槽位注入：`conversation.view`（tab 列表槽）`id: expert-team-templates, order: 30`。
  宿主某些会话由主框架 `(mf)` 声明该槽导致外部 entry 失败——这是 host 语义，**不是我们的 bug**
  （历史 Console 的 `children register failed` 刷屏来自 dsh-worktab 的 HMR 循环，与本插件无关）。
- 部署工具名/`/dsh-agent` 子命令名是 **公共契约**：文档、e2e marks、浮窗 RPC 全都按这些名字走，
  改名必须三处同步（lib/index.js 命令定义、lib/client.js UI 文案、test/cdp-e2e.cjs marks）。
- `members/row.name` 在星环/浮窗/CAS 锁里都是身份键：roster 只增不减、名字不复用（部署即契约）。

## 4. 验证（一轮改完必跑）

```powershell
# 一键 e2e 回归（自愈 web-e2e profile + 启动 + headless chrome + 43 marks + 清理）
pwsh -NoProfile -File test/e2e-boot.ps1
```

- 43 项 marks 全部文本断言：**client 文案或源码改了、服务端命令定义了，必须同步更新相关 mark**，
  否则回归必红（已知雷：`oetPulse` 关键帧名、`"dsh-agent"` 指令名、`noHeaderSeat` 断言）。
- 语法：`node --check lib/index.js lib/client.js test/cdp-e2e.cjs`。
- 生效方式：**client 改动 Ctrl+F5**（宿主 ModuleLoader 直读磁盘）；**server 改动重启 DSH Web**。
- 提交前**隐私扫描**（见 §5）。

## 5. 工程纪律

- 每轮：改 → 语法 → e2e 43/43 → 隐私扫描 → commit + push（`github.com/HUliangwei/dsh-expert-team`）。
- git 身份：`-c user.name="HUliangwei" -c user.email="noreply@users.noreply.github.com"`。
- 隐私正则（commit 前跑，命中即修；若已 push 需追提交清理）。匹配项：
  「D 盘 Desktop 目录、内部域名、本机用户名、内部工作区后缀、sk- 开头的 8+ 位密钥、
  BEGIN 开头的证书块」；排除 `\.git/ private/ archive/ test/cdp-out/` + 图片与 json 文件。
  外部文件里的用户主目录路径一律用 `$env:USERPROFILE`/相对路径，勿硬编码。
- 术语一律中文回复用户；公开仓库不回传 `private/`（含 DEVLOG / CLIENT_UI_PLAN / 头像 / env.json）。
- commit message 用 `test/.gitmsg` 文件方式避免 PowerShell 撇号截断（写完即删；已 gitignore）。

## 6. 常见坑速查（history）

| 症状 | 根因/处理 |
|---|---|
| 新会话没有「Agent 管理」tab | conversation.view 被 `(mf)` 声明 → host 语义；lead 会话正常 |
| 图谱"空了"但任务卡在 | 旧布局缺新成员名 → 全体叠一点；ensureRing 已修 |
| 切会话后星环还是旧团队 | memberSig effect 已修（布局随 leadId+成员重载） |
| `current-team empty | byIdTotal:0` | byId 未水合的首帧；诊断会重发，看后面的行 |
| 启动报 `profile web-e2e does not exist` | TEMP 清理了 profile 文件 → 跑 `test/e2e-boot.ps1`（自动自愈） |
| `[expert-team]` 无彩色 | ANSI 仅 TTY；管道自动无色；`FORCE_COLOR=1` 强制 |
| agentTeam 投影 members:[] | 该会话用的是 `subagent` 一次性派发（不进 agentTeam roster）；靠 byId ∪ 并轨显示 |
| Console `[inpm] children register failed` | dsh-worktab HMR 循环，与我们无关 |
