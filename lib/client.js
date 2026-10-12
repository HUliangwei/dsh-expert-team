// dsh-expert-team 浏览器端（`./client` 导出；ModuleLoader 预打包格式，无构建链依赖）。
// 挂载（均对照 dsh 0.2.x 源码契约验证）：
//   ① 创建入口（Round 28c 收敛）：宿主 slash 指令 `/expert-import`（lib/index.js 注册，
//      kantu 同款菜单行+hint+回车即执行）；原 client commandUi 弹层「导入成员和专家团」
//      已按用户要求移除（Round 28c）。
//   ② conversation.session.header.actions 的「专家团模板」按钮已按用户要求移除
//      （Round 12：智能体团队边上那个按钮去掉，避免与 agent-team 并排重复入口）。
//   ③ conversation.view（list）—— 顶部 tab「专家团模板」：与「画廊」(image-gen, order 20)、
//      「buka助理」(buka-assistant, order 30) 同一槽位，buka 同款注册
//      （register({name, id, order, label})，点击在面板内打开完整管理页）。
//      tab 页（Round 13 起）：每个专家团/成员模板一张卡片；点卡片 → sidebarRight
//      openResource 在编辑器打开该模板的 team.json / member.json（dsh-resource 地址，
//      fileAddressFor 同 ui-skill 工具）；点【创建】（Round 28c）→ 自动写好宿主指令
//      `/expert-import <模板名> --ctx <fresh|fork> --model <跟随|名称>` 回车即创建
//      （宿主指令 handler 直接执行创建链路，不再写“请求模型执行”的文本）。
//      （早期侧栏托盘用的是 sidebarRightTabs 公开通道——图像工作台同款；用户实测后改为
//       顶部 conversation.view 主挂点，与 工作台/buka助理 并列同条。）
// 语言：一律防御式取 t：props.t 存在用之（由 locale:NS 注入）；否则回落到自带 zh 字典。
window.__ModuleLoader__.load({
	id: "dsh-expert-team",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");

		// ---- 文案 ----
		var NS = "expert.team";
		var zh = {
			"header.action": "Agent 管理",
			"panel.title": "Agent 管理",
			"panel.members": "成员模板",
			"panel.teams": "专家团",
			"panel.empty": "（列表以会话内 expert_template_list 为准）",
			"panel.hint": "团体页按团队折叠；个体页按功能分组。点卡片 → 编辑器打开模板文件；点【创建】→ 输入框自动写好 /expert-import <模板名> [--ctx fresh|fork] [--model]，回车即按宿主指令创建到当前对话。",
			"panel.deploy.hint": "或直接对 Lead 说：部署 trading-team / 加入 reviewer",
			"panel.path": "目录",
			"panel.edit.aria": "打开该模板的编辑",
			"import.member": "导入成员",
			"import.team": "导入专家团",
			"panel.lead": "主理人",
			"panel.role": "定位",
			"panel.skills": "技能",
			"panel.sop": "4 阶段协作",
			"panel.do": "团队帮你做",
			"panel.create": "创建",
			"panel.page.teams": "团体",
			"panel.page.individuals": "个体",
			"panel.page.current": "当前对话",
			"panel.graph.hint": "当前对话的智能体团队拓扑：中心 lead 直属所有成员（WorkBuddy 专家团即此星型结构）；跨成员消息经主理人中转。",
			"panel.graph.empty": "当前对话还没有智能体团队 —— 用 /expert-import <模板名> 或模板卡片【创建】生成后，这里会出现关系图。",
			"panel.graph.lead": "主理人",
			"panel.graph.edge": "直属调度",
			"panel.graph.scheme": "lead ↔ 每个成员（星型）",
			"panel.func.research": "投研",
			"panel.func.content": "内容创作",
			"panel.func.game": "游戏开发",
			"panel.expand": "展开/收起成员"
		};
		var en = {
			"header.action": "Agent Management",
			"panel.title": "Agent Management",
			"panel.members": "Member templates",
			"panel.teams": "Teams",
			"panel.empty": "(authoritative list: ask the model with expert_template_list)",
			"panel.hint": "Teams page: one card per team (collapsed). Individuals page: grouped by function. Click a card to open its files; click Create → /expert-import <name> [--ctx fresh|fork] [--model] auto-fills the draft; Enter creates via the host command.",
			"panel.deploy.hint": "Or just tell the Lead: deploy trading-team / join reviewer",
			"panel.path": "Dir",
			"panel.edit.aria": "Open this template's editor",
			"import.member": "Import member",
			"import.team": "Import team",
			"panel.lead": "Lead",
			"panel.role": "Role",
			"panel.skills": "Skills",
			"panel.sop": "4-stage flow",
			"panel.do": "What this team helps you do",
			"panel.create": "Create",
			"panel.page.teams": "Teams",
			"panel.page.individuals": "Individuals",
			"panel.page.current": "Current",
			"panel.graph.hint": "Team topology of the current conversation: the central lead directly supervises every member (WorkBuddy teams are this star shape); cross-member messages go through the lead.",
			"panel.graph.empty": "No Agent Team in the current conversation yet — run /expert-import <name> or a template card Create to spawn one; the graph appears here.",
			"panel.graph.lead": "Lead",
			"panel.graph.edge": "direct supervision",
			"panel.graph.scheme": "lead ↔ each member (star)",
			"panel.func.research": "Research",
			"panel.func.content": "Content Creation",
			"panel.func.game": "Game Development",
			"panel.expand": "Toggle members"
		};
		// 与 templates/ 配套的内置模板资料（真实清单/详情以模型侧 expert_template_list 为准；
		// 字段与 templates/members|teams/*.json 逐项对齐）
		var SHIPPED_MEMBERS = [
			{ name: "researcher", display: "研究员", profession: "Research Analyst / 研究员", description: "检索、筛选与整理信息，输出带来源的结构化摘要", skills: ["web-search"], func: "research" },
			{ name: "market-analyst", display: "技术分析师", profession: "技术分析师（行情/量化）", description: "从 K 线、均线、量价与指标角度分析行情，输出趋势判断与关键价位", skills: [], func: "research" },
			{ name: "reviewer", display: "评审", profession: "评审（代码/文档）", description: "对代码或文档做结构化审查，输出问题清单与改进建议", skills: [], func: "research" },
			// ── WorkBuddy 内容创作专家团成员（ai-content-creator-team 1.0.0，个人自用副本）──
			{ name: "creative-strategist", display: "策凌", profession: "创意策划师", description: "品牌定位、情绪板/视觉方向、广告创意方向、场景与镜头、Logo 概念", skills: ["ai-content-production"], func: "content" },
			{ name: "copywriter", display: "笔澜", profession: "文案创作专家", description: "公众号/知乎/博客长文、小红书/社媒短文案、视频脚本、营销文案", skills: ["ai-content-production"], func: "content" },
			{ name: "video-generator", display: "维欧", profession: "视频生成专家", description: "文生/图生视频，HY-Video-1.5/YT-Video-2.0/HumanActor/FX 选型与 Prompt 工程", skills: ["ai-content-production"], func: "content" },
			{ name: "image-creator", display: "珀西", profession: "图文创作专家", description: "AI 图片生成、7 种场景策略、批量生成与发布级精修", skills: ["ai-content-production"], func: "content" },
			{ name: "video-editor", display: "柯立", profession: "视频编辑专家", description: "Track 结构编辑：裁剪/转场/字幕/滤镜/去水印", skills: ["ai-content-production"], func: "content" },
			{ name: "content-adapter", display: "艾达", profession: "素材改编专家", description: "视频分析、精彩片段提取、视频翻译（声纹克隆+唇型同步）、多媒体合成", skills: ["ai-content-production"], func: "content" },
			// ── WorkBuddy game-design / godot-roblox 已使用专家（个人自用副本；ui-designer 为内建推荐精简人设）──
			{ name: "narrative-designer", display: "叙事设计师", profession: "Narrative Designer / 叙事设计师", description: "剧情系统与分支对话：GDD 对齐叙事、分支对话、lore 架构与环境叙事", skills: [], func: "game" },
			{ name: "game-designer", display: "游戏设计师", profession: "Game Designer / 游戏设计师", description: "系统与机制架构：GDD 撰写、玩家心理、经济平衡、玩法循环设计", skills: [], func: "game" },
			{ name: "game-audio-engineer", display: "音频工程师", profession: "Game Audio Engineer / 音频工程师", description: "FMOD/Wwise 集成、自适应音乐、空间音频与音频性能预算", skills: [], func: "game" },
			{ name: "level-designer", display: "关卡设计师", profession: "Level Designer / 关卡设计师", description: "空间叙事与流线：布局理论、节奏架构、遭遇设计、环境叙事", skills: [], func: "game" },
			{ name: "godot-game-script-engineer", display: "Godot 脚本工程师", profession: "Godot Gameplay Scripter", description: "Godot 4 游玩系统：GDScript 2.0 / C# 集成、节点架构、类型安全信号", skills: [], func: "game" },
			{ name: "godot-shader-developer", display: "Shader 开发者", profession: "Godot Shader Developer", description: "Godot 4 视觉特效：Shading Language / VisualShader、后处理与 2D/3D 性能优化", skills: [], func: "game" },
			{ name: "ui-designer", display: "UI 设计师", profession: "UI Designer / UI 设计师", description: "设计系统与组件库：像素级完美、无障碍界面、交互规范", skills: [], func: "game" }
		];
		// 个体页功能分组顺序（func 字段 → 组标题字典键）
		var MEMBER_FUNC_ORDER = ["research", "content", "game"];
		var SHIPPED_TEAMS = [
			{
				name: "trading-team",
				display: "交易分析团队",
				description: "A股/港股/美股投资分析：信息收集 → 技术面分析 → 复核风控 → 最终建议",
				lead: "主理人（投资分析编排）",
				members: [
					{ name: "researcher", display: "研究员" },
					{ name: "analyst", display: "技术分析师" },
					{ name: "reviewer", display: "评审" }
				],
				sop: "① researcher 收集信息（含来源）→ ② market-analyst 技术面判断 → ③ reviewer 复核（P0-P2）→ ④ 主理人整合 BUY/SELL/HOLD 建议",
				prompts: [
					"帮我梳理近期市场新闻与政策，输出带来源的结构化摘要",
					"分析某标的的技术面，给出趋势判断与关键价位",
					"评审这份投资分析报告，列出问题清单与改进建议"
				]
			},
			{
				name: "ai-content-creator-team",
				display: "内容创作专家团",
				description: "AI 驱动的多模态内容生产：创意策划 → 文案 → 视频/图文 → 精修/编辑/改编，端到端交付",
				lead: "司远（创意总监）",
				members: [
					{ name: "creative-strategist", display: "策凌" },
					{ name: "copywriter", display: "笔澜" },
					{ name: "video-generator", display: "维欧" },
					{ name: "image-creator", display: "珀西" },
					{ name: "video-editor", display: "柯立" },
					{ name: "content-adapter", display: "艾达" }
				],
				sop: "① 策凌 创意策划先行（定位/情绪板/广告方向）→ ② 笔澜 文案 → ③ 珀西 图文 & 维欧 视频生成 并行 → ④ 珀西/柯立 精修与编辑 → ⑤ 艾达 改编/翻译/合成 → ⑥ 主理人整合交付",
				prompts: [
					"帮我确定新产品的品牌视觉方向，做一个情绪板",
					"帮我用 AI 生成一段 15 秒的产品宣传短视频",
					"为我的新品上市生成一组小红书风格的种草图文，包含配图和文案"
				]
			},
			{
				name: "game-dev-team",
				display: "游戏制作团队",
				description: "《仙凡三国》同款游戏开发流水线：叙事/数值/音频/关卡/Godot 脚本/Shader/UI 七位专家并行协作",
				lead: "制作人（游戏开发主编排）",
				members: [
					{ name: "narrative-designer", display: "叙事设计师" },
					{ name: "game-designer", display: "游戏设计师" },
					{ name: "game-audio-engineer", display: "音频工程师" },
					{ name: "level-designer", display: "关卡设计师" },
					{ name: "godot-engineer", display: "Godot 脚本工程师" },
					{ name: "shader-developer", display: "Shader 开发者" },
					{ name: "ui-designer", display: "UI 设计师" }
				],
				sop: "① 需求定形（引擎/风格/交付物）→ ② 叙事/数值/音频/关卡/脚本/Shader/UI 按职能并行 → ③ 采信专家产出 → ④ 制作人整合落盘 + 验收清单",
				prompts: [
					"梳理现有系统的数值并产出数值策划案（商品/职业/薪资，3 分册）",
					"为游戏设计一段分支剧情与对话树，写入剧情文档",
					"梳理音频系统缺口并产出音频设计方案与合成音效包"
				]
			}
		];

		// 团体页徽标：已知团队用 emoji，未知用名称首字
		var TEAM_BADGE = { "trading-team": "📈", "ai-content-creator-team": "🎨", "game-dev-team": "🎮" };

		// ---- 防御式翻译：props.t（locale 注入）优先，否则命中自带 zh ----
		function fill(template, vars) {
			return String(template).replace(/\{([a-z]+)\}/g, function (_, k) {
				return vars && vars[k] != null ? String(vars[k]) : "{" + k + "}";
			});
		}
		function makeT(props) {
			var t = props && typeof props.t === "function" ? props.t : null;
			return function tr(key, vars) {
				if (t) return t(key, vars);
				return fill(zh[key] != null ? zh[key] : key, vars);
			};
		}
		// 模块级 zh 读取器（非组件作用域，@ 浮层分组名等用）
		function tl(key) { return zh[key] != null ? zh[key] : key; }

		// ---- 小组件（React.createElement，无 JSX / 无 CSS module）----
		function h(type, props) {
			var children = [];
			for (var i = 2; i < arguments.length; i++) children.push(arguments[i]);
			return react.createElement.apply(react, [type, props || null].concat(children));
		}

		// ---- 卡片交互：buka 助理同款视觉（src/client/styles.ts 的 .bk-grid/.bk-card 体系）。
		// 响应式网格 + 10px 圆角 + 3px 彩色左缘 + hover 仅底色加深 + kind 小标签 + 底部动作按钮。
		// 内联 style 无伪类，动态 style 标签注入（buka 同款 data-plugin，powered by dsh-client-ui-skill）。
		var TAB_STYLE_TAG = "dsh-expert-team-tab";
		function injectTabStyles() {
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(TAB_STYLE_TAG) + "]")) return;
			var sheet = [
				".oetGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }",
				".oetSection { font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-secondary, #b8bcc4); border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.12)); padding-bottom: 4px; margin: 14px 0 8px; }",
				".oetCard { position: relative; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.2)); border-left-width: 3px; border-radius: 10px; padding: 10px 12px; cursor: pointer; user-select: none; background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)); transition: border-color .12s ease, background .12s ease; }",
				".oetCard:hover { background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.1)); }",
				".oetCard:focus-visible { outline: 1.5px solid var(--dsw-alias-brand-primary, #4a86e8); outline-offset: -1px; }",
				".oetCard.is-team { border-left-color: var(--dsw-alias-brand-primary, #4a86e8); }",
				".oetCard.is-member { border-left-color: #a855f7; }",
				".oetCardName { font-size: 13px; font-weight: 600; padding-right: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
				".oetKind { display: inline-block; font-size: 10.5px; padding: 1px 7px; border-radius: 999px; margin-left: 6px; vertical-align: 1px; color: var(--dsw-alias-label-secondary, #b8bcc4); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25)); }",
				".oetKind.team { color: #4a86e8; border-color: rgba(74,134,232,.5); }",
				".oetKind.member { color: #a855f7; border-color: rgba(168,85,247,.5); }",
				".oetPath { font-size: 11px; color: var(--dsw-alias-label-tertiary, #9aa0a6); margin-top: 3px; word-break: break-all; font-family: ui-monospace, Consolas, monospace; }",
				".oetDesc { font-size: 12px; color: var(--dsw-alias-label-secondary, #b8bcc4); margin-top: 6px; line-height: 1.55; }",
				".oetMeta { font-size: 12px; color: var(--dsw-alias-label-primary, #e8eaed); margin-top: 6px; line-height: 1.55; }",
				".oetMeta .oetMuted { color: var(--dsw-alias-label-secondary, #b8bcc4); }",
				".oetActions { display: flex; gap: 6px; margin-top: 9px; }",
				".oetBtn { appearance: none; border: 1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.3)); background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)); color: var(--dsw-alias-label-secondary, #b8bcc4); border-radius: 7px; padding: 2.5px 9px; font-size: 11.5px; cursor: pointer; font-family: inherit; }",
				".oetBtn:hover { border-color: var(--dsw-alias-brand-primary, #4a86e8); color: var(--dsw-alias-brand-primary, #4a86e8); }",
				".oetBtn:focus-visible { outline: 1.5px solid var(--dsw-alias-brand-primary, #4a86e8); outline-offset: 1px; }",
				".oetBtn:active { background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.1)); }",
				// ── workbuddy 风格：版本胶囊 / 团队帮你做胶囊 / 折叠团队卡 ──
				".oetVersion { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; color: var(--dsw-alias-label-tertiary, #9aa0a6); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25)); }",
				// ── Agent 管理双页：团体页折叠卡 / 个体页分组 ──
				".oetPageSwitch { display: inline-flex; gap: 4px; padding: 3px; border-radius: 9px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.1)); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.2)); margin: 8px 0 10px; }",
				".oetPageBtn { appearance: none; border: 0; border-radius: 7px; padding: 3px 14px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary, #b8bcc4); background: transparent; cursor: pointer; font-family: inherit; }",
				".oetPageBtn:hover { color: var(--dsw-alias-label-primary, #e8eaed); }",
				".oetPageBtn:focus-visible { outline: 1.5px solid var(--dsw-alias-brand-primary, #4a86e8); outline-offset: 1px; }",
				".oetPageBtn.on { background: var(--dsw-alias-bg-layer-1, rgba(255,255,255,.07)); color: var(--dsw-alias-label-primary, #e8eaed); box-shadow: 0 0 0 1px var(--dsw-alias-border-l2, rgba(128,128,128,.25)); }",
				".oetTcard { border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.2)); border-left: 3px solid var(--dsw-alias-brand-primary, #4a86e8); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06)); padding: 10px 12px; margin-bottom: 10px; }",
				".oetTcardHead { display: flex; align-items: center; gap: 8px; cursor: pointer; border-radius: 6px; padding: 2px 0; }",
				".oetTcardHead:hover { background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.1)); }",
				".oetTcardHead:focus-visible { outline: 1.5px solid var(--dsw-alias-brand-primary, #4a86e8); outline-offset: -1px; }",
				".oetChevron { flex: none; font-size: 10px; color: var(--dsw-alias-label-tertiary, #9aa0a6); width: 12px; text-align: center; }",
				".oetExpBody { margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.15)); display: flex; flex-direction: column; gap: 10px; }",
				".oetPromptRow { display: flex; flex-direction: column; gap: 6px; }",
				".oetPromptRow { display: flex; flex-direction: column; gap: 6px; }",
				".oetPromptLabel { font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-tertiary, #9aa0a6); }",
				".oetPromptWrap { display: flex; flex-wrap: wrap; gap: 6px; }",
				".oetPrompt { appearance: none; text-align: left; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25)); background: transparent; border-radius: 10px; padding: 4px 11px; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #b8bcc4); cursor: pointer; font-family: inherit; line-height: 1.5; }",
				".oetPrompt:hover { border-color: var(--dsw-alias-brand-primary, #4a86e8); color: var(--dsw-alias-label-primary, #e8eaed); background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.1)); }",
				".oetPrompt:focus-visible { outline: 1.5px solid var(--dsw-alias-brand-primary, #4a86e8); outline-offset: 1px; }",
				".oetPrompt:active { background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.14)); }",
				// ── Round 20：团队卡「卡」化 —— 徽标 + 折叠态成员预览 chips ──
				".oetTbadge { flex: none; width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.16)); }",
				".oetChips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }",
				".oetChip { font-size: 10.5px; line-height: 1; color: var(--dsw-alias-label-tertiary, #9aa0a6); background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.09)); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); border-radius: 999px; padding: 3px 8px; }",
				// ── Round 29：当前对话 tab —— 星型拓扑图（SVG 连线 + 卡片节点）──
				".oetGraph { position: relative; margin-top: 10px; }",
				".oetGraph svg { display: block; width: 100%; max-width: 720px; margin: 0 auto; background: transparent; }",
				".oetGEdge { stroke: var(--dsw-alias-border-l3, rgba(128,128,128,.4)); stroke-width: 1.4; fill: none; marker-end: url(#oetArrow); opacity: .8; }",
				".oetGEdgeLabel { font-size: 10px; fill: var(--dsw-alias-label-tertiary, #9aa0a6); }",
				".oetGNode { cursor: default; }",
				".oetGNode rect { fill: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.07)); stroke: var(--dsw-alias-border-l3, rgba(128,128,128,.45)); rx: 10; }",
				".oetGNode.is-lead rect { stroke: var(--dsw-alias-brand-primary, #4a86e8); stroke-width: 1.6; fill: rgba(74,134,232,.08); }",
				".oetGName { font-size: 12.5px; font-weight: 600; fill: var(--dsw-alias-label-primary, #e8eaed); }",
				".oetGRole { font-size: 10px; fill: var(--dsw-alias-label-secondary, #b8bcc4); }",
				".oetGDot.running { fill: #22c55e; }",
				".oetGDot.inactive { fill: #9aa0a6; }",
				".oetGDot.provisioning { fill: #38bdf8; }",
				".oetGDot.failed { fill: #ef4444; }",
				".oetGLeg { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11px; color: var(--dsw-alias-label-secondary, #b8bcc4); margin-top: 4px; }",
				".oetGLeg span { display: inline-flex; align-items: center; gap: 4px; }",
				".oetGLeg i { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }",
				// ── Round 30：Obsidian 式画布 —— 可拖拽节点 + 实时连线 + 运行光环 + 消息脉动 ──
				".oetCanvas { position: relative; margin-top: 10px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.16)); border-radius: 12px; overflow: hidden; background: radial-gradient(circle at 50% 30%, rgba(128,128,128,.05), transparent 70%); }",
				".oetCanvas .oetCvNode { position: absolute; width: 168px; padding: 8px 10px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l3, rgba(128,128,128,.4)); border-left: 3px solid #a855f7; border-radius: 10px; background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.08)); cursor: grab; user-select: none; transition: box-shadow .12s ease, border-color .12s ease; z-index: 2; }",
				".oetCanvas .oetCvNode:hover { border-color: var(--dsw-alias-brand-primary, #4a86e8); }",
				".oetCanvas .oetCvNode.is-dragging { cursor: grabbing; box-shadow: 0 6px 22px rgba(0,0,0,.28); z-index: 4; }",
				".oetCanvas .oetCvNode.is-lead { border-left-color: var(--dsw-alias-brand-primary, #4a86e8); border-color: rgba(74,134,232,.55); background: rgba(74,134,232,.09); }",
				".oetCanvas .oetCvNode .oetCvName { font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-primary, #e8eaed); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
				".oetCanvas .oetCvNode .oetCvRole { font-size: 10px; color: var(--dsw-alias-label-tertiary, #9aa0a6); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
				".oetCanvas .oetCvNode .oetCvBadge { position: absolute; top: 6px; right: 8px; font-size: 9.5px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3)); color: var(--dsw-alias-label-tertiary, #9aa0a6); }",
				".oetCanvas .oetCvNode.is-busy .oetCvBadge { color: #22c55e; border-color: rgba(34,197,94,.55); background: rgba(34,197,94,.1); }",
				".oetCanvas .oetCvNode.is-busy:after { content: \"\"; position: absolute; left: 50%; top: 50%; width: 110%; height: 110%; transform: translate(-50%,-50%); border: 2px solid rgba(34,197,94,.6); border-radius: 14px; animation: oetRing 1.3s ease-out infinite; pointer-events: none; }",
				"@keyframes oetRing { 0% { opacity: .9; transform: translate(-50%,-50%) scale(.92); } 70% { opacity: 0; transform: translate(-50%,-50%) scale(1.12); } 100% { opacity: 0; } }",
				".oetCanvas svg.oetLinks { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; }",
				".oetCanvas line.oetLink { stroke: var(--dsw-alias-border-l3, rgba(128,128,128,.45)); stroke-width: 1.6; }",
				".oetCanvas line.oetLink.is-pulse { stroke: var(--dsw-alias-brand-primary, #4a86e8); stroke-width: 2.4; stroke-dasharray: 6 10; animation: oetPulse .9s linear 1; filter: drop-shadow(0 0 4px rgba(74,134,232,.9)); }",
				"@keyframes oetPulse { 0% { stroke-dashoffset: 0 } 100% { stroke-dashoffset: -64 } }",
				".oetCanvas text.oetLinkLabel { font-size: 10px; fill: var(--dsw-alias-label-tertiary, #9aa0a6); }",
				".oetCanvasTitle { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-tertiary, #9aa0a6); margin-top: 8px; }",
				".oetCanvasTitle b { color: var(--dsw-alias-label-secondary, #b8bcc4); font-weight: 600; }"
			].join("\n");
			var el = document.createElement("style");
			el.dataset.plugin = "dsh-expert-team";
			el.dataset.pluginCss = TAB_STYLE_TAG;
			el.textContent = sheet;
			document.head.appendChild(el);
		}

		// 键盘可达：卡片带 tabIndex + Enter/Space 等同点击（聚焦高亮见上面的 CSS）。
		function pressEnter(fn) {
			return function (e) {
				if (!e) return;
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					fn();
				}
			};
		}

		// 把 @提及 写进指定会话的输入框草稿（conversation.input 面 → setDraft）。
		// 失败返回 false（调用方自行兜底）。
		function setComposerDraft(ctx, sessionId, text) {			try {
				var sessions = ctx.sessions;
				var binding = sessions && typeof sessions.binding === "function" ? sessions.binding(sessionId) : void 0;
				var conv = ctx.conversation;
				if (binding && binding.ctx && conv && conv.input && typeof conv.input.for === "function") {
					conv.input.for(binding.ctx).setDraft(text);
					return true;
				}
			} catch (e) { /* 会话绑定未就绪等场景：返回 false */ }
			return false;
		}

		// 「专家团模板」完整管理页（conversation.view 顶部 tab 的内容）：
		// 团队卡片（显示名/描述/主理人/成员 chips/协作流程）+ 成员卡片（定位/描述/技能）。
		// ---- 模板目录编辑：dsh-resource 文件地址（抄 ui-skill 的 workspace-path 工具）----
		var FILE_ADDRESS_PREFIX = "dsh-resource://file/";
		function encodeSegment(segment) {
			return encodeURIComponent(segment).replace(/%3A/gi, ":");
		}
		function encodePath(path) {
			return path.split("/").map(encodeSegment).join("/");
		}
		function sessionFileAddress(sessionId, path) {
			var normalized = String(path || "").replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
			return FILE_ADDRESS_PREFIX + "session/" + encodeSegment(sessionId) + "/" + encodePath(normalized);
		}
		function isWindowsStylePath(value) {
			return /^[A-Za-z]:[/\\]/.test(value) || value.indexOf("\\\\") === 0;
		}
		function isAbsoluteWorkspacePath(path) {
			return path.indexOf("/") === 0 || isWindowsStylePath(path);
		}
		function fileAddressFor(sessionId, cwd, path) {
			var normalized = String(path || "").replace(/\\/g, "/");
			if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized);
			var root = cwd === void 0 ? "" : String(cwd).replace(/\\/g, "/").replace(/\/+$/, "");
			if (root !== "" && normalized === root) return sessionFileAddress(sessionId, "");
			if (root !== "" && normalized.indexOf(root + "/") === 0) return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
			return sessionFileAddress(sessionId, normalized);
		}

		// 插件在会话工作区里的相对目录（真实 GUI 工作区路径取决于部署环境：
		// project/dsh-expert-team/templates/...）。tab 打开编辑器用它拼接 workspace 相对路径。
		var PLUGIN_WORKSPACE_PREFIX = "project/dsh-expert-team";
		var pluginCtx = null;

		// 当前会话 id：优先槽 inject 给的 tabSessionId；兜底取 mainView 保留的会话（与
		// dsh-client-ui-session 选中逻辑同源），再兜底取列表第一个。
		function activeSessionId(ctx) {
			try {
				var list = ctx && ctx.sessions && ctx.sessions.list ? ctx.sessions.list.getSnapshot() : void 0;
				var byId = list && list.byId || {};
				var ids = Object.keys(byId);
				for (var i = 0; i < ids.length; i++) {
					var row = byId[ids[i]];
					if (row && row.retainedBy && row.retainedBy.mainView > 0) return ids[i];
				}
				return ids.length > 0 ? ids[0] : null;
			} catch (e) { return null; }
		}

		// 在右侧编辑器里打开模板目录的主文件（team.json / member.json）。
		function openTemplateEdit(ctx, sessionId, repoRelDir, file) {
			if (!sessionId || !ctx || !ctx.sidebarRight || typeof ctx.sidebarRight.openResource !== "function") return false;
			try {
				var byId = ctx.sessions.list.getSnapshot().byId || {};
				var row = byId[sessionId] || {};
				var cwd = row.cwd;
				var address = fileAddressFor(sessionId, cwd, PLUGIN_WORKSPACE_PREFIX + "/" + repoRelDir + "/" + file);
				ctx.sidebarRight.openResource(address);
				return true;
			} catch (e) {
				console.warn("[dsh-expert-team] openTemplateEdit failed:", e);
				return false;
			}
		}

		// 模板所在目录（相对插件仓库），卡片上直接展示。
		function templateDir(kind, name) {
			return "templates/" + (kind === "team" ? "teams" : "members") + "/" + name + "/";
		}

		// 按成员名（或显示名）找 SHIPPED_MEMBERS 里的职业与完整条目
		function memberProfession(key) {
			for (var i = 0; i < SHIPPED_MEMBERS.length; i++) {
				var m = SHIPPED_MEMBERS[i];
				if (m.name === key || m.display === key) return m.profession;
			}
			return "";
		}
		function memberByName(key) {
			for (var i = 0; i < SHIPPED_MEMBERS.length; i++) {
				if (SHIPPED_MEMBERS[i].name === key || SHIPPED_MEMBERS[i].display === key) return SHIPPED_MEMBERS[i];
			}
			return null;
		}

		function TemplatesTabBody(props) {
			var t = makeT(props);
			var st = react.useState("");
			var notice = st[0], setNotice = st[1];
			var stPage = react.useState("teams");
			var page = stPage[0], setPage = stPage[1];
			var stOpen = react.useState({});
			var openTeams = stOpen[0], setOpenTeams = stOpen[1];
			// Round 29：当前对话 tab —— 订阅 sessions.list store（投影/状态变化自动重绘）。
			// 实现用 useState+useEffect 订阅（不依赖 useSyncExternalStore 的 getSnapshot 引用
			// 稳定性契约；订阅回调签名与官方 ui-session 的 sessions.list.subscribe(fn) 一致）。
			var listStore = pluginCtx && pluginCtx.sessions ? pluginCtx.sessions.list : null;
			var stSnap = react.useState(null);
			var snap = stSnap[0], setSnap = stSnap[1];
			react.useEffect(function () {
				if (!listStore) return;
				setSnap(teamSnapshot(listStore));
				var un = listStore.subscribe(function () { setSnap(teamSnapshot(listStore)); });
				return typeof un === "function" ? un : function () { };
			}, []);
			function sid() { return props.tabSessionId || activeSessionId(pluginCtx); }
			// Round 28c：卡片「创建」= 自动写好宿主指令 `/expert-import <模板名> [--ctx fresh] [--model 跟随]`，
			// 回车即触发宿主 slash 指令（handler 直接执行创建链路），无需再手工拼写。
			var CARD_CTX = "fresh", CARD_MODEL = "follow"; // 卡片默认参数（fresh=全新上下文；follow=模型跟随会话）
			function deployDraft(kind, name) {
				var text = "/expert-import " + name + " --ctx " + CARD_CTX + " --model " + CARD_MODEL;
				try {
					var ed = document.querySelector('[data-slot="conversation.draft"]');
					var raw = ed ? (ed.value != null ? ed.value : (ed.innerText || ed.textContent || "")) : "";
					if (raw && raw.trim()) text = raw.trim().replace(/\s+$/, "") + " " + text;
				} catch (e) { }
				if (setComposerDraft(pluginCtx, sid(), text)) {
					setNotice("已写入草稿，回车即创建：" + text);
				} else {
					setNotice("草稿不可写 → 请直接发给 Lead：" + text);
				}
			}
			function mentionCmd(kind, name) { deployDraft(kind, name); }
			function promptCmd(text) {
				if (setComposerDraft(pluginCtx, sid(), text)) {
					setNotice(text);
				} else {
					setNotice("草稿不可写 → 请直接发给 Lead：" + text);
				}
			}
			function openEdit(kind, name) {
				var dir = templateDir(kind, name);
				if (!openTemplateEdit(pluginCtx, sid(), dir, kind === "team" ? "team.json" : "member.json")) {
					setNotice("编辑器不可用 → 模板目录：" + dir);
				}
			}
			function toggleTeam(name) {
				setOpenTeams(function (o) {
					var n = {};
					for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) n[k] = o[k]; }
					n[name] = !o[name];
					return n;
				});
			}
			var pathText = function (kind, name) {
				var dir = templateDir(kind, name);
				return h("div", { className: "oetPath" }, t("panel.path"), "：", dir, kind === "team" ? "team.json" : "member.json");
			};
			var pageSwitch = h("div", { className: "oetPageSwitch" },
				["teams", "individuals", "current"].map(function (p) {
					return h("button", {
						type: "button", key: p,
						className: "oetPageBtn" + (page === p ? " on" : ""),
						"aria-pressed": page === p ? "true" : "false",
						onClick: function () { setPage(p); }
					}, t(p === "teams" ? "panel.page.teams" : p === "individuals" ? "panel.page.individuals" : "panel.page.current"));
				})
			);
			// 个体卡片（团体展开区与个体页复用）
			var memberCard = function (m) {
				return h("div", {
					key: m.name, className: "oetCard is-member",
					role: "button", tabIndex: 0,
					"aria-label": t("panel.edit.aria") + "：" + templateDir("member", m.name) + "member.json",
					onClick: function () { openEdit("member", m.name); },
					onKeyDown: pressEnter(function () { openEdit("member", m.name); })
				},
					h("div", { style: { display: "flex", alignItems: "center", minWidth: 0 } },
						h("span", { className: "oetCardName" },
							m.name,
							h("span", { style: { color: "var(--dsw-alias-label-secondary, #b8bcc4)", fontWeight: 400 } }, " ", m.display)
						),
						h("span", { className: "oetKind member" }, t("panel.members"))
					),
					pathText("member", m.name),
					h("div", { className: "oetMeta" }, h("span", { className: "oetMuted" }, t("panel.role")), "：", m.profession),
					h("div", { className: "oetDesc" }, m.description),
					m.skills && m.skills.length > 0
						? h("div", { className: "oetMeta" }, h("span", { className: "oetMuted" }, t("panel.skills")), "：", m.skills.join(" · "))
						: null,
					h("div", { className: "oetActions" },
						h("button", {
							type: "button", className: "oetBtn",
							onClick: function (e) { if (e && e.stopPropagation) e.stopPropagation(); mentionCmd("member", m.name); }
						}, t("panel.create"))
					)
				);
			};
			// 团体页：一个专家团一张可折叠卡片（默认折叠，展开含成员个体卡）
			var teamCard = function (team) {
				var isOpen = !!openTeams[team.name];
				var inner = [];
				if (isOpen) {
					var innerKids = [];
					if (team.prompts && team.prompts.length > 0) {
						innerKids.push(h("div", { className: "oetPromptRow" },
							h("span", { className: "oetPromptLabel" }, t("panel.do")),
							h("div", { className: "oetPromptWrap" },
								team.prompts.map(function (p) {
									return h("button", { type: "button", key: p, className: "oetPrompt", onClick: function () { promptCmd(p); } }, "“", p, "”");
								})
							)
						));
					}
					innerKids.push(h("div", { key: "members", className: "oetGrid" },
						team.members.map(function (m) {
							var mi = memberByName(m.name) || { name: m.name, display: m.display, profession: "", description: "", skills: [], func: "" };
							return memberCard(mi);
						})
					));
					inner.push(h("div", { key: "exp", className: "oetExpBody" }, innerKids));
				}
				return h("div", { key: team.name, className: "oetTcard" },
					h("div", {
						className: "oetTcardHead", role: "button", tabIndex: 0,
						"aria-expanded": isOpen ? "true" : "false",
						"aria-label": t("panel.expand") + "：" + (team.name || ""),
						onClick: function () { toggleTeam(team.name); },
						onKeyDown: pressEnter(function () { toggleTeam(team.name); })
					},
						h("span", { className: "oetChevron" }, isOpen ? "▾" : "▸"),
						h("span", { className: "oetTbadge" }, TEAM_BADGE[team.name] || (team.display || "团").slice(0, 1)),
						h("span", { className: "oetCardName" },
							team.name || t("panel.teams"),
							h("span", { style: { color: "var(--dsw-alias-label-secondary, #b8bcc4)", fontWeight: 400 } }, " ", team.display)
						),
						h("span", { className: "oetKind team" }, t("panel.teams")),
						h("span", { style: { marginLeft: "auto" } }),
						h("button", {
							type: "button", className: "oetBtn",
							onClick: function (e) { if (e && e.stopPropagation) e.stopPropagation(); mentionCmd("team", team.name); }
						}, t("panel.create")),
						h("button", {
							type: "button", className: "oetBtn",
							onClick: function (e) { if (e && e.stopPropagation) e.stopPropagation(); openEdit("team", team.name); }
						}, t("panel.edit.aria"))
					),
					pathText("team", team.name),
					h("div", { className: "oetDesc" }, team.description),
					h("div", { className: "oetMeta" }, h("span", { className: "oetMuted" }, t("panel.lead")), "：", team.lead || "—"),
					!isOpen && team.members && team.members.length > 0
						? h("div", { className: "oetChips" }, team.members.map(function (m) {
							return h("span", { key: m.name, className: "oetChip" }, m.display || m.name);
						}))
						: null,
					inner
				);
			};
			// 个体页：按功能分组排布个体卡片
			var funcSections = MEMBER_FUNC_ORDER.map(function (func) {
				var arr = [];
				for (var i = 0; i < SHIPPED_MEMBERS.length; i++) {
					if ((SHIPPED_MEMBERS[i].func || "") === func) arr.push(SHIPPED_MEMBERS[i]);
				}
				if (arr.length === 0) return null;
				return h("div", { key: func },
					h("div", { className: "oetSection" }, t("panel.func." + func)),
					h("div", { className: "oetGrid" }, arr.map(memberCard))
				);
			});
			return h("div", { style: { padding: "14px 18px 18px", fontSize: 13, lineHeight: 1.65 } },
				h("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
					h("span", { style: { fontSize: 15, fontWeight: 600 } }, t("panel.title")),
					h("span", { className: "oetVersion" }, "V1.0.0"),
					h("span", { style: { fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, #9aa0a6)" } }, t("panel.hint"))
				),
				notice ? h("div", { style: { marginTop: 6, fontSize: 12, color: "var(--dsw-alias-state-success-primary, #188038)" } }, notice) : null,
				pageSwitch,
				page === "teams" ? SHIPPED_TEAMS.map(teamCard) : page === "individuals" ? funcSections : h(CurrentTeamCanvas, { t: t, ctx: pluginCtx, sid: sid(), snap: snap }),
				h("div", { style: { marginTop: 12, fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, #9aa0a6)" } },
					t("panel.empty"), " / ", t("panel.deploy.hint"), " / 快速创建：/expert-import <模板名> [--ctx fresh|fork]"
				)
			);
		}

		// ── Round 29：当前对话 tab 的星型拓扑图 ──
		// 数据源与官方 agent-team client 同源：sessions.list store 的
		// projectionsBySession[leadId].values.agentTeam（{members:[{id,name,status,...}], tasks}）。
		// leadId：当前会话若是子智能体则取其 parentSessionId（= 它所属团队的 lead），否则自己即 lead。
		var STATUS_DOT = { running: "running", inactive: "inactive", provisioning: "provisioning", failed: "failed" };
		function teamSnapshot(listStore) {
			try { return listStore.getSnapshot() || {}; } catch (e) { return {}; }
		}
		function memberStatusOf(s) {
			var v = String(s || "");
			return STATUS_DOT[v] ? v : "inactive";
		}
		function currentTeamGraph(props, ctx, sid, snap) {
			var t = makeT(props);
			// 全面兜底：任何异常不外泄为白屏，输出诊断（console）+ 可见原因。
			try {
				if (!snap) snap = {};
				var byId = snap.byId || {};
				var row = byId[sid] || {};
				var leadId =
					(row.subagent && row.subagent.address && row.subagent.address.parentSessionId) ||
					(row.header && row.header.parentSession) ||
					sid ||
					null;
				var proj = (snap.projectionsBySession || {})[leadId];
				var team = proj && proj.values ? proj.values.agentTeam : null;
				var members = (team && Array.isArray(team.members) ? team.members : []).filter(function (m) { return m && m.id; });
				var n = members.length;

				if (!leadId || (!snap.projectionsBySession && !team)) {
					console.log("[dsh-expert-team] currentTeamGraph: no team data yet", { sid: sid, leadId: leadId, snapKeys: Object.keys(snap), projKeys: Object.keys(snap.projectionsBySession || {}) });
				}
				if (n === 0) {
					return h("div", { className: "oetGraph" },
						h("div", { style: { padding: "22px 16px", fontSize: 12.5, color: "var(--dsw-alias-label-secondary, #b8bcc4)", textAlign: "center", border: "1px dashed var(--dsw-alias-border-l3, rgba(128,128,128,.35))", borderRadius: 10 } },
							t("panel.graph.empty")
						)
					);
				}

			// 布局：中心 lead + 成员均匀分布在环上（星型）。
			var W = 720, H = 400, CX = W / 2, CY = H / 2, R = Math.min(150, 46 + n * 16);
			var cardW = n === 1 ? 150 : 150, cardH = 54, leadW = 160, leadH = 60;
			var edgeParts = [], nodeParts = [];
			function memberAnchor(i) {
				var a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
				return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a), a: a };
			}
			var statusColor = { running: "#22c55e", inactive: "#9aa0a6", provisioning: "#38bdf8", failed: "#ef4444" };
			for (var i = 0; i < n; i++) {
				var m = members[i], anc = memberAnchor(i);
				var x1 = CX + leadW / 2 * Math.cos(anc.a), y1 = CY + leadH / 2 * Math.sin(anc.a);
				var x2 = anc.x - cardW / 2 * Math.cos(anc.a), y2 = anc.y - cardH / 2 * Math.sin(anc.a);
				var mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 10;
				edgeParts.push(
					h("line", { key: "l" + i, className: "oetGEdge", x1: x1, y1: y1, x2: x2, y2: y2 }),
					h("text", { key: "t" + i, className: "oetGEdgeLabel", x: mx, y: my, textAnchor: "middle" }, i === 0 ? t("panel.graph.edge") : " ")
				);
				var prof = "";
				for (var k = 0; k < SHIPPED_MEMBERS.length; k++) {
					if (SHIPPED_MEMBERS[k].name === m.name || SHIPPED_MEMBERS[k].display === m.name) { prof = SHIPPED_MEMBERS[k].profession; break; }
				}
				if (!prof) prof = m.profession || m.description || "";
				var dot = memberStatusOf(m.status);
				nodeParts.push(
					h("g", { key: "g" + i, className: "oetGNode", transform: "translate(" + (anc.x - cardW / 2) + "," + (anc.y - cardH / 2) + ")" },
						h("rect", { width: cardW, height: cardH }),
						h("text", { className: "oetGName", x: 14, y: 22 }, m.name),
						h("text", { className: "oetGRole", x: 14, y: 40, style: { font: "10px sans-serif" } }, String(prof).slice(0, 34)),
						h("circle", { className: "oetGDot " + dot, cx: cardW - 12, cy: 14, r: 4 }),
						m.status ? h("title", null, "status: " + m.status) : null
					)
				);
			}
			// 中心 lead 卡
			var leadName = n > 0 ? "/" : "";
			nodeParts.unshift(
				h("g", { key: "lead", className: "oetGNode is-lead", transform: "translate(" + (CX - leadW / 2) + "," + (CY - leadH / 2) + ")" },
					h("rect", { width: leadW, height: leadH }),
					h("text", { className: "oetGName", x: 16, y: 24 }, "lead"),
					h("text", { className: "oetGRole", x: 16, y: 43, style: { font: "10px sans-serif" } }, t("panel.graph.lead")),
					h("circle", { className: "oetGDot running", cx: leadW - 12, cy: 15, r: 4 })
				)
			);
			var legend = (
				h("div", { className: "oetGLeg" },
					h("span", null, h("i", { style: { background: "#22c55e" } }), "running"),
					h("span", null, h("i", { style: { background: "#9aa0a6" } }), "inactive"),
					h("span", null, h("i", { style: { background: "#38bdf8" } }), "provisioning"),
					h("span", null, h("i", { style: { background: "#ef4444" } }), "failed"),
					h("span", { style: { marginLeft: 4 } }, t("panel.graph.scheme"))
				)
			);
			return h("div", { className: "oetGraph" },
				h("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": t("panel.graph.hint") },
					h("defs", null,
						h("marker", { id: "oetArrow", markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: "auto", markerUnits: "strokeWidth" },
							h("path", { d: "M0,0 L8,4 L0,8 z", fill: "var(--dsw-alias-border-l3, rgba(128,128,128,.5))" })
						)
					),
					edgeParts,
					nodeParts
				),
				legend,
				h("div", { style: { marginTop: 8, fontSize: 11.5, color: "var(--dsw-alias-label-tertiary, #9aa0a6)" } }, t("panel.graph.hint"))
			);
			} catch (e) {
				console.error("[dsh-expert-team] currentTeamGraph failed:", e);
				return h("div", { className: "oetGraph" },
					h("div", { style: { padding: "22px 16px", fontSize: 12.5, color: "var(--dsw-alias-state-error-primary, #d93025)", textAlign: "center", border: "1px dashed rgba(217,48,37,.4)", borderRadius: 10 } },
						"拓扑图异常：" + (e && e.message ? e.message : String(e)) + "（详见控制台）"
					)
				);
			}
		}

		// ── Round 30：Obsidian 式画布（当前对话 tab 主视图）──
		// 节点 = lead/成员卡，可在画布上拖拽（位置持久化 localStorage）；连线 = 实时 SVG；
		// 运行表现：is-busy 呼吸光环（byId running）；消息脉动：byId updatedAt 变化时连线
		// 播放脉冲（dash 游走），方向按成员是否 running 推断（running → 成员→lead 回传，否则 lead→成员）。
		var CV_NODE_W = 168, CV_NODE_H = 58;
		function cvStorageKey(leadId) { return "dsh-expert-team-graph-" + (leadId || "none"); }
		function cvLoadLayout(leadId, members) {
			try {
				var raw = window.localStorage.getItem(cvStorageKey(leadId));
				if (raw) return JSON.parse(raw);
			} catch (e) { }
			// 星型初始布局：lead 居中，成员沿环
			var W = 760, H = Math.max(420, 300 + members.length * 46), R = Math.min(240, 70 + members.length * 30);
			var lay = { lead: { x: W / 2 - CV_NODE_W / 2, y: H / 2 - CV_NODE_H / 2 } };
			for (var i = 0; i < members.length; i++) {
				var a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(members.length, 1);
				lay[members[i].name] = { x: W / 2 + R * Math.cos(a) - CV_NODE_W / 2, y: H / 2 + R * Math.sin(a) - CV_NODE_H / 2 };
			}
			return lay;
		}
		function cvSaveLayout(leadId, lay) {
			try { window.localStorage.setItem(cvStorageKey(leadId), JSON.stringify(lay)); } catch (e) { }
		}
		// 画布内点 → 节点中心的连线端点
		function cvCenter(lay, name, w, h) {
			var p = lay[name] || { x: 0, y: 0 };
			return { x: p.x + CV_NODE_W / 2, y: p.y + CV_NODE_H / 2 };
		}
		function CurrentTeamCanvas(props) {
			var t = props.t || makeT(props);
			var ctx = props.ctx, sid = props.sid, snap = props.snap || {}
			try {
				var byId = snap.byId || {};
				var row = byId[sid] || {};
				var leadId =
					row.parentId ||
					(row.subagent && row.subagent.address && row.subagent.address.parentSessionId) ||
					(row.header && row.header.parentSession) ||
					sid ||
					null;
				var proj = (snap.projectionsBySession || {})[leadId];
				var team = proj && proj.values ? proj.values.agentTeam : null;
				var members = (team && Array.isArray(team.members) ? team.members : []).filter(function (m) { return m && m.id; });
				var n = members.length;
				// 布局 state（localStorage 持久化）
				var stLay = react.useState(function () { return cvLoadLayout(leadId, members); });
				var lay = stLay[0], setLay = stLay[1];
				var stDrag = react.useState(null);
				var drag = stDrag[0], setDrag = stDrag[1];
				// 脉动 state：{name: {key, dir, ts}}
				var stPulse = react.useState({});
				var pulse = stPulse[0], setPulse = stPulse[1];
				var lastActRef = react.useRef({});
				// 监听活动：成员 updatedAt / running 变化 → 触发连线脉动
				react.useEffect(function () {
					var last = lastActRef.current;
					var nowAct = {};
					var fired = [];
					for (var i = 0; i < members.length; i++) {
						var id = members[i].id, name = members[i].name;
						var r = byId[id] || {};
						var upd = r.updatedAt || 0;
						nowAct[name] = upd;
						var prev = last[name];
						if (prev === void 0 || upd > prev) {
							fired.push({ name: name, dir: r.running ? "out" : "in" });
						}
						last[name] = upd;
					}
					// running 翻转也触发一次（进/出工作态）
					for (var j = 0; j < members.length; j++) {
						var id2 = members[j].id, name2 = members[j].name;
						var runPrev = last["__run_" + name2];
						var runNow = !!(byId[id2] || {}).running;
						if (runPrev !== void 0 && runPrev !== runNow) fired.push({ name: name2, dir: runNow ? "out" : "in" });
						last["__run_" + name2] = runNow;
					}
					lastActRef.current = nowAct;
					fired.forEach(function (f) {
						var key = Date.now();
						setPulse(function (p) {
							var nn = {};
							for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) nn[k] = p[k];
							nn[f.name] = { key: key, dir: f.dir };
							return nn;
						});
						setTimeout(function () {
							setPulse(function (p) {
								var cur = p[f.name];
								if (!cur || cur.key !== key) return p; // 已有更新脉冲，不误删
								var nn = {};
								for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k) && k !== f.name) nn[k] = p[k];
								return nn;
							});
						}, 950);
					});
				}, [snap]);
				// 拖拽（window 级 move/up）
				react.useEffect(function () {
					if (!drag) return;
					function onMove(e2) {
						setLay(function (l) {
							var nn = {};
							for (var k in l) if (Object.prototype.hasOwnProperty.call(l, k)) nn[k] = { x: l[k].x, y: l[k].y };
							nn[drag.name] = { x: drag.startX + (e2.clientX - drag.mx), y: drag.startY + (e2.clientY - drag.my) };
							return nn;
						});
					}
					function onUp() {
						if (typeof document === "undefined") return;
						document.removeEventListener("pointermove", onMove);
						document.removeEventListener("pointerup", onUp);
						setLay(function (l) { cvSaveLayout(leadId, l); return l; });
						setDrag(null);
					}
					document.addEventListener("pointermove", onMove);
					document.addEventListener("pointerup", onUp);
					return function () {
						document.removeEventListener("pointermove", onMove);
						document.removeEventListener("pointerup", onUp);
					};
				}, [drag]);

				// 空态（必须在本组件所有 hooks 之后返回，保证 hooks 数量稳定）
				if (n === 0) {
					return h("div", { className: "oetGraph" },
						h("div", { style: { padding: "22px 16px", fontSize: 12.5, color: "var(--dsw-alias-label-secondary, #b8bcc4)", textAlign: "center", border: "1px dashed var(--dsw-alias-border-l3, rgba(128,128,128,.35))", borderRadius: 10 } },
							t("panel.graph.empty")
						)
					);
				}

				var W = 760, H = Math.max(420, 300 + members.length * 46);
				var lines = [], nodes = [];
				// 连线
				for (var i = 0; i < members.length; i++) {
					var m = members[i];
					var c1 = cvCenter(lay, "lead", CV_NODE_W, CV_NODE_H);
					var c2 = cvCenter(lay, m.name, CV_NODE_W, CV_NODE_H);
					var p = pulse[m.name];
					var isPulse = !!(p && Date.now() - p.key < 1000);
					lines.push(h("line", {
						key: "ln" + i, x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y,
						className: "oetLink" + (isPulse ? " is-pulse" : "")
					}));
				}
				// lead 节点
				var leadCard = h("div", {
					key: "cv-lead",
					className: "oetCvNode is-lead",
					style: { left: (lay["lead"] ? lay["lead"].x : 250) + "px", top: (lay["lead"] ? lay["lead"].y : 150) + "px" },
					onPointerDown: function (e) {
						e.preventDefault();
						var st = lay["lead"] || { x: 250, y: 150 };
						setDrag({ name: "lead", startX: st.x, startY: st.y, mx: e.clientX, my: e.clientY });
					}
				},
					h("div", { className: "oetCvName" }, "lead"),
					h("div", { className: "oetCvRole" }, t("panel.graph.lead")),
					h("span", { className: "oetCvBadge" }, "🟢")
				);
				nodes.push(leadCard);
				// 成员节点
				var memberDrag = function (n) {
					return function (e) {
						e.preventDefault();
						var st = lay[n] || { x: 100, y: 100 };
						setDrag({ name: n, startX: st.x, startY: st.y, mx: e.clientX, my: e.clientY });
					};
				};
				for (var k = 0; k < members.length; k++) {
					var mk = members[k];
					var rk = byId[mk.id] || {};
					var busy = !!rk.running;
					var prof = "";
					for (var z = 0; z < SHIPPED_MEMBERS.length; z++) {
						if (SHIPPED_MEMBERS[z].name === mk.name || SHIPPED_MEMBERS[z].display === mk.name) { prof = SHIPPED_MEMBERS[z].profession; break; }
					}
					if (!prof) prof = mk.profession || mk.description || "";
					nodes.push(h("div", {
						key: "cv-" + mk.name,
						className: "oetCvNode" + (busy ? " is-busy" : "") + (drag && drag.name === mk.name ? " is-dragging" : ""),
						style: { left: (lay[mk.name] ? lay[mk.name].x : 100) + "px", top: (lay[mk.name] ? lay[mk.name].y : 100) + "px" },
						onPointerDown: memberDrag(mk.name)
					},
						h("div", { className: "oetCvName" }, mk.name),
						h("div", { className: "oetCvRole" }, String(prof).slice(0, 40)),
						h("span", { className: "oetCvBadge" }, busy ? "运行中" : mk.status === "failed" ? "失败" : "待命")
					));
				}
				return h("div", { style: { marginTop: 2 } },
					h("div", { className: "oetCanvas", style: { height: H } },
						h("svg", { className: "oetLinks", viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none" }, lines),
						nodes
					),
					h("div", { className: "oetCanvasTitle" },
						h("span", null, "🖱 拖拽节点调布局（自动保存）  ·  ", h("b", null, "光环 = 正在干活"), "  ·  连线脉冲 = 消息流动"),
						h("span", { style: { marginLeft: "auto" } }, t("panel.graph.scheme"))
					)
				);
			} catch (e) {
				console.error("[dsh-expert-team] currentTeamCanvas failed:", e);
				return h("div", { className: "oetGraph" },
					h("div", { style: { padding: "22px 16px", fontSize: 12.5, color: "var(--dsw-alias-state-error-primary, #d93025)", textAlign: "center", border: "1px dashed rgba(217,48,37,.4)", borderRadius: 10 } },
						"团队画布异常：" + (e && e.message ? e.message : String(e)) + "（详见控制台）"
					)
				);
			}
		}

		// 顶部 conversation.view「专家团模板」tab（buka 助理同款机制：对话/轨迹/
		// 上下文/画廊/buka助理 那条 tab 条的槽）。order 30 与 buka 并列；label 走
		// 自带字典（locale:NS 注入，组件取 props.t）。conversation.view 为 list 槽：
		// register({name, id, order, label}) 即可出现在条上，点击在面板内打开整页。
		// 此为主挂点——不再注册 sidebar-right tab（避免右栏旁挂的错位展示）。
		var inject = ["slots", "locale", "sessions", "uiWorkspace", "conversation", "sidebarRight"];

		// ── Round 28c：/ 菜单不再注册本插件的行——创建入口收敛为宿主 slash 指令
		//    `/expert-import`（lib/index.js 注册，kantu 同款：菜单行+hint+回车即执行）
		//    与模板卡片「创建」（自动写 /expert-import <模板名> --ctx … --model …）。

		function apply(ctx) {
			pluginCtx = ctx;
			injectTabStyles();
			ctx.effect(function () {
				return ctx.locale.register(NS, { zh: zh, en: en });
			}, "dsh-expert-team: dictionaries");

			var t = makeT({});

			// 顶部 tab：专家团模板（conversation.view，README/CLIENT_UI_PLAN ⑩ 记录）。
			// inject 尽力把槽所在会话 id 传给组件（tabSessionId；renderer 对会话作用域
			// 的槽调用 entry.inject(bindingKey,...)）；组件内再有 activeSessionId 兜底。
			ctx.slots.inject("conversation.view", function () {
				return ctx.slots.register({
					name: "conversation.view",
					id: "expert-team-templates",
					order: 30,
					locale: NS,
					label: function () { return makeT({})("header.action"); },
					inject: function (key) { return { tabSessionId: key == null ? null : String(key) }; }
				}, TemplatesTabBody);
			});

			// 创建入口 = 宿主 slash 指令 /expert-import（lib/index.js 注册，无需 client 侧再注入）。
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
