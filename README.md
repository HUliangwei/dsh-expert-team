# dsh-expert-team

DeepSeek Harness（DSH）智能体团队插件：把「模板目录」变成 **Agent Teams 一键部署** 能力。

成员模板（`templates/members/<name>/`）与专家团模板（`templates/teams/<name>/`）平级存放；
本插件提供两条创建通道：**宿主 slash 指令 `/expert-import`** 与 **「Agent 管理」模板卡片的【创建】**，
两者都会把专家团/子智能体直接部署进**当前会话的智能体团队**。

## 特性

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

- **服务端部署工具**：`expert_template_list` / `expert_team_manifest` / `expert_member_deploy` /
  `expert_team_deploy`（随插件注册；部署类工具按 Team 成员身份安装，仅 Lead 可部署）。

## 目录结构

```
dsh-expert-team/
├── lib/                  # client（ModuleLoader 插件）+ server（cordis 插件：工具 + /expert-import 指令）
├── templates/
│   ├── members/<name>/   # 成员模板：member.json + agent.md
│   ├── teams/<name>/     # 专家团模板：team.json（sop/lead/members/prompts）+ README
│   └── skills/<name>/    # 技能包：SKILL.md + 参考文档
├── docs/                 # 交付计划/设计文档
└── test/                 # CDP e2e 脚本（详见 test/ 内 README 注释）
```

模板规范（`member.json` / `team.json` 字段）见 `lib/templates.js` 头部注释。

## 安装

- 作为 DSH **profile bundle** 挂载：包名加入 profile 的 `dsh.profile.bundles`（或经
  `cordis.patch.yml` insert），`dsh` 启动时自动注册 server 指令与工具。
- client 部分经宿主 ModuleLoader 加载 `lib/client.js`，无构建链。

## 隐私说明

- 本仓库**不包含任何内网地址、凭据或真实密钥**；`private/` 目录（统一存放隐私配置与内部
  开发记录）已被 `.gitignore` 排除，不会进入公开仓库。公开文件中的 `<占位符>` 表示真实值由
  部署方经环境变量或本机 `private/env.json` 注入，约定详见 `private/README.md`（本地克隆后自行创建）。

## 开发

改动后本地验证（headless e2e）：

```
node --check lib/index.js lib/client.js
# 内部 e2e：见 test/cdp-e2e.cjs 头部用法（需 DSH headless profile + CDP）
```

## Roadmap / 待办

- **移除/归档子智能体**（`/expert-remove` + 成员卡按钮 + `expert_member_remove` 工具，Lead-only）：
  停用运行（官方 `subagents.drainContinuableChildren` 通道）+ 对话快照归档到工作区 `archive/<名字>/`；
  官方 agent-team 目前无单成员删除 API，v1 语义为「停用 + 归档 + 面板隐藏」。
- 备注：一个 Team 的成员上限由 `agent-teams.config.maxMembers` 决定（官方默认 16，min 1）；roster 只增不减、成员名不复用。


