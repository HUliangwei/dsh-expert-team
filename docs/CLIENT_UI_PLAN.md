# dsh-expert-team 客户端 UI 方案（Phase 2，调研定稿）

> 调研于 2026-10-12，结论全部来自 dsh 0.2.x 已安装包源码（`@deepseek-ai/dsh/node_modules/@deepseek-ai/*`）。
> 两个需求：① 插件专用 **tab** 管理模板；② 对话输入框 **「+」菜单**新增「导入成员和专家团」栏目。

## 0. 结论速览（第二稿修订，2026-10-12 晚；已按源码全部定稿并落码）

**关键修正**：① 输入框「+」是附件添加按钮（`ComposerAttachments` 占单一槽 `conversation.input.attachments`），**没有可扩展的「+」菜单槽**；② `SidebarRightTabRegistry` **并非不可达**（第八轮实锤）：`dsh-client-ui-sidebar-right/lib/client.js:9073` 有 `ctx.reflect.provide("sidebarRightTabs", registry)` —— reflect 公开通道，任何 bundle `ctx.reflect.get("sidebarRightTabs", false)` 拿到后 `tabs.register(...)` 即可挂新 tab 类型，`guide` 条目同时成为右侧栏开始页卡片。

| 需求 | 最终挂点 | 状态 |
|---|---|---|
| 「导入成员/专家团」入口 | `conversation.input.left`（list 空槽）紧凑按钮 + 浮动模板面板 | ✅ 已实现 + 浏览器级验证 |
| 模板管理面板（真 UI） | `conversation.session.header.actions`（list）头部按钮 + 面板（agent-team TeamAction 同款先例；出口按会话视图挂载） | ✅ 已实现 |
| 专用 tab | `sidebar.right.pane.tab` / `.tab.title`（keyed，key=类型 id）+ `sidebarRightTabs.register`（类型+开始页卡片） | ✅ 已实现 + 浏览器级验证（第八轮） |
| 模板数据 | v1 内置模板名 + 指示把 `expert_template_list` 交给模型取真清单；动态宿主 RPC 延后 | ⚠️ v1 静态 |

**作者契约（全部来自 `dsh-cordis-client-runner/lib/client.js` 的运行时契约注册表）**：
- 客户端模块 = `window.__ModuleLoader__.load({ id, factory(require) })`，尾部 `exports.apply = apply; exports.inject = inject; return module.exports`。
- `apply(ctx)` 用 `ctx.locale.register(NS, {zh, en})` + `ctx.slots.inject(slot, () => ctx.slots.register({name, id|key, order?, locale?}, Component))` + `ctx.effect(disposer)`。
- list 槽选项 `id/order/label`；keyed 槽选项 `key`；组件收到的标准 props 含 `inputActions`（有 `setDraft(text)` / `submit(mode)`）、`sessionId`、`t`（locale）等。
- 三个挂点契约原文见上表对应源码链：`slots.ts:201`（input.left）、`slots.ts:209+`（header.actions）、`slots.ts:59/73`（pane.tab/title）。
- **浏览器端拿模板数据**：官方 8 个客户端服务（layout/locale/sessions/slots/theme/timer/uiWorkspace/workspaces）无文件/工具 RPC → v1 静态模板名 + 指令草稿，动态化需宿主自定义 RPC（方案 B），已列为后续。

## 已交付代码（第二轮）

- `lib/client.js`（279 行，ModuleLoader 格式，零构建链）：locale 字典（zh/en）+ 3 组挂载（input.left 导入按钮、header 面板、tab body/title）。
- `package.json`：`./client` 导出 + `dsh.client{inject, platform:"web"}` + react peer。
- 语言鲁棒性：组件一律走 `makeT(props)` —— `props.t`（locale:NS 注入）优先，缺失时回落自带 zh 字典，任何挂点都不会因缺 `t` 崩溃（对照 agent-team `TeamAction({..., t})` 确认 header.actions 注入 `t`；input.left 契约未列 `t`，故防御）。

## 客户端运行时验证（第五轮，2026-10-12）

- 方法：`dsh --profile web-e2e --from-default-profile web` 建一次性 profile（bundles=base+web-app），叠加 agent-team/tool-agent-team/expert-team/apiqpqi 行；`--port 3099` 启动后 headless Chrome 真实加载。
- ✅ **bundle 进入应用清单**：页面 `__DSH_BOOT__` 含 `{"id":"dsh-expert-team","url":"plugins/??dsh-expert-team/client.js&rev=089fb2786dc7","inject":[client-locale, client-ui-slots, api-session-controller, client-ui-workspace]}`，与 package.json `dsh.client.inject` 一致。
- ✅ **服务端吐出的 bundle 即当前代码**：GET 该 URL 命中全部标记（`expert-team-import` / `conversation.session.header.actions` / `sidebar.right.pane.tab` / 「专家团模板」 / 「＋ 导入」 / `makeT` / `writeDraft` / `inputActions.setDraft` / `locale.register`）。
- ✅ **应用整体加载无崩溃**：headless Chrome 渲染出完整界面（工作区选择器截图 `test/webe2e-app.png`，OCR 确认）。
- ⚠️ **槽渲染级**（按钮可见需会话视图 + 有状态浏览器）：留待 GUI 重启后验收（或后续 CDP 自动化点击）。
- 环境备注：本机 Chrome 的 `--dump-dom`/内联管道输出为空、`--virtual-time-budget` 对 SPA 会挂起——用 `Start-Process -Wait -RedirectStandardError` + `--screenshot` 才可靠出图。

## 客户端浏览器级 E2E（第六轮，2026-10-12 · 通过）

一次性 profile `web-e2e`（默认模板 + agent-team + apiqpqi；`DSH_HOME` 重定向到临时隔离目录，全程不碰正式 GUI/状态）+ headless Chrome + 自写 CDP 驱动（`test/cdp-e2e.cjs`，Node 裸写 WebSocket，掩码帧 + 15s 超时 + 全量控制台监听）。

实测结果（真实渲染、真实点击、真实 DOM 断言）：
1. 输入栏左端起「**＋ 导入**」按钮 ✅（页面 button 列表含 `＋ 导入`）。
2. 点击 → 面板渲染「智能体团队模板」+ trading-team / researcher / market-analyst ✅（`panel:{panelTitle:true,hasTeam:true,hasMember:true,hasMarket:true}`）。
3. 点击 trading-team 行 → **草稿框出现指令**：`in-field: 请用 expert_team_deploy 导入专家团 trading-team（先 expert_team_manifest 预演）` ✅ —— `inputActions.setDraft` 真实生效。
4. 全程无控制台错误（EXC/CONSOLE 监听为空）✅；截图 `test/cdp-out/shot.png` 肉眼/OCR 可见面板（market-analyst / 导入成员 / 部署 trading-team 等文案）。
5. 过程中修复**真 bug**：`makeT` 把 props 对象当函数调用（`p is not a function` 槽渲染崩溃）→ 改为取 `props.t`；该错误被 SlotErrorBoundary 捕获后仅丢该入口，**真实浏览器测试才暴露**。

已知遗留：对话头部「专家团模板」入口（`conversation.session.header.actions`）——**已查明非代码问题**（第七轮）：标准模式空白会话走精简头部，页面挂载的槽出口清单里根本没有 `conversation.session.header.actions`（仅有 corner；`conversation.input.left` 在列）。注册与 agent-team 逐字同构，会在挂载该出口的会话视图（如真实 GUI 的 lead/agent 会话头部）出现。需求④由输入栏入口承载，已验证。

## ③ 专用 tab 浏览器级验证（第八轮，2026-10-12 · 通过）

- 前置更正：第七轮前误判「注册表私有不可达」；第八轮源码实锤 `ctx.reflect.provide("sidebarRightTabs", registry)`（lib:9073）即公开通道，`tabs.register` 文档也写明「guide 类型与其他任何类型走同一条公开两步路径」（lib:9024-27）。
- 落地于 `lib/client.js`：类型 `expert-team/templates`（kind `expert.team`）+ 开始页卡片（专家团模板）→ body/title 槽 keyed 注册 key=类型 id。
- CDP 实测（web-e2e 隔离环境，同第六轮配方）：展开右栏 → 开始页卡片清单含 `{kind:"expert.team","专家团模板"}, {files 工作区文件}, {terminal 新建终端}` → 点击专家团卡片 → tab 打开，body 渲染：`智能体团队模板 / 专家团模板 trading-team 导入专家团 / 成员模板 researcher·reviewer·market-analyst 导入成员`（`tab-body.json`）；全流程无控制台错误；截图 `test/cdp-out/shot.png`。
- 至此 ① 服务端 + ② bundle + ③ tab + ④ 输入栏入口 **四项全部实现并各有浏览器/模型级验证**；剩模板数据动态化（方案 B，v1 静态）作为可选后续。

## ⑨ tab 行为层验证（第九轮，2026-10-12）· 停靠 tab 而非浮窗

- 用户实操反馈「专家团模板做在工作台边上这种 tab，而不是顶层 tab 浮窗」→ 分层实测（1600x1000 vs 700x900 视口，`test/layer-probe.cjs`）：
  - **1600px**：`panel:"push"`（停靠）、`floatHosts:0`（无浮层）、单面板 `pane1`——点我们的 tab 与点内置 files/terminal 行为完全一致（chips 出现在停靠条、body 面板内渲染）。
  - **700px**：同一流程 `panel:"fullscreen"` —— `autoFullscreen = viewportWidth < 768`（lib:5727）是 DSH 对**所有 tab 一视同仁**的全局规则（内置文件/终端同样全屏），非本 tab 独有，且无单类型豁免接口。
- 结论：tab 本体即「工作台边上」的普通停靠 tab；「顶层浮窗」外观仅出现在窄窗口（<768px）自动全屏时，宽窗口下即为用户要的形态。窗口建议 ≥768px，或用手动全屏切换收起。

## ⑩ Tab 主挂点换轨 conversation.view（第十轮，2026-10-12 · 用户实机迭代）

- 用户实操：「专家团模板做在工作台边上这种 tab，而不是顶层 tab 浮窗」「参照 buka 项目的 buka助理 tab，放在那里」。
- 查明：**buka 助理/画廊/上下文 都在 `conversation.view` 槽**（顶部 对话/轨迹/**上下文**/画廊/**buka助理**/工作台 那条 tab 条）——buka-assistant 注册 `{name:"conversation.view", id:"buka", order:30, label:"buka助理"}`（`src/client/index.ts`）；dsh-context 注册 `{id:"context", order:20}`；image-gen 注册 `{id:"gallery", order:20}`（lib:125596）。这是「放那里」的正确槽位。
- 改法（`lib/client.js`）：主挂点 → `conversation.view`（`{id:"expert-team-templates", order:30, label:()=>t("header.action")}`，body 复用完整管理页组件）；**移除** sidebarRightTabs 类型注册/开始页卡片/右栏 tab body/title（断言 token：`noPaneSeats`）。
- **事故记录**：换轨重写 apply 时误删 `var inject`（exports.inject 引用丢失）→ 用户实机「web boot: 1 entry did not activate / import failed: inject is not defined」→ 用户 `disabled: true` 兜底 → 补回 inject（~line 319）+ 解除禁用；`node --check` + web-e2e 回归全绿（`test/cdp-e2e.cjs`：输入栏面板/草稿 + served bundle 标记 + 本地产物无 `sidebar.right.pane.tab`）。重启 GUI 后 top 条出现「专家团模板」tab、面板内开整页。

## ⑪ 输入框「+」菜单栏目 = `commandUi` 贡献（第十一轮，2026-10-12 · 用户澄清）

- 用户截图澄清：「我说的+是左下角这个+，不是让你再做一个+导入」→ 左下角「+」(`aria-label=添加文件或调用指令`) 与「/」共用 trigger 菜单；**删除** `conversation.input.left` 的「＋ 导入」按钮。
- 查明机制：该菜单 = `dsh-client-ui-input-trigger` 的 MenuView（`conversation.input.overlay` 槽）+ `dsh-client-ui-commands` 的 `/` source 合并渲染：**添加区**（file/goal/plan/feedback，`SECTION_ROWS.add`）+ **指令区**（compact/permission/model/export + **任何未列名行按 catalog 顺序追加**）。
- 加栏目途径（`dsh-client-ui-commands`）：`commandUi.register(contribution)`（新命令行，`{name, available, label?, description?, icon?, ui}`）或 `commandUi.decorate({name, available, ui})`（挂在宿主命令上）；`ui.kind:"action"` → `run(session)` 纯客户端函数（反馈命令逐字同款，`ctx.inject(["commandUi"], scope=>scope.effect(()=>scope.commandUi.register(...)))`）；`ui.kind:"popup"` → `{options(context,signal) → [{name,hint,label,description,value}], onSelect(option, context)}`（`settle` 后 `deps.consume + focusComposer`）。
- 落地（`lib/client.js`）：`expert-import` 贡献，label「导入成员和专家团」，popup 选项 = SHIPPED_TEAMS/SHIPPED_MEMBERS，`onSelect` → `setComposerDraft(ctx, sessionId, text)`（`ctx.sessions.binding(id).ctx` → `conversation.input.for(binding.ctx).setDraft`，失败 console.warn）。
- 浏览器级 E2E（真实用户路径）：点「+」→ 菜单 DOM：添加(文件/目标/计划/反馈) + 指令(压缩/权限/模型/下载日志) + **导入成员和专家团 / expert-import / 选择模板→…** →（行 pick 需真实 mouse 事件）→ popupSelect 四项（trading-team·交易分析团队 / researcher·研究员 / market-analyst·技术分析师 / reviewer·评审）→ 选 trading-team → **草稿 `请用 expert_team_deploy 导入专家团 trading-team（先 expert_team_manifest 预演）`**；0 控制台错误；`hasImportBtn=false`。

## ⑫ 移除对话头部「专家团模板」按钮（第十二轮，2026-10-12 · 用户减载）

- 用户：「智能体团队边上那个专家团模板去掉」→ 删除 `conversation.session.header.actions`（id `expert-team`）注册 + `HeaderAction`/`TemplatesPanel`/`TemplateRow`/`writeDraft` 组件与 `panelStyle`/`listStyle`/`rowStyle`（`chipStyle` 保留给 tab）；字典删 `header.open`/`panel.written`。
- 挂载收敛为 ① commandUi 菜单栏目 + ③ conversation.view tab，均不在对话头部（不再与 agent-team 的「智能体团队」并排）。回归：`noHeaderSeat=true`/`noImportBtnCode=true` + 菜单流程全绿。

## ⑬ tab 页卡片级交互：点卡片开编辑器 / 点【导入】写短指令 / 卡片显示目录路径（第十三轮，2026-10-12）

- 用户需求：tab 里点「导入成员」→ 指令进对话框；**做成指令而非把大段文字写进系统提示词**；每个模板做成卡片、点开其编辑、卡片显示模板目录路径。
- 卡片（`TemplatesTabBody`）：团队/成员各一张卡片，标题行 = name·display + 右端【导入专家团/导入成员】真按钮（chips→button，`cursor:pointer`）；卡片体内一行等宽字体目录路径 + 描述 + 元信息（lead/sop 或 role/skills）。
- **点卡片 → 编辑器打开模板文件**：`ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, path))`。`fileAddressFor` 抄自 ui-skill 的 workspace-path 工具（`dsh-resource://file/session/<id>/<path>`，绝对路径对 cwd 剥离、相对路径直用）；`cwd = sessions.list.getSnapshot().byId[sessionId].cwd`；path = `PLUGIN_WORKSPACE_PREFIX("project/dsh-expert-team") + "templates/{teams,members}/<name>/team.json|member.json"`。失败 console.warn + notice 提示目录。
- **点【导入】chip → 一行短指令入草稿**：`setComposerDraft(ctx, sessionId, import.kind.*)`（`请用 expert_team_deploy 导入专家团 X…` / `请用 expert_member_deploy 导入成员模板 Y`），只写命令不进系统提示词；`e.stopPropagation()` 防触发卡片开编辑器。与「+」菜单 onSelect 同一草稿通道，指令文本共用同一字典。
- **会话定位**：`conversation.view` 注册新增 `inject: key => ({tabSessionId: String(key)})`——renderer `runInject(entry, binding, actions)` 对作用域槽把 `binding.key` 传给 entry.inject（feedback/assistant-actions 同款）；组件内 `props.tabSessionId || activeSessionId(pluginCtx)` 兜底（sessions.list 主视图保留会话）。`inject` 列表增补 `sidebarRight`。
- 回归：web-e2e `hasTabTools=true`（7 个代码断言）+ 菜单流程全绿、0 控制台错误；tab 交互实机验证（依赖真实 GUI 会话作用域与 workspace 路径）。

## ⑭ 卡片交互可视化：hover/聚焦/按下/键盘（第十四轮，2026-10-12）

- 用户：「卡片缺少聚焦高亮这些交互可视化」。内联 style 无法表达伪类 → `injectTabStyles()` 在 apply 时动态注入 `<style data-plugin-css="dsh-expert-team-tab">`（skill 同款 data-plugin 去重幂等；document 守护）。
- `.oetTabCard`（整卡可点）：`cursor:pointer` + `transition: border-color/background/box-shadow .12s`；`:hover` = 主题色边框 + `--dsw-alias-interactive-bg-hover` 底 + 阴影；`:focus-visible` = 主题色 2px outline（offset 2）；`:active` = 更深的交互底。
- `.oetTabChip`：`:hover` `brightness(1.12)`、`:focus-visible` outline、`:active` `brightness(.94)`。
- 可达性：卡片 `role="button"` + `tabIndex:0` + `aria-label="打开该模板的编辑：templates/…"` + `pressEnter`（Enter/Space → openEdit）。
- 回归：运行时探针 `runtimeStyleTag {tag:true,hasHover:true,hasFocus:true}`（style 标签真实入 head）+ `hasCardCss=true` 代码断言（oetTabCard/:focus-visible/injectTabStyles/pressEnter/role:"button"/tabIndex/panel.edit.aria）+ 菜单流程全绿。

## ⑮ 卡片视觉对齐 buka 助理（第十五轮，2026-10-12）

- 用户：「你可以效仿buka助理那种卡片效果」→ 逐条对照 buka `dsh-plugin-buka/lib/client.js` styles.ts 的 `.bk-grid/.bk-card/.bk-kind/.bk-btn/.bk-actions`：
  - `.oetGrid` = buka `.bk-grid`：`repeat(auto-fill,minmax(250px,1fr))` gap 10 响应式网格，团队/成员各一组（原为纵向整宽堆叠）。
  - `.oetCard` = `.bk-card`：10px 圆角、`border-left-width:3px` 语义左缘（团队 `--dsw-alias-brand-primary`/成员 `#a855f7`）、`bg-layer-1` 底、`user-select:none`、hover 仅 `bg-layer-2` 加深（无描边阴影，buka 克制风格）、`:focus-visible` 品牌色 1.5px 内嵌 outline（= `.bk-card.sel`）。
  - 行级类：`.oetCardName`（13/600 省略号）、`.oetKind.team/.member`（= .bk-kind.local/remote 着色小标签，放标题右侧）、`.oetPath`（11px 等宽目录路径，= .bk-card-ep）、`.oetDesc/.oetMeta/.oetMuted`（= 次级/三级色 12px）、`.oetSection`（= .bk-group-t：11.5/600/下边框）。
  - 导入动作：从右上胶囊改为**卡片底部 `.oetActions > .oetBtn`**（= .bk-actions/.bk-btn：细边框、hover 品牌描边+文字、focus-visible outline、active 加深），与 buka 渠道卡一致。
  - 清理：删 cardStyle/chipStyle/sectionTitleStyle 内联函数与旧类（oetTabCard/oetTabChip）；保留 role/tabIndex/aria-label/pressEnter 可达性。
- 回归：`runtimeStyleTag {tag:true,hasGrid:true,hasHover:true,hasFocus:true,hasBtn:true}` + `hasCardCss=true`（oetGrid/oetCard:hover/:focus-visible/oetBtn:hover/injectTabStyles/pressEnter/role/tabIndex/panel.edit.aria/is-member）+ 菜单流程全绿、0 控制台错误。

## ⑯ tab 页复刻 workbuddy 专家团（第十六轮，2026-10-12）

- 用户：「workbuddy上的专家团你能直接抄过来吗？」（workbuddy「内容创作专家团」：页头 团队名+V1.0.0+召唤、团队帮你做 3 条示例、成员头像名册、底部 ID）。
- 结构（`TemplatesTabBody` 重排）：
  1. 页头：专家团模板 + `V1.0.0`（`.oetVersion` 胶囊，buka .bk-kind 同款）+ hint。
  2. `.oetPanel` 团队面板：`.oetTeamHead`（团队名·显示名）+ `.oetSummon`（品牌蓝实心按钮 = 部署指令入草稿）+ `.oetDesc` 描述 + `.oetPromptRow`「团队帮你做」3×`.oetPrompt` 胶囊（`team.prompts` 新增数据；点击 prompt 文本入草稿）+ `.oetRoster` 成员名册 `.oetRow`（`.oetAvatar` 圆头像 主理人蓝/成员紫、首字；`.oetRowName` 姓名·name；右端 `.oetRole` 角色胶囊=职业）+ `.oetPath` ID 行（模板目录）。
  3. 成员模板卡片网格（buka 卡片保留）。
- 交互：主理人行 → 开 team.json 编辑；成员行 → 该成员部署指令入草稿；召唤 → 团队部署指令；prompt → prompt 原文入草稿（模型直接执行，不部署）。
- 回归：`hasWorkbuddy=true`（oetSummon/oetPrompt/oetRoster/oetAvatar/oetVersion/prompts:[ /"panel.do"/"panel.summon"）+ 全部既有断言 + 菜单流程全绿。

## ⑰ 导入 WorkBuddy 内容创作专家团（第十七轮，2026-10-12）

- 用户：「你能把workbuddy的专家团的zip的内容抄过来使用吗？」→ 定位包本体 `~/.workbuddy-ai/plugins/cache/experts/ai-content-creator-team/1.0.0/` 并本地化进 templates/。
- 落地：
  - `templates/teams/ai-content-creator-team/`：team.json（displayName 内容创作专家团 / sop 六阶段 / lead.prompt 司远编排铁律 / members 6 / prompts=3 个 quickPrompts zh / skills）+ team-agent.md（主理人 26.7KB 完整人设）+ avatars/（8 张 512 头像）+ README（来源溯源：WorkBuddy 专家市场 CodeBuddy Teams，个人自用副本）。
  - 6 个成员模板（策凌/笔澜/维欧/珀西/柯立/艾达）：member.json + agent.md（源 md 剥 YAML frontmatter 原样入库）；技能挂 `ai-content-production`。
  - `templates/skills/ai-content-production/`：SKILL.md + 6 份参考知识库（creative-strategy / image-generation / video-generation / generative-polish / video-editing-specs / content-adaptation）。
  - 客户端：SHIPPED_MEMBERS/TEAMS 增补；tab 由旗舰单面板 → `SHIPPED_TEAMS.map(teamPanel)` 每团队一块 workbuddy 面板（召唤/团队帮你做/名册/ID）；+ 菜单 popup 自动出现新团队与成员。
- 回归：`hasContentTeam=true`（ai-content-creator-team/teamPanel/map(teamPanel)/创意总监/素材改编/ai-content-production）+ 全部既有断言 + 菜单流程全绿（popup tail 实测含 维欧/珀西/柯立/艾达）、0 控制台错误。

## ⑱ tab 改名 Agent 管理 · 双页（团体 / 个体）（第十八轮，2026-10-12）

- 用户：「专家团模板tab（改名agent管理）的界面改成两个页面：一个页面是团体（一个专家团一张卡、默认折叠、展开含个体卡），一个页面是个体（按功能划分排布个体卡片）。」
- 结构：
  1. 命名：`header.action` / `panel.title` → 「Agent 管理」。
  2. `.oetPageSwitch` 分段切换（团体/个体），`.oetPageBtn.on` 高亮；`page` 本地 state。
  3. 团体页 `SHIPPED_TEAMS.map(teamCard)`：`.oetTcard`（buka 左缘卡）手风琴——**默认全部折叠**（`openTeams={}`），头行 ▸/▾ + 名称 + kind 标签 + 【召唤】【编辑】按钮（stopPropagation），恒显 路径/描述/主理人；展开 `.oetExpBody` = 团队帮你做 prompt 胶囊 + 成员个体卡网格（memberCard 复用，点击开 member.json / 导入按钮）。
  4. 个体页：`MEMBER_FUNC_ORDER=[research,content]` 分组 → `.oetSection`（投研 / 内容创作）+ 个体卡网格；SHIPPED_MEMBERS 增 `func` 字段。
  5. 清理：删除面板/名册旧 CSS（oetPanel/oetTeamName/oetSummon/oetRoster/oetRow/oetAvatar/oetRowName/oetRole）。
- 回归：`hasAgentTabs=true`（Agent 管理/panel.page.teams|individuals/panel.func.research|content/teamCard/toggleTeam/oetPageSwitch/oetTcard/MEMBER_FUNC_ORDER/aria-pressed/oetExpBody）+ `runtimeStyleTag` 增 `hasPage`（.oetPageSwitch/.oetTcard）+ `hasContentTeam` 更新为 teamCard 断言 + 菜单流程全绿、0 控制台错误。

## ⑲ 抄入 WorkBuddy「用过的专家」（第十九轮，2026-10-12）

- 使用识别 → 抄模板：除 XrInterfaceArchitect 外全部入库（用户指定）；配套《WorkBuddy使用报告.md》落 `note/tmp/`。
- 新增 7 成员模板（func="game"，个体页新增「游戏开发」分组）：
  - game-design 包 4 位：narrative-designer / game-designer / game-audio-engineer / level-designer（人设原文去 frontmatter 复制）；
  - godot-roblox 包 2 位：godot-game-script-engineer / godot-shader-developer；
  - ui-designer：内建推荐 curated-experts 描述级精简人设（本地无完整包，member.json 标注 source）。
- 新增团队模板 `templates/teams/game-dev-team/`：制作人编排（sop 五步 + lead.prompt 铁律）+ 7 专家成员 + 3 quickPrompts；README 逐成员对应历史会话（2a524741 剧情 / c522cd29 数值 / b8769001 音频 / f525b7f3 关卡 / 2994fb36·b690ec9b Godot 脚本 / c240d3f6 shader / c33288d5 UI）。
- 客户端：SHIPPED_MEMBERS/TEAMS 增补；MEMBER_FUNC_ORDER=[research,content,game]；dict `panel.func.game`。
- 回归：`hasGameExperts=true`（game-dev-team/narrative-designer/godot-shader-developer/ui-designer/"panel.func.game"/叙事设计师）+ 全部既有断言 + 菜单流程全绿（popup 尾含 Shader 开发者 / UI 设计师）、0 控制台错误。

## ⑳ 卡片 UX 修正 + 团队卡「卡」化（第二十轮，2026-10-12）

- 用户反馈：成员卡「有两个导入成员」（右上 kind 标签与底部动作按钮同文案）；「专家团也做成卡片」；「召唤/导入除写提示词外还有什么方式」。
- 修复：成员 kind 标签 `import.member` → `panel.members`（成员模板 / Member templates）。
- 团队卡升级：卡头加入 `.oetTbadge`（TEAM_BADGE emoji，未知回退显示名首字）；折叠态在 主理人 行后加 `.oetChips` 成员预览（`.oetChip` 小胶囊，team.members 取 display）；展开态成员网格不变。
- 召唤方式对照（答复用户）：
  1. 输入框指令桥（v1，现状）——写 expert_*_deploy 到草稿回车；跨端（GUI/QQ/PAS）通用；
  2. UI 一键召唤（WorkBuddy/CodeBuddy Teams）——点「召唤」直接 spawn 子代理 + inbox，不经过输入框（本地 teams/*/inboxes 实证）；
  3. 斜杠指令/命令面板（Claude Code /agents TUI、DSH「+」菜单）——命令式选择；
  4. @ 提及自动路由（Claude Code subagents 补全、Cursor @Agent、GPT mention）——正文内 tag；
  5. 会话类型选择器（ChatGPT/Codex home 专家卡 → 新建即绑定该专家）。
  备选升级（待用户拍板）：a. 一键部署（卡片按钮自动提交草稿，免二次回车）b. @提及路由 c. 会话级专家团徽章/侧栏选择器。
- 回归：`hasTeamCardRich=true`（TEAM_BADGE/oetTbadge/oetChips/oetChip + member 标签不再含 import.member）+ 全部既有断言 + 菜单流程全绿、0 控制台错误。

## ㉑ 输入框 @ 提及路由（第二十一轮，2026-10-12）

- 用户选定 b（@ 提及路由）+ 定制语义：「在哪个对话 @，就在哪个对话的智能体团队里加入这些子代理」。
- 实现 `installMentionOverlay(ctx)`（apply 时安装一次，纯 DOM 监听，宿主版本无关、失败静默降级）：
  1. `MENTION_INDEX` = SHIPPED_TEAMS + SHIPPED_MEMBERS（snippet = `@模板名`）；
  2. 全局 input（capture）：`lastMentionAt` 取「最后一个 @ 至光标」（不含空白/第二 @，中英前缀均可）→ 前缀过滤 → `.oetMentionOv` 浮层（z-index 顶层、DHS 变量主题、最多 8 行）；
  3. keydown：↑↓ 移动、Enter/Tab 选中（preventDefault 不发送）、Esc 关闭；mousedown 外点关闭；行按钮点击选中；
  4. 插入：textarea 原生 value setter + input 事件、contenteditable execCommand insertText，随后 setComposerDraft(当前会话) 同步 + 400ms guard；
  5. 语义：@ 在哪个对话 → 该对话 Lead 收到提及即在本会话 expert_member_deploy / expert_team_deploy（spawn 入本会话智能体团队）。
- 字典 `panel.mention`（zh/en），tab 页脚提示。
- 回归：`hasMention=true` + 运行时 @ 补全（`mention.ok=true`：`@game-dev-` → 浮层命中「团队 game-dev-team 游戏制作团队」→ Enter 插入 `@game-dev-team`）+ `runtimeStyleTag.hasMentionCss` + 全套既有断言 + 菜单流程全绿、0 控制台错误。

## 1. 输入框「+」菜单栏目（已定稿：见 ⑪；本节为历史过程）

早期调研误判「无 + 菜单槽」→ 先落 `conversation.input.left`（＋ 导入按钮）+ 头部 action 面板；第十一轮按用户澄清改用 `commandUi.register` 贡献进「+」/「/」菜单（⑪），**＋ 导入按钮已移除**。`inputTriggers.registerSource({trigger:"command"})` 路线仍有效但仅影响「/」输入；官方命令行（file/goal/plan/feedback…）经 `SECTION_ROWS` 分组，未列名行（含我们的 expert-import）自动进「指令」区。

## 2. 专用 tab 怎么加（第八轮修订：已打通）

`sidebar.right.pane.tab`（keyed，key = tab 类型 id）注册 body、`.tab.title` 注册标题——与 guide 同款。**类型挂载**经公开 reflect 服务 `sidebarRightTabs`（`client.js:9073 ctx.reflect.provide`，同 vision-command「internal/service」通道）：

- `tabs.register({ id, kind, priority:"extension", title:()=>t("..."), guide:[{id, title:()=>…, description:()=>…}] })`——开始页出现卡片（与「工作区文件」「新建终端」同栏；guide 条目经 `registry.refresh()`（8844-48）自动补 `kind/providerId`）。
- TabSlot 按 `definition?.id ?? tab.kind`（lib:5551）分派 body → body/title 的槽 key 必须 = 类型 id。
- 时序：大多数情况本 bundle 晚于 sidebar-right 应用（`apply` 时直接 get 得到）；兜底 `ctx.on("internal/service")` 等 `sidebarRightTabs` + 4s 安全检查。
- `ctx.reflect.get(name, false)` 客户端可用（cordis 核心，`cannot get property without inject` 同源头）。

## 3. 待定的开放项（修订后剩 1 个）

- B. **模板数据动态化**：宿主自定义 RPC（`plugins.bundle.config` 槽或 session event 桥）把 templates/ 清单推给客户端——v1 用内置静态名单 + 提示走 `expert_template_list`。

## 4-5. 命名红线与验收清单（保留）

槽位 key/id/源名全局唯一；`registerSource`/`register` 重复即抛错 → 全部包 `ctx.effect` disposer。验收清单补充：重启后顶部「专家团模板」tab + 输入框「+」/「/」菜单的「导入成员和专家团」栏目可用；点栏目 → 选模板 → 草稿出现部署指令 → 回车由 Lead 执行 `expert_*` 工具。

### ㉒ @ 浮层四类折叠（2026-10-12，用户反馈「@键浮窗太乱」）
- 前情：Round 21 浮层是 19 条成员的平铺列表；用户提出「按 文件/对话/智能体/导入智能体 分类，默认都折叠，不足补全」。
- 取证：e2e 敲真实按键 @/——宿主 conversation.input.overlay 是命令菜单（_3e4SsG_sectionTitle 分组「添加/指令/技能」，平铺不可折叠）；本插件浮层为自有实现 → 全责方在本插件。
- 落地：分组手风琴（默认全折叠；裸 @ 弹出；前缀自动展开命中组、隐藏空组、命中/总数徽标；头点击 ▸/▾；键盘导航保持）。四类语义：智能体=@提及加入当前对话团队；导入智能体=写入显式部署指令（与「+」菜单同款）；文件=打开模板文件；对话=复制会话 id。
- 边界说明：宿主自带的「@/指令」菜单（如果宿主版本有）属 DSH 壳层 UI，本插件不改主程序；本插件只整理自己的条目。
- 验证：mention.ok=true（裸 @ collapsed → 前缀展开 3 组 → Enter 得 @game-dev-team）；local hasMention/hasMentionCss 全绿。

## ㉓ 用户看到的 @ 弹窗 = 宿主原生 input-trigger 菜单；四类折叠直接做在原生弹窗上（2026-10-12，Round 23）

- 用户反馈（截图）：「这个可能是某个插件的@？或者是原生@，这个在你弄之前就有了。你弄的@我没看见」。
- **取证结论**（逐排除）：
  1. 实机 profile 的 lib/client.js 与工作区字节一致（Round 22 代码已实机安装），不是部署陈旧；
  2. e2e 空壳 profile（web-e2e）**没有**该弹窗；实机 profile 与 e2e 用**同一个 dsh 装子**（node.exe …@deepseek-ai\dsh\lib\bin.js，0.2.0-rc.2 bundle 集），弹窗功能在 dsh-client-ui-input-trigger（`input-trigger`：光标处 `/` 与 `@` 检测 + 分组候选菜单，README「为斜杠命令、文件引用和会话引用打开分组菜单」，zh 字典含「子智能体」）；
  3. 试装 dsh-context（bowenliang123，仅统计文案含子智能体）/ buka-assistant（QQ 助理，mention=回复模式）进 e2e → 均不产生 @ 弹窗 → 排除第三方；
  4. 原生菜单 DOM：`[data-slot="conversation.input.overlay"] > [data-trigger-menu]`（`_3e4SsG_menu`），分组头 `[class*="sectionTitle"]`、行 `button[role="option"]`（`_3e4SsG_item` + itemName/itemDescription）——**e2e 真实 Shift+2 键入即出现**，之前 probe 没看到是因为只 dump 了 fixed 弹层没看 overlay 槽内文。
- **为什么用户看不到我们自己的浮层（Round 21/22 的 .oetMentionOv）**：壳层 composer 对真实键入只派发 `beforeinput`（拦截 input、走自身 draft 管线）——我们当时只监听全局 `input`（capture）→ **真实按键路径从未触发我们的监听**；e2e 里确认（事件探针：真实 @ 只产生 keydown + beforeinput，无 input）。
- **落地 `installNativeMentionUpgrade(ctx)`**（纯 DOM MutationObserver + 幂等重入，宿主不匹配静默降级）：
  1. 原生 @ 菜单**各分组默认折叠**：分组头包起其后行（`[data-oet-grp-body]`，display:none）+ ▸/▾ 计数（`oetGrpChev`/`data-oet-grp-cnt`），点分组头展开/收起（aria-expanded）；`/` 指令菜单不碰（nativeRecentAt 时效窗 1.5s 内才算 @ 触发）；
  2. 末尾**注入「导入智能体 · 模板」分组**：克隆原生行样式（sectionTitle/item/itemName/itemDescription 类名），19 条模板（buildMentionSections import 组），点击行 = @提及 或 写部署指令（mentionSuppressAt 抑制回流 + closeNativeMenu）；
  3. **双浮层消除**：nativeMenuNow()（槽内 [data-trigger-menu] 可见性探测）→ 原生菜单出现即 hide 我们浮层（60ms 决策 + 420ms 复查；原生缺席回退我们浮层）；
  4. 幂等：不打一次性标记，React 每键重建菜单 → 观察器重注入渲染（去重按包 `[data-oet-import-group]` + 清理旧版 bug 裸残留 + wrapGroups 跳过注入分组头）。
- **触发补盲**：input / beforeinput / keydown 三路 capture（真实键入 beforeinput；合成 setVal input；Shift+2 兜底 keydown），共用 scheduleMention。
- 已知限制：注入组的行不参与原生 ↑↓ 键盘导航（鼠标点击可用）；每键重建使折叠态复位（默认折叠本身符合需求）。
- 验证：已部署实机 profile（sha==workspace）；e2e 回归全绿——`mention.ok=true`：真实按键 `@` → 原生菜单在（heads=[对话1,导入智能体19] 全 collapsed、hasImport、ourHidden=true）→ 展开导入组 → 19 行 → 点 game-dev-team → 输入框写入部署指令、菜单关、我们浮层仍隐藏；hasMention 增补 installNativeMentionUpgrade/nativeMenuNow/nativeRecentAt/mentionOverlayRef/injectImportGroup/closeNativeMenu/[data-trigger-menu]/data-oet-grp-body；hasNativeCss（[data-trigger-menu] [data-oet-grp]/oetGrpChev）；bundle hasNativeMention；全套既有断言 + 「+」/「/」菜单流程全绿、0 控制台错误；新工具 test/cdp-at-e2e.cjs（真实按键 @ 流）、test/cdp-slot-probe.cjs（槽 DOM 取证）、test/cdp-native-probe.cjs（触发器扫描）；e2e profile 补装 dsh-context/buka-assistant 对齐实机插件集。

### ㉓ 修订（用户实测反馈后定稿，2026-10-12 晚）
- 用户反馈：「可以把原生的其他@的也做成折叠的吗？你做的@显示的内容不对呀，对照原生的改一下或者删除不要这个了」。
- 三个动作：
  1. **删除自绘 @ 浮层**（installMentionOverlay + .oetMentionOv 全套 CSS/监听/状态）：它的「文件、对话」内容是静态模板数据，与原生菜单的真实文件/最近会话对不上（用户判定「内容不对」），且与原生菜单并存造成「双弹窗」困惑。宿主原生 @ 菜单即唯一入口。
  2. **折叠覆盖所有原生 @ 分组**（不依赖时效窗）：原 1.5s fresh 窗在「停顿再输入」时会让 React 重建后的新分组不再折叠（用户截图「文件与文件夹」展开即此故障）；改为**按菜单类型判定**——viewport 首行 id 前缀 `dsh-slash-option-command-` = `/` 指令菜单 → 整个跳过（不折叠、不注入）；其余（文件/对话/子智能体…）在每次菜单重建时幂等重应用（wrapGroups 包头跳过、injectImportGroup 按组去重 + 清理旧版裸残留）。
  3. 注入组行点击不变：@提及 或 写部署指令（closeNativeMenu 关原生菜单），复用 supply thumb helper（ovComposer/ovVal/ovSet）仍在升级函数内。
- 回归更新：mention-bare 断言改 hasNoOv（页面无 .oetMentionOv）；新增 slash-clean 断言（`/` 菜单 grpN=0、impN=0、heads 保持 添加/指令 原样且未包裹）；bundle hasNoOverlay、runtimeStyleTag hasNoOverlayCss（代码/CSS 均不再含浮层串）；mention.ok 仍全绿、0 控制台错误；整体 sha==workspace 已部署实机。
- **已知限制**（沿用）：注入组行不参与原生 ↑↓ 键盘导航（鼠标点击可用）；每键重建使折叠态复位（默认折叠本身即需求）；`/` 菜单完全保持宿主原样。

### ㉓ 修订 2（Round 23b，用户「@展开之前不用加载 / @展开一行行排列不要列」）
- **懒加载**：injectImportGroup 的 body2 打 `data-oet-pending` 标记，分组头先渲染（仅计数 `rows.length`）；19 行按钮在**首次点击展开时**由 deferBuild() 同步创建（建一次缓存），React 重建菜单后分组重置、自然恢复懒加载 → 打开 @ 菜单不再预建 19 个行节点。
- **单列竖排**：CSS 追加 `[data-trigger-menu] [data-oet-grp-body]`（flex-column / 行 width:100% / 每 span 单行省略）+ `[data-oet-import-body]`（padding、描述 span flex:1 吃余宽）——所有折叠分组展开后一行一条，不排多栏。
- 回归：mention-bare 新增 `impBodyKids:0`（展开前 0 行）→ mention-expand `kids:19`（点击后建行并可见）→ mention.ok 全绿；slash-clean 与既有断言不变；0 控制台错误；已部署实机（sha==workspace）。

### ㉓ 修订 3（Round 23c，用户「卡片上的召唤和导入统一叫创建，然后以 @ 方式统一创建智能体团队」）
- **卡片动作统一为「创建」**：团队卡右上 `panel.summon`（召唤）→ `panel.create`（创建）；成员卡底部 `import.member`（导入成员）→ `panel.create`。字典 zh 创建 / en Create；`panel.summon` 键删除；`importCmd`/`draftInstruction`（部署指令短写）删除。
- **以 @ 方式统一创建**：新 `mentionCmd(kind, name)`——把 `@模板名` 写入当前会话输入框草稿（读 `[data-slot="conversation.draft"]`，有未发送草稿时 `草稿 + " " + @name` 追加、不覆盖；无则仅 `@name`），回车发送即按 @ 提及语义把模板创建进**当前对话**的智能体团队（与原生 @ 菜单「导入智能体」提及动作一致，形成唯一创建入口：卡片 / @ 菜单两条路都落 @ 提及）。
- 回归：local 断言新增 hasCreateBtn（panel.create + 两处 mentionCmd 接线 + 无 panel.summon/importCmd）；既有断言全绿；卡片 DOM 运行时探针因 e2e 状态机到不了对话视图只作日志取证（写入通道 setComposerDraft 与 `+` 菜单共用、已验证）。

### ㉓ 修订 4（Round 23d，用户「统一成 @ 方式」）
- **三条创建入口统一为 @ 提及**：`+`/`/` 菜单 popup（installImportContribution.onSelect）与 @ 菜单「导入智能体」分组行点击，选模板后的落草稿从「请用 expert_team_deploy / expert_member_deploy …」显式指令改为 **`@模板名`**；与卡片「创建」（mentionCmd）完全同一条通道——在哪个对话发送，模板就创建进哪个对话的智能体团队。
- 清理：`import.kind.*` 字典键（zh/en）删除、`fill(import.kind.*)` 两处用法删除、menu.desc/相关注释改为 @ 文案；`fill` 函数保留（其余调用点回退兜底）。
- 回归：draft-poll 断言 `in-field:@trading-team`（+ 菜单）；mention-after 断言 `"@game-dev-team"`、mentionOk 收紧为纯 `@提及` 判定；全套 e2e 全绿、0 控制台错误；已部署实机（sha==workspace）。

### ㉓ 修订 5（Round 23e，用户实测「@ 怎么选不中导入智能体」）
- **根因**：原生触发器菜单在 mousedown **捕获阶段**自行关闭/重绘并夺焦（或直接卸载行节点），注入行按钮的 click 永远不触发；且行选择依赖 `document.activeElement`，菜单夺焦后 `ovComposer()` 返回 null——点击看似无反应。
- **修法**：
  1. 行选择**在 mousedown 阶段立即执行**（`act()` 统一处理 mousedown/click/keydown(Enter|Space)，`picked` 标志防重入、防 mousedown+click 双触发重复插入）；closeNativeMenu 收尾关菜单。
  2. `ovComposer` 增加 **`lastComposer` 缓存**：upgrade() 在菜单可见、焦点尚在编辑框时记录引用；activeElement 不再是编辑框时回退到缓存（`isConnected` 校验）。
- 回归：mention-after 仍为 `"@game-dev-team"`（无重复 `@@` 证明防抖生效）；全套 e2e 全绿、0 控制台错误；已部署实机（sha==workspace）。

### ㉓ 修订 6（Round 23f，用户「@ 好慢 / 导入智能体为什么显示不一样，做成对话那样的行」）
- **慢**：observer 每键/每次菜单重建都同步跑全量 upgrade（viewport/heads/行扫描 + 换行重组）→ 拖慢 @ 打开。改 **setTimeout(0) 节流**（同步批合并为每帧一次）+ 只观察 `childList`（去掉 attributes）。
- **行样式**：注入行从「手工 button+2 span」改为 **deep-clone 原生行**——`button[_3e4SsG_item]` 内含 `_3e4SsG_itemIcon`(svg) + `_3e4SsG_itemName` + `_3e4SsG_itemDescription`，与「对话」原生行同构（带图标）；clone 后去 id（防重复）、去 aria-selected、去 `_active`（防全行高亮）、tabIndex=-1；选择仍 mousedown 首选 / click / keydown 三路。
- **验证**：新增 test/cdp-rowdump.cjs（真实 Shift+2 `@` → 展开导入组 → dump 行 outerHTML → 真鼠标 pressed/released 点行 → 读草稿）。实测：克隆行 outerHTML 与原生行同构；点 trading-team 行后草稿 `@trading-team`、菜单关闭。诊断环境备注：本轮 e2e 全量曾因 Start-Job 起的 server 随工具进程退出而全挂（页面「无法访问此网站」）——run_in_background 常驻 server 后恢复，属驱动环境问题非回归。

### ㉓ 修订 7（Round 23f-2，用户截图「咋是这样的」）
- **`导入智能体1919` 双计数**：withChevron(h2, rows.length) 内部已追加 `data-oet-grp-cnt`，injectImportGroup 又手工 append 一个 cntSpan → 1919。删手工 cntSpan → `导入智能体19`。
- **克隆行描述消失**：Round 23b 的 `[data-trigger-menu] [data-oet-grp-body] button{display:flex;...}` 等布局规则（(0,2,1) 特异性）压过克隆行自身的 `_3e4SsG_item`（(0,1,0)）grid 布局，名称+描述被挤进单排，描述 0 宽。改为所有布局规则只命中**无原生类**的回退行：`button:not([class*="_3e4SsG"])`——克隆行 100% 原生样式渲染。
- 验证（rowdump + getComputedStyle 取证）：头 `▾ 导入智能体19`；行 display=flex（原生自身）、描述 `itemDescription` 计算宽 447px、文本完整；真鼠标点行 → `@trading-team`、菜单关；已部署实机。

### ㉓ 修订 8（Round 24，用户「算了把 @ 的修改取消，用 / 指令就可以了」）
- **回退**：删除整个 @ 菜单升级（Round 21-23 全部）——折叠包裹 wrapGroups / 注入组 injectImportGroup / 行 deep-clone / mousedown 选择 / MutationObserver 节流 / `[data-trigger-menu]` CSS（含 oetGrpChev、data-oet-grp-*）/ panel.mention 字典 / buildMentionSections·MENTION_SECTIONS·lastMentionAt（client.js 946 → 618 行）。宿主原生 @ 触发器菜单零改动：分组原样、无注入、无浮层。
- **保留的 @ 方式创建入口**（写 `@模板名`、回车发送即部署到当前对话）：`+`/`/` 指令菜单「导入成员和专家团」installImportContribution；模板卡片「创建」mentionCmd。均未动。
- 验证：e2e ⑪ 重写为「原生未被触碰」（mention ok:true：菜单在、noOetGrp/noOetBody/hasNoOv、Esc 后输入框仅剩 `@`）；bundle/local/style 负断言 hasNoMentionUpgrade / hasNoNativeMentionUpgrade / hasNoAtMenuCss 全真；`/` 选模板 → 草稿 `in-field:@trading-team` 不变。test/cdp-rowdump.cjs 归档（特性移除后不再运行）。已部署实机（sha==workspace）。

### ㉓ 修订 9（Round 25，用户「/ 和卡片创建，都以 /+专家团或者成员显示在对话框」）
- 两处创建入口草稿由 `@模板名` → **`/模板名`**：installImportContribution.onSelect（`var text = "/" + name`）与卡片 mentionCmd（`var text = "/" + name`）；字典 menu.desc / panel.hint zh/en 与文件头注释同步为「/指令形式」。
- 验证：local hasCmdRoute / hasCreateBtn（断言源码 `"/" + name`）全真；served 指令菜单行描述文本已显示新文案（运行时 bundle 已是新代码）；e2e 交互级 '/' 弹层在本机环境存在独立启动态问题（Round 24 未动代码时同样复现；test/cdp-slash.cjs 聚焦探针归档），非本轮回归。已部署实机（sha==workspace）。

### ㉓ 修订 10（Round 25b，用户截图 /kantu 行：「学习别的插件怎么弄的，/后面蓝色表示指令，灰字提示；我们的格式就是 /指令 + 专家团/成员名字」）
- 参照 dsh-vision-command（/kantu，宿主 commands 服务注册 → `<name>` 青色 + `input.hint` 灰字），把我们的 commandUi 行样式对齐：栏目行 `label: "/expert-import"`（首段指令名）+ `description:` 短灰字「专家团 / 成员名字 —— 选中即写入 /模板名 到当前对话」；popup 选项行 label 带 `/` 前缀（`/trading-team · 交易分析团队`，灰字 description）。草稿写入保持 `/模板名`。
- 验证：全套 e2e 回归绿（mention ok:true、bundle/local/style 全真）；e2e '/' 交互弹层仍受既有环境 flake 限制。已部署实机（sha==workspace）。

### ㉓ 修订 11（Round 26，用户「/narrative-designer 继续呀……应该像代码执行一样快速创建该子智能体到智能体团队」）
- 宿主无 agent 服务（已查 @deepseek-ai\dsh\lib 无 team 相关），创建走模型侧 expert_*_deploy 工具。把两处写入（onSelect / mentionCmd→deployDraft）改为**单步原子部署指令**：`/名字：请立即执行 <tool>（模板 <name>，目录 templates/<teams|members>/<name>/）把<专家团|子智能体>创建到本会话智能体团队并展示工作目录。直接执行，不要解释，不要询问。`——模型机械调一次工具即完成。
- menu.desc（zh/en）同步；说明：手打 `/名字` 无入场路径，需走 `/` 菜单或卡片「创建」。
- 验证：全套 e2e 回归绿（mention ok:true、hasCmdRoute/hasCreateBtn/hasNoMentionUpgrade 全真）。已部署实机（sha==workspace）。

### ㉓ 修订 13（Round 27，用户：「fresh/fork 以及子智能体的模型选择，以上两个在 / 指令打出来后进行选择」「别的指令是蓝色的…点击有反应…直接执行的」）
- e2e 实测（test/cdp-menupeek.cjs v2，plus 打开/菜单+滚动）确认宿主指令行与本贡献行同构三段（label+name+desc），深色主题下指令名非蓝色——观感差异在 live 主题/激活态；menu.desc 注明「先选参数再选模板」。
- 参数选择：popup 顶部新增「上下文 fresh/fork」「模型 follow」参数行（单层弹层限制→参数先行，选中提示再选模板）；模板行 label 带 `［fresh/fork］`、hint 带参数摘要；onSelect 写带参原子指令（`context=…, model=follow`）。
- 验证：全套 e2e 回归绿（同上）。已部署实机（sha==workspace）。后续可选：注册宿主真 host commands（server bundle，仿 dsh-vision-command）实现「点模板即执行、不留草稿」。

### ㉓ 修订 14（Round 28，用户贴 /kantu 截图「能不能学习这个插件的设置？」）
- 学习 /kantu 的宿主 commands 机制：在 lib/index.js（已有 expert_* 四工具）补注册 **slash 指令 `/expert-import`**（input.hint 灰字 + 回车即执行 handler；handler 解析 `<模板名> [--ctx fresh|fork] [--model 跟随|名称]` → 校验模板 → 返回单步原子部署指令）；client 弹层入口改名 **expert-pick** 避开与宿主指令同名碰撞（label 仍「导入成员和专家团」，desc 提示直输 /expert-import 回车创建）。
- 验证：e2e 菜单实测宿主行 `expert-import` + 灰字 desc（含用法）；client expert-pick 无碰撞（0 错误）；全套回归绿；test/cdp-hint.cjs 新增（headless 合成输入下 claim 灰字受系统缺口限制，待实机确认）。live Junction 生效；server 侧需重启 DSH web 进程。

### ㉓ 修订 15（Round 28c，用户「/ 实现了，把导入成员和专家团这个去掉。然后卡片创建则点击之后自动输入好/以及相关配置」）
- 移除 client commandUi 弹层（「导入成员和专家团」行/参数行/menu.* 字典/installImportContribution 全删，apply 不再注册）。
- 创建入口 = 宿主 slash `/expert-import`（菜单 expert-import + 灰字用法，回车即执行）+ 卡片【创建】自动写宿主指令草稿 `/expert-import <模板名> --ctx fresh --model follow`（回车走宿主通道，参数可改 --ctx fork）。
- 验证：cdp-hint 菜单文本含 expert-import + 灰字 desc 且无「导入成员和专家团」行；server 日志 registered slash；local marks（hasNoCommandUiContribution/hasNoMenuShell/hasCmdRoute/hasCreateBtn）全真；mention ok:true、0 错误。live Junction 生效（client Ctrl+F5；server 23:13 已加载）。
