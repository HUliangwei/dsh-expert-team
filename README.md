# dsh-expert-team

DSH **智能体团队**插件：把「模板目录」变成 Agent Teams 的一键部署能力。
- 成员模板（`templates/members/<name>/`）与专家团模板（`templates/teams/<name>/`）**同级**放于规范目录。
- 部署时从模板加载：**一次加入一整个专家团**（`expert_team_deploy`），或**单独加入一个成员**（`expert_member_deploy`）。
- 不接入 PAS；纯粹扩展现有 Agent Teams（`@deepseek-ai/dsh-experimental-agent-team`）。

## 目录规范

```
dsh-expert-team/
├── cordis.patch.yml          # profile bundle 挂载（id: expert-team）
├── lib/
│   ├── index.js              # cordis 插件：按成员 scope 安装工具（Lead 才有部署工具）
│   ├── templates.js          # 模板发现/解析（DSH_EXPERT_TEAM_TEMPLATES 可覆盖根目录）
│   └── deploy.js             # 模板 → spawn 请求 + 团队协作铁律
├── templates/                # ★ 规范目录
│   ├── members/
│   │   ├── researcher/       # 成员模板 = member.json + agent.md
│   │   ├── reviewer/
│   │   └── market-analyst/
│   └── teams/
│       └── trading-team/     # 专家团模板 = team.json（引用成员模板）
└── README.md
```

### 成员模板 `templates/members/<name>/`

| 文件 | 内容 |
|---|---|
| `member.json` | `name` / `displayName{en,zh}` / `profession{en,zh}` / `description` / `maxTurns`(可选) / `skills[]`(可选) / `provider`(可选) |
| `agent.md` | 提示词正文：人设、方法论、输出规范、纪律 |

### 专家团模板 `templates/teams/<name>/team.json`

```json
{
  "name": "trading-team",
  "displayName": { "en": "...", "zh": "交易分析团队" },
  "description": "一句话团队定位",
  "sop": "可选：本团队专属协作流程（如 4 阶段流水线）",
  "lead": { "profession": { "zh": "主理人..." }, "prompt": "主理人编排文案（可选 template 引用）" },
  "members": [
    { "name": "researcher", "template": "researcher" },
    { "name": "analyst", "template": "market-analyst" }
  ]
}
```

## 模型侧工具（随 Agent Teams 一并作用域安装）

| 工具 | 谁可用 | 作用 |
|---|---|---|
| `expert_template_list` | 全体成员 | 列出成员/专家团模板 |
| `expert_team_manifest` | 全体成员 | 部署预演（渲染将创建的 lead + 成员清单，不 spawn） |
| `expert_member_deploy` | 仅 Lead | 单独导入一个成员模板 → teammate |
| `expert_team_deploy` | 仅 Lead | 整体导入专家团：`{team}-lead` + `{team}-{member}` |

命名即契约：roster 名字永久不复用，团队部署一律带团队前缀防冲突；失败/占位名字也永久占用。

## 接入 profile

```sh
# 1) node_modules 里放链接（profile 部署目录）
New-Item -ItemType Junction "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-expert-team" "D:\Desktop\MYNOTE\project\dsh-expert-team"
# 2) profile package.json 的 dependencies + dsh.profile.bundles 加入 dsh-expert-team
# 3) 验证组合与工具
dsh --profile web --dump-config
# 4) 重启 DSH（宿主 bundle 重启后对 agent 全局可见）
```

## 运行时验证记录

- 2026-10-12（Round 3）：`dsh --profile headless --patch test/headless-teams.patch.yml` 真机启动验证。
  - 修复 Bug 1：cordis 插件直读 `ctx.agentTeams` 未声明 inject 抛 "cannot get property without inject" → 改为 `ctx.reflect.get`（对齐 dsh-vision-command 玩法）。
  - 修复 Bug 2：纯对象 tool 注册的 output schema 不是标准 JSON Schema（`required` 应为数组、条目内禁止布尔 `required`）→ 全部改为对象级 `required: [...]`。
  - 修复后启动日志：`[expert-team] installed expert-team tools for lead (lead)` —— 4 工具在 Lead scope 注册成功。
- 2026-10-12（Round 4）：模型驱动 E2E 全矩阵通过（headless profile + web 同款 apiqpqi 组内网关；钥匙取 `.dsh/.credentials.yaml`）。
  - 修复 Bug 3：`expert_team_deploy` 输出校验报 `value.lead must be an object` —— 旧写法用 `{ role, ...member }` 标记行次，member 自带 `role` 字段时会覆盖标记、`lead` 变 null；改为独立变量直接返回 `{ team, lead, members }`。
  - 验证项：`expert_template_list`（3 成员 + 1 团队）、`expert_team_manifest`（trading-team → lead + 3 成员清单）、`expert_team_deploy`（prefix=e2e-final：lead + researcher/analyst/reviewer 全部 spawn、返回干净）、`expert_member_deploy`（asName=e2e-solo-r 正向通过；撞名正确拒绝）、spawn 后成员自动运行并向 Lead 发「就绪」消息、成员 scope 自动安装工具（日志 `installed … (teammate)`）。
  - 复现：`dsh --profile headless --patch test/headless-teams.patch.yml "<任务>"`（先注入 APIQPQI_API_KEY，见上）。
- 2026-10-12（Round 6）：**客户端浏览器级 E2E 通过**（web-e2e 一次性 profile + headless Chrome + CDP 驱动 `test/cdp-e2e.cjs`）。
  - 修复 Bug 4：`lib/client.js` 的 `makeT` 把 props 对象当函数调用（`p is not a function`，被 SlotErrorBoundary 捕获后仅丢该槽入口）→ 改为取 `props.t`；该 bug 只有真实浏览器渲染才暴露。
  - 实测：输入栏「＋ 导入」按钮渲染 → 点击出「智能体团队模板」面板（trading-team/researcher/market-analyst）→ 点 trading-team → 草稿框出现 `请用 expert_team_deploy 导入专家团 trading-team（先 expert_team_manifest 预演）`；全程无控制台错误；截图 `test/cdp-out/shot.png`。
- 2026-10-12（Round 8）：**③ 右侧栏「模板管理」tab 打通并浏览器级验证**（修正此前「kind 挂载被上游私有注册表拦截」的结论）：
  - 公开通道实锤：`dsh-client-ui-sidebar-right/lib/client.js:9073` 有 `ctx.reflect.provide("sidebarRightTabs", registry)`——与 vision-command 同款 reflect 服务通道，任何 bundle 可 `ctx.reflect.get("sidebarRightTabs", false)` 后 `tabs.register({id, kind, priority:"extension", title, guide})`。
  - `guide` 条目 = 右侧栏**开始页卡片**（与「工作区文件」「新建终端」同栏）——正是「图像工作台/上下文」出现在那里的机制。
  - 落地：`lib/client.js` 注册类型 `expert-team/templates`（kind `expert.team`），开始页卡片「专家团模板」→ 点开 → tab 体渲染完整管理视图（专家团/成员清单+导入标签+部署提示）；body/title 槽 keyed 注册 key 也用类型 id（TabSlot 按 `definition.id ?? tab.kind` 分派）。
  - 实测（CDP）：`guide-cards: [{kind:"expert.team",...}, {kind:"files",...}, {kind:"terminal",...}]` → 点击卡片 → `tabBody: 智能体团队模板 / 专家团模板 trading-team / 成员模板 researcher·reviewer·market-analyst`；截图 `test/cdp-out/shot.png`。
  - 尾随用户实操（真机顶部 tab 条：对话/轨迹/上下文/画廊/buka助理/工作台/专家团模板 并列实拍确认）→ 追加升级 **tab 体为完整管理页**：团队卡片（显示名/描述/主理人/成员 chips/4 阶段流程）+ 成员卡片（定位/描述/技能），CDP 复验通过（`trading-team 交易分析团队 / A股/港股/美股投资分析：信息收集 → 技术面分析 → 复核风控 → 最终建议 / 主理人：主理人（投资分析编排）`）。
- 2026-10-12（Round 9/10）：**Tab 主挂点换轨 conversation.view（buka 助理同款）**。
  - ⑨ 分层实测：宽视口（1600）tab 为 `panel:"push"` 停靠、无浮层（`test/layer-probe.cjs`）；「顶层全宽条」外观 = DSH 全局 `autoFullscreen`（viewportWidth<768，sidebar-right lib:5727）对**所有** tab 一视同仁，非本 tab 特有。
  - ⑩ 用户要求「参照 buka 项目的 buka助理 tab 放在那里」→ 查明 buka 助理/画廊/上下文 = **`conversation.view` 槽**（list，`register({name,id,order,label})`；画廊 image-gen order 20 / buka order 30）→ 主挂点从 sidebar-right 改为 `conversation.view`（id `expert-team-templates`，order 30 与 buka 并列，label 专家团模板），**移除** sidebar-right 类型/卡片/body/title 注册（见 `lib/client.js` 头注释与 `noPaneSeats` 断言）。
  - **事故记录（你实机「web boot: 1 entry did not activate / import failed: inject is not defined」根因）**：换轨重写 apply 时误删 `var inject = ["slots","locale","sessions","uiWorkspace"]`（exports.inject 引用丢失）→ 你以 `cordis.patch.yml` 的 `- id: expert-team / disabled: true` 兜底恢复 → 已修复补回并解除该禁用行；`node --check` + web-e2e 回归全绿（输入栏流程 / served bundle 标记 / 本地产物无 `sidebar.right.pane.tab`）。重启 GUI 后「专家团模板」出现在 对话/轨迹/上下文/画廊/buka助理/工作台 同条，点击面板内打开完整管理页。
- 2026-10-12（Round 11）：**导入入口改挂输入框「+」/「/」菜单（`commandUi` 贡献）**。
  - ⑪ 用户澄清：「我说的+是左下角这个+，不是让你再做一个+导入」→ 原 `conversation.input.left` 的「＋ 导入」按钮**移除**，改为与 `反馈`(message-feedback) 同款机制：`ctx.inject(["commandUi"], scope => scope.commandUi.register(...))` 注册 `expert-import` 贡献（label「导入成员和专家团」，说明「选择模板 → 部署指令写入输入框，回车交给 Lead」），`ui.kind:"popup"` 选项 = SHIPPED_TEAMS/SHIPPED_MEMBERS，`onSelect` → `conversation.input.for(binding.ctx).setDraft(...)` 写入部署指令草稿（`setComposerDraft`，失败 console.warn 兜底）。
  - 输入框「+」（`aria-label=添加文件或调用指令`）与「/」共用一个 trigger 菜单（`dsh-client-ui-input-trigger` + `dsh-client-ui-commands` 合并渲染：添加/指令 分组 + 未列名行追加进「指令」区）。
  - 浏览器级 E2E 全绿：点「+」→ 菜单 DOM 含 添加(文件/目标/计划/反馈) + 指令(压缩/权限/模型/下载日志) + **导入成员和专家团/expert-import/选择模板→…** → 真实鼠标点击行 → popupSelect 四项（trading-team·交易分析团队 / researcher·研究员 / market-analyst·技术分析师 / reviewer·评审）→ 选 trading-team → **草稿 `请用 expert_team_deploy 导入专家团 trading-team（先 expert_team_manifest 预演）`**；全程 0 控制台错误；`hasImportBtn=false`（＋导入 按钮已消失）；served bundle/local 标记含 `commandUi.register`/`menu.label` 且 `noPaneSeats=true`。
  - 说明：菜单行点击需真实鼠标事件（`el.click()` 不触发行 pick）；headless 验证全部走真实用户路径完成，无 harness 兜底。
- 2026-10-12（Round 12）：**移除对话头部「专家团模板」按钮**（用户：「智能体团队边上那个专家团模板去掉」）。
  - ⑫ 删除 `conversation.session.header.actions`（id `expert-team`，order -20）注册及其 `HeaderAction`/`TemplatesPanel`/`TemplateRow`/`writeDraft` 组件与 `panelStyle`/`listStyle`/`rowStyle` 样式（`chipStyle` 被 tab 复用保留）；字典删 `header.open`/`panel.written`。
  - 挂载点收敛为两个：**①** 输入框「+」/「/」菜单栏目（commandUi 贡献）+ **③** 顶部 `conversation.view` tab——都不在对话头部，不再与 agent-team「智能体团队」按钮并排。
  - 回归（web-e2e）：`noHeaderSeat=true`（代码级断言：无 header.actions 注册/HeaderAction/panel.written）、`noImportBtnCode=true`、菜单流程全绿（+ → 导入成员和专家团 → trading-team → 草稿部署指令）、0 控制台错误。
- 2026-10-12（Round 13）：**tab 页改卡片交互：点卡片开编辑器 / 点【导入】写短指令 / 卡片显示目录路径**。
  - ⑬ 用户：「在专家团模板tab点击导入成员，将相关指令加入到对话框。我建议做成指令，不要将大段文字写入系统提示词。每个专家团和成员的模板做成卡片，点击打开该模板的编辑，卡片显示该模板的目录路径。」
  - 卡片交互（`TemplatesTabBody`）：
    - 每张团队/成员卡片显示模板目录路径（等宽字体）：`templates/teams/<name>/team.json` / `templates/members/<name>/member.json`。
    - **点整张卡片** → `ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, PLUGIN_WORKSPACE_PREFIX + 目录))`——dsh-resource 文件地址（抄 ui-skill 的 workspace-path 工具）在右侧编辑器打开该模板的 team.json/member.json；工作区相对前缀 `PLUGIN_WORKSPACE_PREFIX="project/dsh-expert-team"`（真实 GUI 工作区 = D:\Desktop\MYNOTE 时成立），失败 console.warn + 卡片内提示。
    - **点【导入专家团/导入成员】chip**（真按钮，stopPropagation）→ `setComposerDraft` 只把一行**短指令**写入输入框草稿（`import.kind.*`：`请用 expert_team_deploy 导入专家团 trading-team…` / `请用 expert_member_deploy 导入成员模板 researcher`）——不粘模板描述/技能/sop 进系统提示词。
  - 会话定位：`conversation.view` 注册带 `inject: key => ({tabSessionId})`（renderer 对会话作用域槽回调 entry.inject(bindingKey)，feedback 同款契约）；组件内 `activeSessionId(ctx)` 兜底（sessions.list 主视图保留会话，dsh-client-ui-session 同源逻辑）。
  - `inject` 增补 `sidebarRight`。回归：web-e2e `hasTabTools=true`（fileAddressFor / openTemplateEdit / PLUGIN_WORKSPACE_PREFIX / panel.path / tabSessionId / sidebarRight / member.json 断言）+ 菜单流程全绿。tab 交互（开编辑器/写草稿）依赖真实 GUI 会话作用域 → 实机验证。
- 2026-10-12（Round 14）：**卡片交互可视化（hover / 聚焦 / 按下 / 键盘可达）**。
  - ⑭ 用户：「卡片缺少聚焦高亮这些交互可视化」→ 内联 style 无伪类，动态注入 `<style data-plugin-css="dsh-expert-team-tab">`（dsh-client-ui-skill 同款 data-plugin + data-plugin-css 幂等去重，apply 时 `injectTabStyles()`）：
    - `.oetTabCard`：`cursor:pointer` + 边框/背景/阴影过渡；`:hover` 主题色描边 + 淡高亮底 + 阴影；`:focus-visible` 主题色 2px outline；`:active` 加深底。
    - `.oetTabChip`（导入按钮）：`:hover` 亮度 1.12；`:focus-visible` outline；`:active` 亮度 0.94。
    - 卡片 `role="button"` + `tabIndex:0` + `aria-label`（含模板目录）+ Enter/Space 触发开编辑器（`pressEnter`）。
  - 回归：运行时探针 `runtimeStyleTag {tag:true, hasHover:true, hasFocus:true}`（style 标签真的注入 document.head）+ `hasCardCss=true` 代码断言 + 菜单流程全绿、0 控制台错误。
- 2026-10-12（Round 15）：**卡片视觉升级为 buka 助理同款**。
  - ⑮ 用户：「你可以效仿buka助理那种卡片效果」→ 对照 buka 的 `src/client/styles.ts`（.bk-grid/.bk-card/.bk-kind/.bk-actions）重做我们的 tab 卡片：
    - **响应式网格**：`.oetGrid { grid-template-columns: repeat(auto-fill, minmax(250px,1fr)); gap:10px }`（buka .bk-grid 240px 同款），团队/成员各一组。
    - **卡片**：10px 圆角、`border-left-width:3px` 彩色左缘（团队=品牌蓝 `--dsw-alias-brand-primary`，成员=紫 #a855f7，对应 buka .bk-card.ok/.remote 语义色）；`background: bg-layer-1`；**hover 仅底色加深**到 bg-layer-2（buka 的克制做法，无描边/阴影）；`:focus-visible` 品牌色 1.5px 内嵌 outline（buka .sel 同款）；`user-select:none`。
    - 卡片内容行：`.oetCardName`（13px/600 超长省略）+ `.oetKind` 小标签（team/member 着色，buka .bk-kind 同款）+`.oetPath`（11px 等宽目录路径，buka .bk-card-ep 同款）+ `.oetDesc`/`.oetMeta`（12px 次级色）+ `.oetChips`（成员小胶囊）+ **`.oetActions` 底部 `.oetBtn` 按钮**（buka .bk-btn 同款：细边框、hover 品牌色描边+文字）承载「导入专家团/导入成员」。
    - 区块标题 `.oetSection`（buka .bk-group-t：11.5px/600/次级色/下边框）。
  - 清理：删 cardStyle/chipStyle/sectionTitleStyle 内联函数与旧 CARD_CLASS/CHIP_CLASS；可达性保留（role/tabIndex/aria/pressEnter）。
  - 回归：`runtimeStyleTag {tag:true, hasGrid:true, hasHover:true, hasFocus:true, hasBtn:true}`（buka 套类真实注入 document.head）+ `hasCardCss=true`（10 项断言）+ 菜单流程全绿、0 控制台错误。
- 2026-10-12（Round 16）：**tab 页面按 workbuddy 专家团复刻**（用户：「workbuddy上的专家团你能直接抄过来吗？」）。
  - ⑯ 对照 workbuddy「内容创作专家团」页（截图：页头 团队名+V1.0.0+召唤 / 团队帮你做 3 条示例 prompt / 团队成员头像名册 / 底部 ID）重做 tab 页：
    - **页头**：专家团模板 + `V1.0.0` 版本胶囊（`.oetVersion`）+ 行为提示。
    - **团队面板**（`.oetPanel`，buka bk-panel 同款底）：团队名·显示名 + 右侧「**召唤**」主按钮（`.oetSummon`，品牌蓝实心）→ 部署指令入草稿 → 描述（`.oetDesc`）→ **团队帮你做**（`.oetPromptLabel` + `.oetPrompt` 胶囊 ×3，数据 `team.prompts`，点击把 prompt 写入草稿）→ **成员名册**（`.oetRoster > .oetRow`：圆形头像 `.oetAvatar`（主理人=蓝/成员=紫，首字）、姓名·name、右端角色胶囊 `.oetRole`（职业）；主理人行点击=开 team.json 编辑，成员行点击=该成员部署指令入草稿）→ **ID 行**（模板目录路径，`.oetPath` 等宽，对应 workbuddy ID 栏）。
    - **成员模板卡片网格**保留（buka 卡片 + oetBtn 导入）。team.prompts 三例对应 researcher/market-analyst/reviewer 职责。
  - 回归：`hasWorkbuddy=true`（oetSummon/oetPrompt/oetRoster/oetAvatar/oetVersion/prompts/panel.do/panel.summon 断言）+ 全套既有标记 + 菜单流程全绿、0 控制台错误。
- 2026-10-12（Round 17）：**导入 WorkBuddy「内容创作专家团」zip 内容为可部署模板**（用户：「你能把workbuddy的专家团的zip的内容抄过来使用吗？」）。
  - ⑰ 定位包本体：`~/.workbuddy-ai/plugins/cache/experts/ai-content-creator-team/1.0.0/`（CodeBuddy Teams 出品，个人自用副本，README 溯源标注）。
  - 新增模板：`templates/teams/ai-content-creator-team/`（team.json：sop/lead.prompt/members/prompts[3 个 quickPrompts]/skills；team-agent.md = 主理人司远完整人设；avatars/ 8 张头像；README 溯源）+ 6 个成员模板 `templates/members/{creative-strategist|copywriter|video-generator|image-creator|video-editor|content-adapter}/`（member.json + agent.md 人设原稿去 frontmatter，成员：策凌/笔澜/维欧/珀西/柯立/艾达）+ 技能知识库 `templates/skills/ai-content-production/`（SKILL.md + 6 份参考文档：策略/视频/图片/精修/编辑/改编）。
  - 客户端：SHIPPED_MEMBERS/TEAMS 增补内容创作团数据；tab 从「旗舰单面板」改「SHIPPED_TEAMS.map(teamPanel)」每团队一块 workbuddy 面板；+ 菜单 popup 同步列出新成员（实测 tail 含 维欧/珀西/柯立/艾达）。
  - 回归：`hasContentTeam=true`（ai-content-creator-team/teamPanel/SHIPPED_TEAMS.map(teamPanel)/创意总监/素材改编/ai-content-production）+ 全套既有标记 + 菜单流程全绿、0 控制台错误。
- 2026-10-12（Round 18）：**tab 改名「Agent 管理」，改为双页：团体 / 个体**（用户：「专家团模板tab（改名agent管理）的界面改成，两个页面，一个页面是团体，一个页面是个体。团体页面一个专家团一个卡片，然后做好默认折叠，展开包含个体的卡片。个体页面就是按照功能划分排布的个体卡片。」）。
  - ⑱ tab 标签与面板标题统一改为「Agent 管理」（header.action/panel.title）。
  - **双页切换**：`.oetPageSwitch` 分段控件（团体/个体，`.oetPageBtn` 高亮当前页），本地 state `page`。
  - **团体页**：`SHIPPED_TEAMS.map(teamCard)`——一个专家团一张 `.oetTcard`（buka 左缘卡），**默认折叠**（`openTeams` state 空对象），头部 ▸/▾ 手风琴（role=button + aria-expanded + pressEnter 可达）；展开区 `.oetExpBody` 含「团队帮你做」prompt 胶囊 + **成员个体卡网格**；卡头恒显 路径行/描述/主理人，右侧「召唤」（部署专家团）与「编辑」（开 team.json）按钮。
  - **个体页**：`MEMBER_FUNC_ORDER`（research/content）分组 → `.oetSection` 组标题（投研 / 内容创作，`panel.func.*` 字典）+ 同款个体卡网格（memberCard 复用）。
  - 数据：SHIPPED_MEMBERS 增 `func` 字段；删工作台旧面板/名册 CSS（oetPanel/oetRoster/oetAvatar 等）与新类共存。
  - 回归：`hasAgentTabs=true`（Agent 管理/teamCard/toggleTeam/oetPageSwitch/oetTcard/MEMBER_FUNC_ORDER/aria-pressed/oetExpBody/panel.func.*）+ `runtimeStyleTag hasPage=true`（.oetPageSwitch/.oetTcard 注入）+ `hasContentTeam=true` 更新为 teamCard 断言 + 菜单流程全绿、0 控制台错误。
- 2026-10-12（Round 19）：**把 WorkBuddy「用过的专家（除 XrInterfaceArchitect）」全部抄成模板**（用户于专家识别后指定；配套输出《WorkBuddy使用报告.md》到 `note/tmp/`）。
  - ⑲ 使用识别（assistant-display 会话绑定 + teams/tasks/subagents 证据）：1 专家团（AiContentCreatorTeam）+ 8 agent 专家参与《仙凡三国》生产季；game-design / godot-roblox 两包在本地，UiDesigner 仅内建推荐描述（无完整包）、XrInterfaceArchitect 用户排除。
  - 新增 7 成员模板：`templates/members/{narrative-designer|game-designer|game-audio-engineer|level-designer|godot-game-script-engineer|godot-shader-developer|ui-designer}/`（前 6 份人设从本地缓存包去 frontmatter 原样复制，ui-designer 为内建推荐风格精简人设，member.json 均带 `source` 溯源）。
  - 新增团队模板 `templates/teams/game-dev-team/`（游戏制作团队：制作人编排 + 7 专家并行，README 逐成员注明对应历史会话工作 + 未导入说明；game-design 包辅助 skills 861KB 未入库仅标注源路径）。
  - 客户端：SHIPPED_MEMBERS/TEAMS 增补 7+1；个体页新增**游戏开发**分组（MEMBER_FUNC_ORDER += "game"，panel.func.game 字典）；+ 菜单 popup 实测尾含 Shader 开发者 / UI 设计师。
  - 回归：`hasGameExperts=true`（game-dev-team/narrative-designer/godot-shader-developer/ui-designer/panel.func.game/叙事设计师）+ 全套既有标记 + 菜单流程全绿、0 控制台错误；报告 `note/tmp/WorkBuddy使用报告-2026-10-12.md`（安装/使用矩阵 + 时间线 + 证据路径）。
- 2026-10-12（Round 20）：**卡片 UX 修正 + 团队卡「卡」化 + 召唤方式调研**（用户反馈「成员卡怎么有两个导入成员」「专家团也做成卡片」「召唤/导入除了写提示词还有什么方式」）。
  - ⑳ 修复撞名：成员卡右上 kind 标签「导入成员」→「成员模板」（`panel.members`），与底部动作按钮语义分离。
  - 团队卡「卡」化：卡头加 **团队徽标**（TEAM_BADGE emoji：📈交易 / 🎨内容创作 / 🎮游戏制作，未知回退首字）；**折叠态增加成员预览 chips 行**（成员名小胶囊，一眼看出团队构成），保持默认折叠 + 展开成员卡网格不变。
  - 新 CSS：`.oetTbadge/.oetChips/.oetChip`。
  - 回归：`hasTeamCardRich=true`（TEAM_BADGE/oetTbadge/oetChips/member 标签不再用 import.member）+ 全套既有标记 + 菜单流程全绿、0 控制台错误。
  - 调研结论（召唤/导入方式对照，README docs）：主流 = ①UI 一键召唤（WorkBuddy/CodeBuddy Teams，点按钮直接 spawn 子代理，不走输入框）②斜杠指令/命令面板（Claude Code /agents、DSH + 菜单）③@ 提及自动路由（Claude Code subagent 补全、Cursor @Agent）④会话类型选择器（ChatGPT/Codex 新建时选专家）。本插件 v1 走「指令写入输入框」桥（跨端通用），可选升级：一键部署自动提交 / @提及路由 / 会话级专家团徽章（待用户拍板）。
- 2026-10-12（Round 21）：**@ 提及路由（c 落地 = 用户选 b + 定制「在哪个对话@就在哪个对话的智能体团队加入子代理」）**。
  - ㉑ 输入框 @ 自动补全浮层 `installMentionOverlay`（纯 DOM 监听，与宿主版本解耦、静默降级）：
    - 监听全局 input/keydown/mousedown（capture），检测「正在输入的 @词」（最后一个 @ 至光标、不含空白/第二 @，中英文前缀均可检索）；
    - `.oetMentionOv` 浮层（成员+团队合并索引 MENTION_INDEX，前缀过滤，↑↓/Enter/Tab 选中、Esc 关闭、点击行选中）；
    - 选中后插入 `@模板名`：textarea 走原生 value setter+input 事件（React 安全），contenteditable 走 execCommand insertText，并同步 setComposerDraft（当前会话）+ 400ms guard 防回流。
    - **语义**：@ 落在哪个对话 → 该对话的 Lead 收到提及后在本会话执行 expert_member_deploy / expert_team_deploy（spawn 即本会话智能体团队）。
  - 字典新增 `panel.mention`（zh/en），tab 页脚 + 提示。
  - 回归：`hasMention=true`（installMentionOverlay/MENTION_INDEX/oetMentionOv/execCommand/panel.mention/setComposerDraft/activeSessionId）+ 运行时 **mention.ok=true**：清空输入框 → 敲 `@game-dev-` → 浮层精确命中「团队 game-dev-team 游戏制作团队」→ Enter 插入 → 输入框出现 `@game-dev-team`；全套既有标记 + 菜单流程全绿、0 控制台错误。

## 规划（未实现）

- 模板数据动态化：宿主 RPC 把模板清单推给客户端（方案 B），替代 v1 的静态条目。
- 实现方案已调研定稿：见 [docs/CLIENT_UI_PLAN.md](docs/CLIENT_UI_PLAN.md)。

- 2026-10-12（Round 22）：**@ 浮层四类折叠**（用户反馈「@键浮窗太乱」）。
  - ㉒ .oetMentionOv 改为分组手风琴，**默认全折叠**：智能体（≈19 模板，点选/@ 提及→加入当前对话团队）、导入智能体（同模板，点选→写入显式部署指令）、文件（模板 team.json/member.json，点选→编辑器打开）、对话（最近会话，点选→复制会话 id）。
  - 裸 @ 即可弹出（lastMentionAt 允许空前缀）；输入前缀（如 @game-dev-）自动展开含命中的分组、隐藏空分组、显示命中/总数；分组头点击展开/折叠（▸/▾）；↑↓/Enter/Esc 键盘导航不变；字典新增 panel.mention.{agent,import,files,conv}（zh/en），新增 tl() 模块级 zh 读取器（t() 仅组件作用域）。
  - 回归：hasMention=true（installMentionOverlay/buildMentionSections/oetMentionOv/msec/msecBody/四类字典键/…）+ hasMentionCss=true（.oetMentionOv .msec/.msecBody.collapsed）+ 运行时 mention.ok=true：裸 @ → secs=[智能体,导入智能体,文件,对话]、全部分组 collapsed=true；补 game-dev- → 3 组自动展开、game-dev-team 行可见；Enter → 输入框含 @game-dev-team；全套既有标记 + 菜单流程全绿。

- 2026-10-12（Round 23）：**定位用户看到的 @ 弹窗 = 宿主原生（@deepseek-ai/dsh-client-ui-input-trigger · 0.2.0-rc.2），并把「四类折叠 + 模板分组」做到原生弹窗上**（用户：「如图，这个可能是某个插件的@？或者是原生@，这个在你弄之前就有了。你弄的@我没看见」）。
  - ㉓ 取证结论：截图弹窗 = **壳层原生 @ 触发器菜单**（[data-slot="conversation.input.overlay"] 内 [data-trigger-menu]；分组头 [class*="sectionTitle"]、行 button[role="option"]），渲染 文件/对话/子智能体 等最近项，**在我们插件出现之前就存在**；e2e 空壳 profile 无该菜单、实机 profile 确认已加载。我们 Round 21/22 自己的 .oetMentionOv 在实机「看不到」根因：**壳层 composer 对真实键入只派发 beforeinput（拦截 input 走自身 draft 管线），我们当时只监听 input → 真实按键路径从未触发**（e2e 里用合成 input 事件的流验证的是合成路径）。
  - 新能力 `installNativeMentionUpgrade`（纯 DOM MutationObserver + 幂等重入，宿主不匹配静默降级）：
    1. **原生 @ 菜单各分组默认折叠**（分组头包裹 [data-oet-grp-body] + ▸/▾ + 计数，点击展开/收起，/ 指令菜单不碰）；
    2. **末尾注入「导入智能体 · 模板」分组**（复用原生行样式克隆，19 条模板；点击行 = @提及 或 写部署指令，同我们浮层语义）；
    3. **双浮层消除**：原生菜单可见时我们的 .oetMentionOv 不再弹出（nativeMenuNow 探测 + 420ms 复查；原生缺席时 60ms 回退仍用我们浮层）。
  - 事件路径补盲：input/beforeinput/keydown 三路 capture 监听（真实键入走 beforeinput；合成 setVal 走 input；Shift+2 兜底 keydown）。
  - 可靠性：升级幂等（不打一次性标记，React 每键重建菜单后自动重注入去重；清理旧版 bug 残留裸分组）；wrapGroups 跳过我们注入的分组头。
  - 回归：hasMention 增补（installNativeMentionUpgrade/nativeMenuNow/nativeRecentAt/mentionOverlayRef/injectImportGroup/closeNativeMenu/[data-trigger-menu]/data-oet-grp-body）+ hasNativeCss=true（[data-trigger-menu] [data-oet-grp]/oetGrpChev）+ bundle hasNativeMention=true + 运行时 mention.ok=true（真实 Shift+2 键入 `@`）：原生菜单在、分组头 [对话1 / 导入智能体19] 默认 collapsed、hasImport=true、ourHidden=true（我们浮层不弹）；展开导入组 → 19 条模板可见；点 game-dev-team 行 → 输入框写入「请用 expert_team_deploy 导入专家团 game-dev-team（先 expert_team_manifest 预演）」、原生菜单关闭、我们浮层仍隐藏；全套既有标记 + 「+」/「/」菜单导入流程全绿、0 控制台错误。e2e 新工具：test/cdp-at-e2e.cjs（真实按键 @ 流程）、test/cdp-slot-probe.cjs（原生菜单槽 DOM 取证）、test/cdp-native-probe.cjs（触发器扫描）；e2e profile 补装 dsh-context/buka-assistant 对齐实机。
  - **（Round 23 修订，用户实测反馈「把原生的其他@的也做成折叠」「你做的@显示的内容不对，对照原生的改或删除」）**：
    - **删除了自绘 @ 浮层**（.oetMentionOv 全部实现 + CSS + 监听）：其「文件/对话」组用的是静态模板数据、与原生菜单的真实文件/最近会话对不上（内容不对），且与原生菜单并存造成混淆——宿主原生 @ 菜单即为唯一入口。
    - **折叠覆盖全部原生 @ 分组**：不再依赖 1.5s 时效窗（用户停顿再输入导致 React 重建后分组又展开），改为**按菜单类型判定**——行 id 前缀 `dsh-slash-option-command-` 即 `/` 指令菜单，**完全跳过（不折叠也不注入）**；其余（文件/对话/子智能体…）在每次重建时幂等重应用折叠+注入。
    - 注入分组行的点击不变：@提及 或 写部署指令（closeNativeMenu 关原生菜单）。
    - 回归更新：mention-bare 断言 hasNoOv=true（页面无 .oetMentionOv）而非 ourHidden；新增 slash-clean 断言（`/` 菜单 grpN=0、impN=0、heads 原样 添加/指令）；bundle hasNoOverlay / runtimeStyleTag hasNoOverlayCss（代码与 CSS 均不再含浮层串）；mention.ok 依旧全绿、0 控制台错误。
  - **（Round 23b 修订，用户「@展开之前不用加载这样加载更快 / @展开一行行排列不要列」）**：
    - **懒加载**：注入的「导入智能体」分组头先渲染（仅计数 19），19 行按钮等**首次展开才创建**（`data-oet-pending` 标记，建一次缓存；React 重建菜单后自动回到懒加载）→ 打开 @ 菜单不拖 19 个行节点。
    - **单列竖排**：新增 `[data-trigger-menu] [data-oet-grp-body]` 系列 CSS——展开后 flex-column、行宽 100%、一行一条、span 单行省略（导入组描述 span flex 吃剩余宽度）；原生折叠分组同样单列。
    - 回归更新：mention-bare 新增 impBodyKids=0（展开前 0 行）→ mention-expand kids=19（点击后建行）→ mention.ok 全绿、0 控制台错误。
  - **（Round 23c 修订，用户「卡片上的召唤和导入统一叫创建，以 @ 方式统一创建智能体团队」）**：
    - **卡片动作统一**：团队卡右上「召唤」→「创建」；成员卡底部「导入成员」→「创建」（标签统一为 `panel.create`，zh 创建 / en Create；`panel.summon` 与 `importCmd`/`draftInstruction` 已删）。
    - **@ 方式创建**：点「创建」= `mentionCmd(kind,name)` 把 `@模板名` 追加写入当前会话输入框草稿（有未发送草稿时空格追加、不覆盖），回车发送即以 @ 提及方式把该模板创建到**当前对话**的智能体团队（与 @ 菜单的提及语义一致）。
    - 回归：新增 local 断言 hasCreateBtn（`"panel.create"` + `mentionCmd("team", team.name)` + `mentionCmd("member", m.name)` + 无 `panel.summon`/`importCmd(`）；其余断言全绿；e2e 卡片 DOM 探针因 e2e 状态机到不了对话视图仅作日志取证（代码级接线已锁定；草稿写入与 `+` 菜单共用 setComposerDraft 通道已验证）。
  - **（Round 23d 修订，用户「统一成 @ 方式」）**：`+`/`/` 菜单「导入成员和专家团」popup 与 @ 菜单「导入智能体」分组，选模板后的落草稿从「请用 expert_team_deploy/expert_member_deploy …」显式指令改为 **`@模板名` 提及**——**卡片「创建」/ `+` 菜单 / @ 菜单三条创建入口全部走同一条 @提及 通道**（在哪个对话发，团队就创建进哪个对话）。`import.kind.*` 字典键与 `fill(import.kind)` 用法删除；menu.desc/hint 文案同步。回归：draft-poll 断言改 `in-field:@trading-team`、mention-after 断言 `@game-dev-team` + mentionOk 收紧为纯提及判定，全套 e2e 全绿、0 控制台错误。
  - **（Round 23f 修订，用户「@ 好慢 / 导入智能体显示不一样，做成对话那样的行」）**：
    - **慢**：MutationObserver 原为每次 DOM 变化（每键/每次菜单重建）同步执行全量 upgrade（querySelectorAll + 换行重组）。改为 **setTimeout(0) 节流合并**（每帧至多 upgrade 一次）+ 只观察 childList（去掉 attributes），@ 打开与输入不再被拖慢。
    - **行样式对齐原生**：注入行改为 **deep-clone 原生行**（`button[_3e4SsG_item]` + `_3e4SsG_itemIcon`(svg) + `_3e4SsG_itemName` + `_3e4SsG_itemDescription`），结构与「对话」等原生行逐字节一致（带图标）；去掉重复 id / aria-selected / `_active` 高亮类，tabIndex=-1，仍挂 mousedown(首选)/click/keydown 三路选择。无原生行模板时回退手工建行。
    - 验证：rowdump 探针（test/cdp-rowdump.cjs，真实 Shift+2 @ + 真鼠标按下/抬起点行）——菜单开、导入组展开、克隆行 outerHTML 与原生行同构、点 trading-team 行后草稿 `@trading-team` 且菜单关。附注：本轮 e2e 全量套件曾出现交互流程全挂，根因是探针用 Start-Job 起的 e2e server 随工具进程退出而死（页面「无法访问此网站」），改用 run_in_background 常驻后 rowdump 全绿；此为驱动环境问题，非产品回归。
  - **（Round 23f-2 修订，用户截图「咋是这样的」：分组头 1919 双计数 / 克隆行描述消失）**：
    - **`导入智能体1919` 双计数**：withChevron 与手工 cntSpan 各加一个「19」。去掉手工 cntSpan，计数只由 withChevron 输出一份 → `导入智能体19`。
    - **行描述被挤掉**：Round 23b 加的 `[data-oet-grp-body] button{display:flex}` 样式特异性高于原生 `_3e4SsG_item`（克隆行也命中），把原生 grid 布局压成单排 flex，描述被裁成 0 宽。改为只作用于**无原生类的回退行**（`:not([class*="_3e4SsG"])`），克隆行完全交给原生样式。
    - 验证（rowdump + 计算样式取证）：分组头 `▾ 导入智能体19`；克隆行 display=flex（原生自身）、描述 span 宽 447px 完整可见；真鼠标点行 → 草稿 `@trading-team`、菜单关。已部署实机（sha==workspace）。
  - **（Round 24 修订，用户「算了把 @ 的修改取消，用 / 指令就可以了」）**：
    - **@ 菜单整体回退为原生原样**：删除全部 @ 菜单修改——分组折叠/包裹（wrapGroups、withChevron、data-oet-grp-*）、「导入智能体」注入组（injectImportGroup、懒加载行、原生行 deep-clone）、mousedown 行选择、MutationObserver 升级、panel.mention 字典、MENTION_SECTIONS/buildMentionSections/lastMentionAt 等（client.js 946 行 → 618 行，`[data-trigger-menu]` CSS 一并清除）。宿主原生 @ 触发器菜单零改动：分组原样展开、无注入行、无浮层。
    - **创建入口只剩两条 @ 方式通道**（均写 `@模板名`、回车发送即部署进当前对话）：`+`/`/` 指令菜单「导入成员和专家团」（installImportContribution，未动）+ 模板卡片「创建」（mentionCmd，未动）。
    - 验证：e2e ⑪ 重写为「原生 @ 菜单未被触碰」——真实按键 @ → 原生菜单在、`noOetGrp/noOetBody/hasNoOv` 全真、Esc 后输入框只有 `@`（mention ok:true）；bundle/local/style 标记翻转为负断言（hasNoMentionUpgrade、hasNoNativeMentionUpgrade、hasNoAtMenuCss 全真）；`/` 菜单选模板 → 草稿 `in-field:@trading-team` 依旧。test/cdp-rowdump.cjs 归档为 Round 23f 诊断（特性已移除，不再运行）。已部署实机（sha==workspace）。
  - **（Round 28 修订，用户推特 /kantu 截图「能不能学习这个插件的设置？」）**：学习 dsh-vision-command（/kantu）的宿主 commands 机制——给插件现有 server 端（lib/index.js，本就有 expert_template_list/team_manifest/member_deploy/team_deploy 四工具按 agent scope 安装）**补注册宿主 slash 指令 `/expert-import`**（kantu 同款：菜单蓝色指令行 + 灰字 `input.hint` + 回车直接执行 handler）。handler 解析 `<模板名> [--ctx fresh|fork] [--model 跟随|名称]`，校验模板（listMembers/listTeams）后返回单步原子部署指令。live profile node_modules/dsh-expert-team 为 Junction 指向工作区（改动即生效）；server 侧变更需重启 DSH web 进程（cordis 插件启动时注册 commands）。
  - **（Round 28c 修订，用户「/ 实现了，把导入成员和专家团这个去掉。然后卡片创建则点击之后自动输入好/以及相关配置」）**：① 移除 client commandUi 弹层贡献（「导入成员和专家团」行、参数行、menu.* 字典、installImportContribution 全删；apply 不再注册）。创建入口收敛为两条宿主原生通道：**宿主 slash 指令 `/expert-import`**（菜单里 expert-import + 灰字用法，回车直接执行 handler）与**模板卡片【创建】**。② 卡片「创建」（deployDraft）不再是"请求模型执行"文本，而是**自动写宿主指令草稿**：`/expert-import <模板名> --ctx fresh --model follow`（回车即走宿主指令执行，参数与配置一步到位，可在草稿里改 --ctx fork 等）。验证：e2e 菜单实测（cdp-hint menuText）——含 `expert-import + 灰字 desc（<模板名> [--ctx fresh|fork] [--model …]）` 且**无「导入成员和专家团」行**（hasImportRow=false）；server 日志 `[expert-team] registered slash /expert-import`；local marks 更新为 hasNoCommandUiContribution/hasNoMenuShell/hasCmdRoute(→'/expert-import '+name)/hasCreateBtn 全真；mention ok:true、0 console 错误。live Junction 生效（client 部分 Ctrl+F5；server 部分 23:13 重启已加载）。
  - **（Round 23e 修订，用户实测「@ 选不中导入智能体」）**：原生菜单常在 mousedown（捕获阶段）自行关闭/重绘并夺焦，注入行按钮的 click 因此不触发（此前「选不中」即此因）；修法：行选择改到 **mousedown 阶段立即执行插入**（click/keydown 兜底，`picked` 标志防重入防重复插入）；`ovComposer` 增加 `lastComposer` 缓存（upgrade 时记录触发菜单的编辑框，菜单被关/夺焦后仍可取到）。回归：mention-after 仍 `@game-dev-team`（无重复 `@@`），全套 e2e 全绿、0 控制台错误。
