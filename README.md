# dsh-expert-team

DeepSeek Harness（DSH）智能体团队插件：把「模板目录」变成 **Agent Teams 一键部署** 能力。

成员模板（`templates/members/<name>/`）与专家团模板（`templates/teams/<name>/`）平级存放；
本插件提供两条创建通道：**宿主 slash 指令 `/dsh-agent`** 与 **「Agent 管理」模板卡片的【创建】**，
两者都会把专家团/子智能体直接部署进**当前会话的智能体团队**。

## 特性

### 统一执行层（dsh-agent）

所有写操作（部署/任务/成员生命周期）走同一个**程序可调的命令执行层** `runAgentCommand`：
宿主 `/dsh-agent` 指令、旧 `/expert-*` 别名、浮窗「直连 JSON RPC」共用它 —— 浮窗按钮点击即执行，
**不再依赖输入框草稿**。

- **宿主 slash 指令**（启动横幅即打印本页指令一览）：

  ```
  /dsh-agent import <模板名> [--ctx fresh|fork] [--model 跟随|名称]
  /dsh-agent task   <create|claim|complete|reopen|delete|edit|assign> …
                   create "<标题>" [--desc …]；assign <任务id> <成员名>；均按最近 revision CAS
  /dsh-agent member <archive|restock|rename|restore|archive-list> …
  /dsh-agent import|task|member … = /expert-import|/expert-task|/expert-member …（旧名为别名）
  ```

- **浮窗直连执行**（Round 56）：团队图谱浮窗里的任务/成员按钮**点击即执行**——
  client `fetch("/plugins/dsh-expert-team/<action>")` JSON RPC → 服务端按 lead 校验 →
  走同一执行层 → 官方 agentTeams 服务写 → 画布投影自动刷新。
  需要输入的参数（新建/改标题/转派）在浮窗内迷你输入框完成；**危险操作（删除任务/清空对话/
  归档成员）在浮窗内二次确认**；置顶为本地状态不经服务端。

- **模板卡片【创建】**：点「Agent 管理」→ 任意模板卡【创建】，输入框自动写好
  `/expert-import <模板名> --ctx fresh --model follow`，回车即创建；参数可在草稿中直接改。
  （草稿写入走「服务层通道 → composer DOM 直写 → 剪贴板」三级兜底，保证输入框可写。）

- **服务端部署工具**：`expert_template_list` / `expert_team_manifest` / `expert_member_deploy` /
  `expert_team_deploy`（随插件注册；部署类工具按 Team 成员身份安装，仅 Lead 可部署）。

### 画布（Agent 管理 → 当前团队）

- **星型拓扑 + 圆形节点**：中心 lead 直属所有成员；径向布局、按成员数缩放、
  拖拽调布局并记忆（localStorage `graph-v4-*`）；一屏放得下（svg `max-height: 56vh`）。
- **头像**：成员节点显示圆形头像 —— 已注入的照片优先，否则「模板别名」匹配，兜底为
  「字头 SVG」（渐变圆 + 友好名首字，任何成员都有头像）。
- **状态可视化**：绿色呼吸光环 = 正在工作；光点沿 lead↔成员连线滑动 = 消息活动
  （Web Animations API，坐标经 getScreenCTM 换算与连线严格重合）。
- **lead 节点**显示主对话标题（不再显示 lead）。

### 共享任务瀑布（顶部横向，Round 54 定稿）

- **布局**：共享任务卡（150×44，徽章 emoji + 状态点 + 标题 + 负责成员）**横向排列在画布
  顶部**，y=62 处水平分隔线下接拓扑；全部任务进入瀑布（不做条数截断），窗口化渲染。
- **区内滚轮翻页**：鼠标停在顶部任务条上滚轮（或触控板横滑）→ 卡片**横向翻动**（52px/步，
  已夹取边界）；拓扑区滚轮不受影响；可滚动时显示「↔ N 个任务 · 滚轮翻动」。
- **「＋ 新建任务」**：虚线占位卡固定在任务条最左（不随滚动），点击直接弹新建浮窗。
- **任务卡交互**（左键，与成员节点一致）：指哪儿弹哪儿（`openTaskMenu` 工厂参数绑定，
  杜绝历史 var 闭包串台 bug）；浮窗动作：📌 置顶/取消置顶（localStorage
  `dsh-expert-team-taskpin-<leadId>` 持久化）、待认领→认领、进行中→完成/转派、已完成→重开、
  改标题、🗑 删除、＋ 新建。
- **状态与排序**：pending（📋 待认领）/ in_progress（⚙️ 蓝色呼吸 + 成员连线 + 脉动）/
  completed（✅ 灰色 done 点）；排序 = 置顶 → revision 降序（**从左到右 = 最新在前**）。
- **数据**：全部来自官方 `agentTeam.tasks` 投影（含 revision/ownerName/writeScopes）；
  写操作走浮窗直连 JSON RPC → 统一执行层 → CAS（getTask→updateTask withRevision）。

### 管理浮窗（Lead-only，左键单击成员节点）

- **✏️ 重命名**：直连 `sessions.rename` RPC 改会话标题（对话名），画布/列表即时同步。
- **🔄 清空对话**：二次确认后直连执行（`member.restock`）→ 归档旧对话并重建同名新成员（`-rN` fresh）。
- **🗑 归档删除**：二次确认后直连执行（`member.archive`）→ 停用 + 历史 JSONL 快照到 `archive/<名>-<时间>/`。
- **📂 归档浏览 / 恢复**：浮窗直读归档列表；`/dsh-agent member restore <目录>` 恢复。
- **🔗 打开对话**：`uiWorkspace.openSession` 跳到该成员自己的会话页。
- **lead 节点浮窗 = 创建面板**：全部模板成员（可滚动）+ 3 个专家团，一键起草创建命令。
- 所有浮窗按钮点击即执行，错误原因红字显示在浮窗内（不再写输入框草稿）。

### 创建规范（子智能体默认名字 = 对话名字）

- 任一会话一打开（不依赖 Agent 管理 tab），顶层订阅就把新成员会话标题规范成友好「对话名」：
  显式映射（各团队已落地成员）→ 模板中文显示名 → 剥团队前缀；幂等 + `localStorage`
  doneKey 防止覆盖用户手动改过的名字。
- `Agent 管理` 默认打开**当前团队**页（页签与文案均已改名「当前团队 / Current team」）。

### 能力边界（DSH 官方限制的诚实说明）

- Team 成员上限由 core `agent-teams` 决定（工具面 8 人；`maxActiveSubagents` 是另一套临时
  subagent 并发，与此无关）；roster **只增不减、名字不复用** → 「归档删除」= 停用 + 快照 +
  画布隐藏，「清空对话」= 归档 + 重建同级新名（`-rN`），官方无真删除/清空通道。

## 目录结构

```
dsh-expert-team/
├── lib/                  # client（ModuleLoader 插件）+ server（cordis 插件：工具 + /expert-import、/expert-member、/expert-task 指令）
├── templates/
│   ├── members/<name>/   # 成员模板：member.json + agent.md（部分带 avatar.png 头像）
│   ├── teams/<name>/     # 专家团模板：team.json（sop/lead/members/prompts）+ README
│   └── skills/<name>/    # 技能包：SKILL.md + 参考文档
├── archive/              # /expert-member 归档快照（.gitignore，本地保留）
├── docs/                 # 交付计划/设计文档
└── test/                 # CDP e2e 脚本（详见 test/ 内 README 注释）
```

模板规范（`member.json` / `team.json` 字段）见 `lib/templates.js` 头部注释。

## 安装

- 作为 DSH **profile bundle** 挂载：包名加入 profile 的 `dsh.profile.bundles`（或经
  `cordis.patch.yml` insert），`dsh` 启动时自动注册 server 指令与工具。
- client 部分经宿主 ModuleLoader 加载 `lib/client.js`，无构建链。
- live 环境挂载为 Junction → 工作区，改后 **Ctrl+F5** 生效。

## 隐私说明

- 本仓库**不包含任何内网地址、凭据或真实密钥**；`private/` 目录（统一存放隐私配置与内部
  开发记录）已被 `.gitignore` 排除，不会进入公开仓库。公开文件中的 `<占位符>` 表示真实值由
  部署方经环境变量或本机 `private/env.json` 注入，约定详见 `private/README.md`（本地克隆后自行创建）。
- `archive/`（成员归档快照）同样 `.gitignore` 排除：归档可能含会话内容，不回传公开仓库。

## 开发

改动后本地验证（headless e2e）：

```
node --check lib/index.js lib/client.js
# 内部 e2e：见 test/cdp-e2e.cjs 头部用法（需 DSH headless profile + CDP）；marks 43 项
```

已知工程纪律（改画布组件时务必遵守）：

- `CurrentTeamCanvas` 的 hooks 必须全部位于任何早退（含空态 `n===0`）**之前**，
  否则成员数 0↔N 切换会触发 React #310（e2e 有顺序断言防回退）。
- 给某组件新增变量前，确认**每一处使用它的组件**都定义了它（曾因只加到空态组件
  导致 `leadRow is not defined`）。

## Roadmap / 待办

- **已上线**：画布拓扑（v4 压缩）+ lead 创建浮窗 + 成员管理浮窗（重命名/清空/归档/打开对话/
  归档浏览恢复）+ 创建规范（对话名/头像兜底）+ 默认当前团队页 + **共享任务瀑布**（顶部横向 +
  滚轮翻页 + 置顶持久化 + 排序最左最新 + 任务浮窗全生命周期）+ 启动横幅 + **统一执行层
  `/dsh-agent`**（指令头 + 旧别名）+ **浮窗直连执行 JSON RPC**（不再依赖输入框草稿；危险操作二次确认）。
- **候选（未实现）**：一键给成员发消息；暂停/继续成员；团队着色区分；节点职业徽标；
  归档云端备份。
- 备注：一个 Team 的成员上限由 `agent-teams.config.maxMembers` 决定（工具面 8）；roster 只增不减、成员名不复用。
