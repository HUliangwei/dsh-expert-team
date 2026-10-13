# dsh-expert-team

DeepSeek Harness（DSH）智能体团队插件：把「模板目录」变成 **Agent Teams 一键部署** 能力。

成员模板（`templates/members/<name>/`）与专家团模板（`templates/teams/<name>/`）平级存放；
本插件提供两条创建通道：**宿主 slash 指令 `/expert-import`** 与 **「Agent 管理」模板卡片的【创建】**，
两者都会把专家团/子智能体直接部署进**当前会话的智能体团队**。

## 特性

### 创建通道

- **宿主 slash 指令** `/expert-import`（与 `/kantu` 同款交互：菜单行 + 灰字参数提示 + 回车即执行）

  ```
  /expert-import <模板名> [--ctx fresh|fork] [--model 跟随|名称]
  /expert-import narrative-designer --ctx fork
  ```

  - `<模板名>`：`expert_template_list` 列出的成员/专家团模板
  - `--ctx fresh`（默认）：子智能体全新上下文、不继承本会话历史
  - `--ctx fork`：子智能体继承 Lead 已完成轮次作为背景
  - `--model`：默认跟随会话模型路由

- **模板卡片【创建】**：点「Agent 管理」→ 任意模板卡【创建】，输入框自动写好
  `/expert-import <模板名> --ctx fresh --model follow`，回车即创建；参数可在草稿中直接改。
  （草稿写入走「服务层通道 → composer DOM 直写 → 剪贴板」三级兜底，保证输入框可写。）

- **服务端部署工具**：`expert_template_list` / `expert_team_manifest` / `expert_member_deploy` /
  `expert_team_deploy`（随插件注册；部署类工具按 Team 成员身份安装，仅 Lead 可部署）。

### 画布（Agent 管理 → 当前团队）

- **星型拓扑 + 圆形节点**：中心 lead 直属所有成员；d3-force 式径向布局、按成员数缩放、
  拖拽调布局并记忆（localStorage `graph-v4-*`）；一屏放得下（svg `max-height: 56vh`，少滚轮）。
- **头像**：成员节点显示圆形头像 —— 已注入的照片优先，否则「模板别名」匹配，兜底为
  「字头 SVG」（渐变圆 + 友好名首字，任何成员都有头像）。
- **状态可视化**：绿色呼吸光环 = 正在工作；光点沿 lead↔成员连线滑动 = 消息活动（SMIL）。
- **lead 节点**显示主对话标题（不再显示 lead）。

### 管理浮窗（Lead-only，左键单击成员节点）

- **✏️ 重命名**：直连 `sessions.rename` RPC 改会话标题（对话名），画布/列表即时同步。
- **🔄 清空对话**：起草 `/expert-member restock <名>` → 归档旧对话并重建同名新成员（`-r2` fresh）。
- **🗑 归档删除**：起草 `/expert-member archive <名>` → 停用 + 历史 JSONL 快照到 `archive/<名>-<时间>/`。
- **📂 归档浏览 / 恢复**：`/expert-member archive-list` 列归档；`/expert-member restore <目录>` 恢复。
- **🔗 打开对话**：`uiWorkspace.openSession` 跳到该成员自己的会话页。
- **lead 节点浮窗 = 创建面板**：全部模板成员（可滚动）+ 3 个专家团，一键起草创建命令。

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
├── lib/                  # client（ModuleLoader 插件）+ server（cordis 插件：工具 + /expert-import、/expert-member 指令）
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
# 内部 e2e：见 test/cdp-e2e.cjs 头部用法（需 DSH headless profile + CDP）；marks 38 项
```

已知工程纪律（改画布组件时务必遵守）：

- `CurrentTeamCanvas` 的 hooks 必须全部位于任何早退（含空态 `n===0`）**之前**，
  否则成员数 0↔N 切换会触发 React #310（e2e 有顺序断言防回退）。
- 给某组件新增变量前，确认**每一处使用它的组件**都定义了它（曾因只加到空态组件
  导致 `leadRow is not defined`）。

## Roadmap / 待办

- **已上线**：画布拓扑（v4 压缩）+ lead 创建浮窗 + 成员管理浮窗（重命名/清空/归档/打开对话/
  归档浏览恢复）+ 创建规范（对话名/头像兜底）+ 默认当前团队页。
- **候选（未实现）**：一键给成员发消息；暂停/继续成员；团队着色区分；节点职业徽标；
  归档云端备份。
- 备注：一个 Team 的成员上限由 `agent-teams.config.maxMembers` 决定（工具面 8）；roster 只增不减、成员名不复用。
