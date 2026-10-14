# dsh-expert-team

DeepSeek Harness（DSH）智能体团队插件：把「模板目录」变成 **Agent Teams 一键部署** 能力，
并提供**团队图谱工作台**（成员星环 + 共享任务瀑布 + 浮窗直连管理）与一条**统一命令执行层**。

## 快速开始

**所有指令统一为 `/dsh-agent + 参数`（唯一指令头，CLI 概念）**；写作同一执行层
`runAgentCommand`，**GUI 浮窗按钮 = 直呼该 `/dsh-agent`**（JSON RPC
`/plugins/dsh-expert-team/<action>`，危险操作浮窗内二次确认）：

```text
/dsh-agent import <模板名> [--ctx fresh|fork] [--model 跟随|名称]   # 一键部署成员/专家团
/dsh-agent task   <create|claim|complete|reopen|delete|edit|assign># 共享任务生命周期（CAS）
/dsh-agent member <archive|restock|rename|restore|archive-list> …  # 成员生命周期
# 全部 Lead-only；/dsh-agent 是唯一注册指令，import/member/task 为子命令
```

- 模板卡片【创建】：Agent 管理 → 任意模板卡 → 起草 `/dsh-agent import …`，回车即建。
- 服务端部署工具（按成员 scope 安装，部署类仅 Lead）：`expert_template_list` /
  `expert_team_manifest` / `expert_member_deploy` / `expert_team_deploy`。

## 团队图谱工作台

- **星型拓扑 + 圆形节点**：lead 居中，成员环绕；头像兜底链（照片 → 模板别名 → 字头 SVG）；
  状态点绿/灰/蓝/红 = running/inactive/provisioning/failed；拖拽调布局（localStorage 记忆，
  松手写盘一次）。
- **活动可视化**：running 呼吸光环 + 光点沿连线流动（Web Animations API）；
  活动检测按签名触发（`useEffect([actSig])`），无变化不跑 diff；空闲 CPU 任务 0ms。
- **共享任务瀑布**（顶部横向，最左=「＋ 新建任务」固定占位 → 右侧按 revision 降序
  = 最新在前；区内滚轮横向翻页，窗口化渲染，参与者连线+脉动）。
- **管理浮窗**（lead 左键单击节点）：成员 = 重命名（直连 `sessions.rename`）/ 清空对话 /
  归档删除 / 归档浏览 / 打开对话；任务 = 置顶（本地持久化）/认领/完成/重开/转派/改标题/删除/新建；
  新建、改标题、转派等在浮窗内迷你输入完成，错误原因红字留在浮窗。

## 创建规范与能力边界

- 新成员会话标题自动规范为「对话名」（显式映射 → 模板中文名 → 剥团队前缀；幂等防覆盖）。
- Team 成员上限由 core `agent-teams` 决定（工具面 8）；roster **只增不减、名字不复用** →
  「归档删除」= 停用 + 快照到 `archive/` + 画布隐藏，「清空对话」= 归档 + 重建 `-rN` 新名。

## 结构

```text
lib/          client（ModuleLoader 插件，零构建）+ server（cordis：工具 + /dsh-agent + RPC 路由）
templates/    members/<name>/（member.json + agent.md）· teams/<name>/（team.json）· skills/
archive/      成员归档快照（.gitignore，本地保留）
test/         cdp-e2e.cjs（43 marks）+ resource-probe.cjs（资源探针）
```

模板字段规范见 `lib/templates.js` 头部注释；安装 = DSH profile bundle（`cordis.patch.yml`
insert），client 经宿主 ModuleLoader 加载，live 改动 **Ctrl+F5** 生效（server 改动需重启 DSH Web）。

## 开发与隐私

- e2e：`node --check lib/*.js` → 按 `test/cdp-e2e.cjs` 头部用法跑 headless（43 项 marks 断言）；
  资源审计 `test/resource-probe.cjs`（实测：空载堆 ~23.5MB、DOM ~600、空闲零任务、无泄漏）。
- 工程纪律：画布组件 hooks 必须全部位于空态早退**之前**（防 React #310）。
- 本仓库不含内网地址/凭据/密钥；`private/` 与 `archive/` 均被 `.gitignore` 排除，不回传。

## Roadmap

已上线：画布拓扑 + 成员/lead 浮窗 + 任务瀑布全生命周期 + 创建规范 + 统一执行层 `/dsh-agent`
+ 浮窗直连 JSON RPC。候选：一键给成员发消息；暂停/继续成员；团队着色；节点职业徽标；
归档云端备份。
