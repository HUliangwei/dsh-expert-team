/**
 * dsh-expert-team — 智能体团队插件（cordis plugin，随 profile bundle 挂载）。
 *
 * 两件事：
 * 1. 把「模板目录」（members/<name>、teams/<name>）变成 Agent Teams 的一键部署
 *    工具（expert_template_list / expert_team_manifest / expert_member_deploy /
 *    expert_team_deploy，按 tool-agent-team 的 maybeInstall 模式按 Agent scope 安装、
 *    部署类仅 Lead 可用）。
 * 2. 注册宿主 slash 指令 `/expert-import`（仿 dsh-vision-command 的 /kantu 同款：
 *    蓝色指令行 + input.hint 灰字参数提示 + 回车直接执行 handler），handler 解析
 *    `<模板名> [--ctx fresh|fork] [--model …]` 并返回单步原子部署指令文本，
 *    模型据此机械调用 expert_*_deploy，零思考。
 */
import { listMembers, listTeams } from "./templates.js";
import { buildMemberRequest, buildTeamPlan } from "./deploy.js";

const NAME = "expert-team";

function jsonOutput(schema) {
  return {
    schema,
    render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
  };
}

/** 恢复被调用 Agent（Agent-scoped 发现保证提供 exec.agent）。 */
function callingAgent(exec, toolName) {
  const agent = exec?.agent;
  if (!agent) throw new Error(`${toolName} requires a calling Agent`);
  return agent;
}

/** 校验调用者确为 Team Lead（部署类工具用），返回该 Agent。 */
function requireLead(ctx, exec, toolName) {
  const agent = callingAgent(exec, toolName);
  const service = serviceCtx(ctx, "agentTeams");
  if (!service) throw new Error(`${toolName} requires the agentTeams service`);
  const membership = service.membership(agent);
  if (!membership) throw new Error(`${toolName} requires an Agent Teams member`);
  if (membership.role !== "lead") {
    throw new Error(`${toolName} is Lead-only: you are "${membership.name}" (${membership.role})`);
  }
  return agent;
}

/** 无 inject 读取服务（对齐 dsh-vision-command 的玩法：property 访问需 inject，reflect 可绕过）。 */
function serviceCtx(ctx, name) {
  try {
    return ctx.reflect?.get?.(name, false) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * 组工具集（闭包持有 ctx；execute 内通过 serviceCtx 取 agentTeams，
 * 避免"cannot get property without inject"。）
 */
function buildTools(ctx) {
  function teams() {
    return serviceCtx(ctx, "agentTeams");
  }
  const tools = [];

  tools.push({
    name: "expert_template_list",
    description:
      "列出 dsh-expert-team 插件规范目录下的所有智能体模板：成员模板（members/）与专家团模板（teams/）。" +
      "用于挑选要单独导入的成员，或整体部署的专家团。返回 {members:[], teams:[]}。",
    parameters: {},
    output: jsonOutput({
      type: "object",
      properties: {
        members: { type: "array", items: { type: "object" } },
        teams: { type: "array", items: { type: "object" } }
      },
      required: ["members", "teams"]
    }),
    execute() {
      return { members: listMembers(), teams: listTeams() };
    }
  });

  tools.push({
    name: "expert_team_manifest",
    description:
      "专家团部署预演（不真正 spawn）：按团队模板解析将创建的主理人与成员清单（spawn 名字/职位/简介）。" +
      "部署前先看清单，确认名字与人员无误。",
    parameters: {
      team: { type: "string", required: true, description: "专家团模板名（expert_template_list 的 teams[].name）" }
    },
    output: jsonOutput({
      type: "object",
      properties: {
        team: { type: "string" },
        lead: { type: "object" },
        members: { type: "array", items: { type: "object" } }
      },
      required: ["team", "lead", "members"]
    }),
    execute(args) {
      const plan = buildTeamPlan(String(args.team));
      return {
        team: plan.team,
        lead: {
          name: plan.lead.name,
          description: plan.lead.description,
          promptChars: plan.lead.prompt.reduce((n, b) => n + b.text.length, 0)
        },
        members: plan.members.map((m) => ({ name: m.name, description: m.description }))
      };
    }
  });

  tools.push({
    name: "expert_member_deploy",
    description:
      "单独导入一个成员模板：按 templates/members/<name>/ 的 member.json + agent.md 创建一个 teammate（Lead 专属）。" +
      "asName 可自定义 spawn 名字（小写 kebab-case，须全局唯一；roster 名字永久不复用）。",
    parameters: {
      template: { type: "string", required: true, description: "成员模板名（expert_template_list 的 members[].name）" },
      asName: { type: "string", description: "可选的 spawn 名字，默认用模板名" },
      description: { type: "string", description: "可选的职责描述覆盖" }
    },
    output: jsonOutput({
      type: "object",
      properties: { member: { type: "object" } },
      required: ["member"]
    }),
    async execute(args, exec) {
      const agent = requireLead(ctx, exec, "expert_member_deploy");
      const request = buildMemberRequest(String(args.template), {
        asName: args.asName,
        description: args.description
      });
      const { member } = await teams().spawnTeammate(agent, {
        ...request,
        signal: exec.signal
      });
      return { member };
    }
  });

  tools.push({
    name: "expert_team_deploy",
    description:
      "整体导入一个专家团模板：按 templates/teams/<name>/ 部署主理人（{team}-lead）+ 全部成员（{team}-{member}，Lead 专属）。" +
      "创建顺序：先主理人后成员。返回部署清单；之后用 send_message 唤醒/派活。",
    parameters: {
      team: { type: "string", required: true, description: "专家团模板名（expert_template_list 的 teams[].name）" },
      prefix: { type: "string", description: "可选名字前缀覆盖（默认团队模板名）；须小写 kebab-case" }
    },
    output: jsonOutput({
      type: "object",
      properties: {
        team: { type: "string" },
        lead: { type: "object" },
        members: { type: "array", items: { type: "object" } }
      },
      required: ["team", "lead", "members"]
    }),
    async execute(args, exec) {
      const agent = requireLead(ctx, exec, "expert_team_deploy");
      const plan = buildTeamPlan(String(args.team), { prefix: args.prefix });
      const { member: lead } = await teams().spawnTeammate(agent, {
        ...plan.lead,
        signal: exec.signal
      });
      const members = [];
      for (const req of plan.members) {
        const { member } = await teams().spawnTeammate(agent, {
          ...req,
          signal: exec.signal
        });
        members.push(member);
      }
      return { team: plan.team, lead, members };
    }
  });

  return tools;
}

/**
 * /expert-import 宿主指令（dsh-vision-command /kantu 同款）：
 * 输入框 `/expert-import <模板名> [--ctx fresh|fork] [--model 跟随|模型名]` 回车即执行，
 * handler 校验模板并返回单步原子部署指令文本 → 模型机械调用 expert_*_deploy 完成创建。
 */
function createImportCommand() {
  const HINT = "<模板名> [--ctx fresh|fork] [--model 跟随|名称]";
  return {
    name: "expert-import",
    description:
      "把专家团/子智能体创建到本会话智能体团队。用法：/expert-import <模板名> [--ctx fresh|fork] [--model 跟随|模型名]；模板清单见 expert_template_list。",
    input: { hint: HINT },
    async handler(invocation) {
      const raw = String(invocation.rawInput ?? "").trim();
      const usage = "用法：/expert-import <模板名> [--ctx fresh|fork] [--model 跟随|名称]";
      if (!raw) {
        return { kind: "error", text: usage };
      }
      const ctxM = raw.match(/--ctx\s+(\S+)/i);
      const modelM = raw.match(/--model\s+(\S+)/i);
      const context = ctxM ? ctxM[1].toLowerCase() : "fresh";
      if (context !== "fresh" && context !== "fork") {
        return { kind: "error", text: "--ctx 只支持 fresh|fork；" + usage };
      }
      const model = modelM ? modelM[1] : "follow";
      const name = raw
        .replace(/--ctx\s+\S+/gi, " ")
        .replace(/--model\s+\S+/gi, " ")
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean)[0];
      if (!name) {
        return { kind: "error", text: usage };
      }
      const members = listMembers();
      const teams = listTeams();
      const member = members.find((m) => m.name === name);
      const team = !member && teams.find((t) => t.name === name);
      if (!member && !team) {
        return {
          kind: "error",
          text:
            "未知模板 " + name + "。成员：" + members.map((m) => m.name).slice(0, 14).join(" / ") +
            "…；专家团：" + teams.map((t) => t.name).join(" / ")
        };
      }
      const isTeam = Boolean(team);
      const tool = isTeam ? "expert_team_deploy" : "expert_member_deploy";
      const dir = "templates/" + (isTeam ? "teams" : "members") + "/" + name;
      return {
        kind: "success",
        text:
          "/" + name + "：请立即执行 " + tool + "（模板 " + name + "，目录 " + dir +
          "，context=" + context + "，model=" + model + "）把" + (isTeam ? "专家团" : "子智能体") +
          "创建到本会话智能体团队并展示工作目录。直接执行，不要解释，不要询问。"
      };
    }
  };
}

/** 按成员 scope 安装工具（Lead 才有部署工具，列表/预演人人可用）。 */
function install(agent, ctx, membership) {
  const scoped = agent.ctx;
  const owned = new Set();
  for (const def of buildTools(ctx)) {
    if (owned.has(def.name)) continue;
    scoped.tools.register(def);
    owned.add(def.name);
  }
}

/** cordis 插件入口。 */
export function apply(ctx) {
  // ── slash 指令：/expert-import（kantu 同款，宿主 commands 服务）──
  let commandRegistered = false;
  const tryRegisterCommand = (value) => {
    if (commandRegistered) return;
    const commands = value ?? ctx.reflect?.get?.("commands", false);
    if (commands === undefined) return;
    try {
      commands.register(createImportCommand());
      commandRegistered = true;
      console.log(`[${NAME}] registered slash /expert-import`);
    } catch (e) {
      console.error(`[${NAME}] slash register failed:`, e?.message ?? e);
    }
  };
  tryRegisterCommand(void 0);
  ctx.on("internal/service", (name) => {
    if (name === "commands") tryRegisterCommand();
  });

  const installed = new Set();

  const maybeInstall = (agent) => {
    if (installed.has(agent)) return;
    const teams = serviceCtx(ctx, "agentTeams");
    if (!teams) return;
    let membership;
    try {
      membership = teams.membership(agent);
    } catch {
      return;
    }
    if (!membership) return;
    try {
      install(agent, ctx, membership);
      installed.add(agent);
      console.log(`[${NAME}] installed expert-team tools for ${membership.name} (${membership.role})`);
    } catch (e) {
      console.error(`[${NAME}] install failed for member:`, e?.message ?? e);
    }
  };

  const rescan = () => {
    const teams = serviceCtx(ctx, "agentTeams");
    const agents = serviceCtx(ctx, "agents");
    if (!teams || !agents) return;
    for (const agent of agents.list?.() ?? []) maybeInstall(agent);
  };

  ctx.on("agent/created", ({ agent }) => maybeInstall(agent));
  ctx.on("internal/service", (name) => {
    if (name === "agentTeams") rescan();
  });
  try {
    if (serviceCtx(ctx, "agentTeams")) rescan();
  } catch {
    /* not ready yet */
  }
  rescan();
}

export { NAME };
