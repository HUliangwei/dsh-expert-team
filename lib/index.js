/**
 * dsh-expert-team — 智能体团队插件（cordis plugin，随 profile bundle 挂载）。
 *
 * 两件事：
 * 1. 把「模板目录」（members/<name>、teams/<name>）变成 Agent Teams 的一键部署
 *    工具（expert_template_list / expert_team_manifest / expert_member_deploy /
 *    expert_team_deploy，按 tool-agent-team 的 maybeInstall 模式按 Agent scope 安装、
 *    部署类仅 Lead 可用）。
 * 2. 注册宿主 slash 指令 `/dsh-agent`（仿 dsh-vision-command 的 /kantu 同款：
 *    蓝色指令行 + input.hint 灰字参数提示 + 回车即执行）。Round 28d：handler 直接
 *    spawn（invocation.agent），不依赖模型解读；仅无可用的 agentTeams/当前 agent 时
 *    退回“返回单步原子部署指令给模型”的旧链路。
 */

/** 模块级 ctx：apply 注入后共享给命令 handler（cordis 每次 apply 覆盖）。 */
let MODULE_CTX = null;
import { listMembers, listTeams } from "./templates.js";
import { buildMemberRequest, buildTeamPlan } from "./deploy.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "expert-team";
/** 归档根目录：仓库内 archive/（.gitignore 排除，不回传公开仓库）。 */
const ARCHIVE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "archive");

/**
 * 终端彩色（ANSI，仅 TTY 生效）：
 * - 直接跑 dsh web（stdout = 控制台）→ 彩色；
 * - 管道/重定向（e2e 的 Tee 日志、文件导出）→ isTTY false → 自动无色，不污染文件；
 * - 环境变量约定：NO_COLOR 强制无色，FORCE_COLOR 强制彩色。
 */
const COL = {
  cyan: "\x1b[36m", yellow: "\x1b[33m", green: "\x1b[32m",
  red: "\x1b[31m", bold: "\x1b[1m", dim: "\x1b[2m", reset: "\x1b[0m"
};
const ANSI_OK = (() => {
  try {
    if (typeof process === "undefined" || !process.stdout) return false;
    if (process.env.NO_COLOR !== undefined) return false;
    if (process.env.FORCE_COLOR !== undefined) return true;
    return !!process.stdout.isTTY;
  } catch {
    return false;
  }
})();
const paint = (s, c) => (ANSI_OK ? c + s + COL.reset : s);

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
 * 子命令 import（/dsh-agent import，dsh-vision-command /kantu 同款）：
 * 输入框 `/dsh-agent import <模板名> [--ctx fresh|fork] [--model 跟随|名称]` 回车即执行。
 * Round 28d：handler 直接调用 agentTeams.spawnTeammate（invocation.agent = 当前会话 agent），
 * **不依赖模型解读**——回车即创建（“像代码执行一样”）。仅当拿不到 agent/服务时退回
 * “返回单步原子部署指令给模型”的旧链路。
 */
function createImportCommand(ctxCtx) {
  const ctx = ctxCtx || MODULE_CTX;
  const HINT = "<模板名> [--ctx fresh|fork] [--model 跟随|名称]";
  const leadOf = (agent) => {
    const service = serviceCtx(ctx, "agentTeams");
    if (!service) throw new Error("/dsh-agent import requires the agentTeams service");
    const membership = service.membership(agent);
    if (!membership) throw new Error("/dsh-agent import requires an Agent Teams member");
    if (membership.role !== "lead") {
      throw new Error("/dsh-agent import is Lead-only: you are \"" + membership.name + "\" (" + membership.role + ")");
    }
    return agent;
  };
  return {
    name: "import", // 内部子命令标识；界面统一指令头 /dsh-agent，runAgentCommand 以此分发
    description:
      "把专家团/子智能体创建到本会话智能体团队（回车即创建，无需模型等待）。用法：/dsh-agent import <模板名> [--ctx fresh|fork] [--model 跟随|名称]；模板清单见 expert_template_list。",
    input: { hint: HINT },
    async handler(invocation) {
      const raw = String(invocation.rawInput ?? "").trim();
      console.log(paint(`[expert-team]`, COL.cyan) + ` /dsh-agent import handled raw=${JSON.stringify(raw)} hasAgent=${!!(invocation && invocation.agent)}`);
      const usage = "用法：/dsh-agent import <模板名> [--ctx fresh|fork] [--model 跟随|名称]";
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
      const provider = context === "fork" ? "fork" : "spawn";
      const tokens = raw
        .replace(/--ctx\s+\S+/gi, " ")
        .replace(/--model\s+\S+/gi, " ")
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      // rawInput 可能含完整命令串（"/dsh-agent import <模板名> …"）→ 跳过命令名那一项
      let name = tokens[0];
      if (name && String(name).startsWith("/") && tokens[1]) name = tokens[1];
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

      // ── 直接创建（不依赖模型）──────────────────────────────
      const service = serviceCtx(ctx, "agentTeams");
      if (service && invocation && invocation.agent) {
        try {
          leadOf(invocation.agent);
          const extra = { provider, context };
          if (model !== "follow") extra.model = model;
          if (team) {
            const plan = buildTeamPlan(name);
            const { member: lead } = await service.spawnTeammate(invocation.agent, {
              ...plan.lead, ...extra, signal: invocation.signal
            });
            const spawned = [];
            for (const req of plan.members) {
              const r = await service.spawnTeammate(invocation.agent, {
                ...req, ...extra, signal: invocation.signal
              });
              spawned.push(r.member?.name ?? r.member ?? req.name);
            }
            return {
              kind: "success",
              text:
                `✅ 专家团「${name}」已创建（ctx=${context}，provider=${provider}）→ ` +
                `主理人 ${lead?.name ?? name + "-lead"}；成员 [${spawned.join(", ")}]。` +
                "用 list_agents() 查看；向主理人 send_message 派活。工作目录即当前会话目录。"
            };
          }
          const request = buildMemberRequest(name, {});
          const { member: spawned } = await service.spawnTeammate(invocation.agent, {
            ...request, ...extra, signal: invocation.signal
          });
          return {
            kind: "success",
            text:
              `✅ 子智能体「${name}」已创建（ctx=${context}，provider=${provider}）→ ` +
              `spawn ${spawned?.name ?? spawned ?? name}。用 list_agents() 查看；工作目录即当前会话目录。`
          };
        } catch (e) {
          console.error(paint(`[expert-team]`, COL.red) + ` /dsh-agent import spawn failed:`, e?.message ?? e);
          return { kind: "error", text: "创建失败：" + (e?.message ?? String(e)) };
        }
      }

      // ── 兜底：无 agentTeams/无当前 agent → 返回原子指令文本给模型执行 ──
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

/**
 * 子命令 member 子智能体管理（lead-only，Round 33）。
 * 用法：/dsh-agent member <archive|restock|rename> <成员名> [新名字]
 *  - archive：停用（interrupt）+ 历史快照到 archive/<名>-<ts>/；roster 名单官方不可删，
 *    画布侧隐藏（菜单提示）。
 *  - restock：先按 archive 归档旧对话，再用描述重建同名新成员（fresh，名字自动 -r2/-r3…），
 *    实现「清空对话 = 新工作」。
 *  - rename：改成员会话标题（提示用画布浮窗直连，更可靠）。
 */
function createMemberCommand(ctxCtx) {
  const ctx = ctxCtx || MODULE_CTX;
  const usage = "用法：/dsh-agent member <archive|restock|rename> <成员名> [新名字]";
  const leadOf = (agent) => {
    const service = serviceCtx(ctx, "agentTeams");
    if (!service) throw new Error("/dsh-agent member requires the agentTeams service");
    const membership = service.membership(agent);
    if (!membership) throw new Error("/dsh-agent member requires an Agent Teams member");
    if (membership.role !== "lead") {
      throw new Error("/dsh-agent member is Lead-only: you are \"" + membership.name + "\" (" + membership.role + ")");
    }
    return agent;
  };
  const snapshotMember = async (row) => {
    try {
      const q = serviceCtx(ctx, "sessionQuery");
      if (!q || !row.id) return null;
      const observed = await q.observeSession(row.id);
      const events = observed?.events ?? [];
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const dir = path.join(ARCHIVE_ROOT, row.name + "-" + ts);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "session.jsonl"),
        events.map((ev) => JSON.stringify(ev)).join("\n"), "utf8");
      fs.writeFileSync(path.join(dir, "meta.json"),
        JSON.stringify({ name: row.name, description: row.description ?? "", archivedAt: ts, sessionId: row.id }, null, 2), "utf8");
      return dir;
    } catch (e) {
      console.error(paint(`[expert-team]`, COL.red) + ` snapshot failed for ${row?.name}:`, e?.message ?? e);
      return null;
    }
  };
  return {
    name: "member", // 内部子命令标识；界面统一指令头 /dsh-agent，runAgentCommand 以此分发
    description:
      "子智能体管理（Lead 专属）。archive=停用并归档历史到 archive/（roster 名单保留，画布隐藏）；" +
      "restock=归档旧对话并按原描述重建同名新成员（fresh，名字 -r2/-r3…，即“清空对话”）；rename=改成员会话标题（提示用画布浮窗直连）。",
    input: { hint: usage },
    async handler(invocation) {
      const raw = String(invocation.rawInput ?? "").trim();
      if (!raw) return { kind: "error", text: usage };
      const tokens = raw.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      let sub = tokens[0], name = tokens[1], extra = tokens[2];
      if (sub && String(sub).startsWith("/") && tokens[1]) { sub = tokens[1]; name = tokens[2]; extra = tokens[3]; }
      if (!sub) return { kind: "error", text: usage };
      if (sub !== "archive-list" && !name) return { kind: "error", text: usage };
      const service = serviceCtx(ctx, "agentTeams");
      if (!service || !invocation?.agent) return { kind: "error", text: "agentTeams 服务不可用" };
      try {
        leadOf(invocation.agent);
        // 归档浏览（无需成员名）
        if (sub === "archive-list") {
          try {
            const dirs = fs.existsSync(ARCHIVE_ROOT)
              ? fs.readdirSync(ARCHIVE_ROOT).filter((d) => {
                  try { return fs.statSync(path.join(ARCHIVE_ROOT, d)).isDirectory(); } catch { return false; }
                }).sort().reverse()
              : [];
            if (!dirs.length) return { kind: "success", text: "📂 暂无归档（archive/ 为空）。归档由 /dsh-agent member archive|restock 产生。" };
            const lines = dirs.slice(0, 30).map((d) => {
              let meta = null;
              try { meta = JSON.parse(fs.readFileSync(path.join(ARCHIVE_ROOT, d, "meta.json"), "utf8")); } catch { }
              return `- ${d}${meta ? "  ·  " + (meta.name || "") + (meta.description ? "（" + String(meta.description).slice(0, 36) + "）" : "") : ""}`;
            });
            return {
              kind: "success",
              text: "📂 已归档（archive/ 共 " + dirs.length + " 个）：\n" + lines.join("\n") +
                "\n\n恢复：/dsh-agent member restore <目录名>"
            };
          } catch (e) {
            return { kind: "error", text: "读取归档失败：" + (e?.message ?? String(e)) };
          }
        }
        const rows = service.listMembers(invocation.agent);
        // 从归档恢复成员（fresh；名字空闲则用原名，否则 -rN）
        if (sub === "restore") {
          const dirName = name;
          const dir = path.join(ARCHIVE_ROOT, dirName);
          if (!fs.existsSync(dir)) return { kind: "error", text: "归档不存在：archive/" + dirName };
          let meta = {};
          try { meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")); } catch (e) { }
          if (!meta || typeof meta !== "object") meta = {};
          const base = String(meta.name || dirName);
          let k = 0, newName = base;
          const existing = new Set(rows.map((r) => r.name));
          while (existing.has(newName)) { k += 1; newName = base + "-r" + k; }
          const promptText =
            `你是团队成员「${base}」（${meta.description ?? "恢复自归档"}）。已从归档恢复：继续承担原职责。`;
          const { member: spawned } = await service.spawnTeammate(invocation.agent, {
            name: newName,
            description: meta.description ?? "",
            prompt: [{ type: "text", text: promptText }],
            context: "fresh",
            signal: invocation.signal
          });
          return {
            kind: "success",
            text:
              `♻️ 已从归档恢复 ${base} → ${spawned?.name ?? newName}（fresh，对话名即 ${base}）。向新成员 send_message 派活即可。`
          };
        }
        const row = rows.find((r) => r.name === name);
        if (!row) {
          return { kind: "error", text: "未找到成员 " + name + "。" + usage };
        }
        if (sub === "rename") {
          return { kind: "error", text: "改名请用画布节点浮窗（直连通道更可靠）：左键单击节点 → ✏️ 重命名。" };
        }
        if (sub === "archive" || sub === "restock") {
          let dir = null;
          try { dir = await snapshotMember(row); } catch (e) { console.error(e); }
          let stopped = "";
          try {
            if (row.status === "running") {
              service.interrupt(invocation.agent, row.name);
              stopped = "（已停用）";
            }
            else if (service.listMembers(invocation.agent).find((r) => r.id === row.id)?.status === "running") {
              service.interrupt(invocation.agent, row.name);
              stopped = "（已停用）";
            }
          } catch (e) {
            stopped = "（打断失败：" + (e?.message ?? e) + "）";
          }
          const rel = dir ? dir.replace(/.*[\\/]expert-team[\\/]/, "…/") : "（快照不可用，仅停用）";
          if (sub === "archive") {
            return {
              kind: "success",
              text:
                `🗂 已归档 ${name}${stopped}。历史 → ${rel}；roster 名单保留（DSH 官方不可删），` +
                "画布已隐藏，可用浮窗同一名字重新接管。"
            };
          }
          let k = 1, newName = name + "-r" + k;
          const existing = new Set(service.listMembers(invocation.agent).map((r) => r.name));
          while (existing.has(newName)) { k += 1; newName = name + "-r" + k; }
          const promptText =
            `你是团队成员「${name}」（${row.description ?? "子智能体"}）。这是清空后的全新开始：` +
            "基于当前任务目标重新开展工作。";
          const { member: spawned } = await service.spawnTeammate(invocation.agent, {
            name: newName,
            description: row.description ?? "",
            prompt: [{ type: "text", text: promptText }],
            context: "fresh",
            signal: invocation.signal
          });
          return {
            kind: "success",
            text:
              `🔄 已清空 ${name}：旧对话归档 → ${rel}；新成员 ${spawned?.name ?? newName} 已就位（fresh 新开始）。` +
              "向新成员 send_message 派活即可。"
          };
        }
        return { kind: "error", text: "未知子命令 " + sub + "。" + usage };
      } catch (e) {
        console.error(paint(`[expert-team]`, COL.red) + ` /dsh-agent member ${sub} failed:`, e?.message ?? e);
        return { kind: "error", text: "操作失败：" + (e?.message ?? String(e)) };
      }
    }
  };
}

/**
 * 子命令 task 共享任务管理（lead-only，Round 40）。
 * 用法：/dsh-agent task <create|claim|complete|reopen|delete|edit|assign> …
 *  - create <标题> [--desc 描述]                      新建任务（unowned pending）
 *  - claim <id>                                       认领任务（执行者为 lead）
 *  - complete <id>                                    完成（CAS 取最新 revision）
 *  - reopen <id>                                      重开（completed → pending）
 *  - delete <id>                                      删除（CAS）
 *  - edit <id> <新标题> [--desc 新描述]               修改标题/描述
 *  - assign <id> <成员名>                             转派 owner
 * 任务数据来自官方 agentTeam 投影（team.tasks），本指令走官方 agentTeams 写服务。
 */
function createTaskCommand(ctxCtx) {
  const ctx = ctxCtx || MODULE_CTX;
  const usage = "用法：/dsh-agent task <create|claim|complete|reopen|delete|edit|assign> …";
  const leadOf = (agent) => {
    const service = serviceCtx(ctx, "agentTeams");
    if (!service) throw new Error("/dsh-agent task requires the agentTeams service");
    const membership = service.membership(agent);
    if (!membership) throw new Error("/dsh-agent task requires an Agent Teams member");
    if (membership.role !== "lead") {
      throw new Error("/dsh-agent task is Lead-only: you are \"" + membership.name + "\" (" + membership.role + ")");
    }
    return agent;
  };
  // CAS：官方 updateTask 要 revision，命令行不带 → 从 getTask 取最新 revision 再写
  const withLatestRevision = (agent, service, taskId, fn) => {
    const task = service.getTask(agent, taskId);
    if (!task) throw new Error("任务不存在：" + taskId);
    return fn(task.revision);
  };
  const parseArgs = (raw) => {
    const out = { action: null, id: null, subject: null, desc: null };
    const m = raw.match(/^(\S+)(?:\s+(\S+))?(?:\s+(.*))?$/);
    if (!m) return out;
    out.action = m[1];
    const restToken = m[3] || "";
    const dm = restToken.match(/--desc\s+(.+)$/);
    if (dm) { out.desc = dm[1].trim(); }
    const subjectRaw = dm ? restToken.slice(0, restToken.indexOf("--desc")).trim() : restToken.trim();
    if (m[2] !== void 0) out.id = m[2];
    out.subject = (subjectRaw || "").replace(/^["“]|["”]$/g, "");
    return out;
  };
  return {
    name: "task", // 内部子命令标识；界面统一指令头 /dsh-agent，runAgentCommand 以此分发
    description:
      "共享任务管理（Lead 专属，官方 agentTeams 投影 task）。create=新建任务；claim=认领；" +
      "complete=完成；reopen=重开；delete=删除；edit=改标题/描述；assign=转派 owner。",
    input: { hint: usage },
    async handler(invocation) {
      const raw = String(invocation.rawInput ?? "").trim();
      if (!raw) return { kind: "error", text: usage };
      const service = serviceCtx(ctx, "agentTeams");
      if (!service || !invocation?.agent) return { kind: "error", text: "agentTeams 服务不可用" };
      try {
        leadOf(invocation.agent);
        const a = parseArgs(raw);
        const action = a.action;
        // create：标题必填
        if (action === "create") {
          const title = a.id || a.subject || "";
          const desc = a.desc || "";
          if (!title) return { kind: "error", text: "create 需要任务标题：" + usage };
          const created = service.createTask(invocation.agent, {
            subject: String(title).slice(0, 120),
            description: String(desc || "").slice(0, 2000),
            blockedBy: [],
            writeScopes: [],
          });
          return { kind: "success", text: "✅ 已创建任务「" + title + "」(" + created.id + ")：" + (desc ? "描述 " + desc : "待认领") };
        }
        if (!a.id) return { kind: "error", text: usage };
        // claim：认领为 lead；已有 owner 则提示转派
        if (action === "claim") {
          const task = service.getTask(invocation.agent, a.id);
          if (!task) return { kind: "error", text: "任务不存在：" + a.id };
          if (task.ownerName) return { kind: "error", text: "任务已被 " + task.ownerName + " 认领；转派用 /dsh-agent task assign " + a.id + " <成员名>" };
          if (task.status !== "pending") return { kind: "error", text: "任务当前状态 " + task.status + "，仅 pending 可认领" };
          const updated = withLatestRevision(invocation.agent, service, a.id, (rev) =>
            service.updateTask(invocation.agent, { taskId: a.id, expectedRevision: rev, action: "claim" }));
          return { kind: "success", text: "🔵 已认领「" + task.subject + "」→ lead（rev " + updated.revision + "）" };
        }
        if (action === "complete" || action === "reopen" || action === "delete") {
          const task = service.getTask(invocation.agent, a.id);
          if (!task) return { kind: "error", text: "任务不存在：" + a.id };
          const updated = withLatestRevision(invocation.agent, service, a.id, (rev) =>
            service.updateTask(invocation.agent, { taskId: a.id, expectedRevision: rev, action }));
          const verb = action === "complete" ? "✅ 已完成" : action === "reopen" ? "🔄 已重开" : "🗑 已删除";
          return { kind: "success", text: verb + "「" + task.subject + "」（rev " + updated.revision + "）" };
        }
        if (action === "edit") {
          const title = a.subject || "";
          if (!title) return { kind: "error", text: "edit 需要新标题：" + usage };
          const task = service.getTask(invocation.agent, a.id);
          if (!task) return { kind: "error", text: "任务不存在：" + a.id };
          const updated = withLatestRevision(invocation.agent, service, a.id, (rev) =>
            service.updateTask(invocation.agent, {
              taskId: a.id, expectedRevision: rev, action: "edit",
              subject: String(title).slice(0, 120),
              ...(a.desc ? { description: String(a.desc).slice(0, 2000) } : {}),
            }));
          return { kind: "success", text: "✏️ 已改标题为「" + title + "」（rev " + updated.revision + "）" };
        }
        if (action === "assign") {
          const ownerName = a.subject || "";
          if (!ownerName) return { kind: "error", text: "assign 需要成员名：" + usage };
          const roster = service.listMembers(invocation.agent);
          const hit = roster.find((r) => r.name === ownerName);
          if (!hit) return { kind: "error", text: "成员不存在：" + ownerName + "（现有：" + roster.map((r) => r.name).join(", ") + "）" };
          const task = service.getTask(invocation.agent, a.id);
          if (!task) return { kind: "error", text: "任务不存在：" + a.id };
          const updated = withLatestRevision(invocation.agent, service, a.id, (rev) =>
            service.updateTask(invocation.agent, { taskId: a.id, expectedRevision: rev, action: "reassign", owner: ownerName }));
          return { kind: "success", text: "↔ 已转派「" + task.subject + "」→ " + ownerName + "（rev " + updated.revision + "）" };
        }
        return { kind: "error", text: "未知子命令 " + action + "。" + usage };
      } catch (e) {
        return { kind: "error", text: "操作失败：" + (e?.message ?? String(e)) };
      }
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

/* ---------------- dsh-agent 统一执行层（Round 56：唯一指令头，GUI 浮窗直呼同一层） ----------------
 * /dsh-agent <import|member|task> <…> 与 浮窗 JSON RPC（/plugins/dsh-expert-team/action）
 * 都走 runAgentCommand → 各子命令 handler（createImportCommand/createMemberCommand/createTaskCommand
 * 仅作执行函数被调用，不再各自注册为独立指令）。

async function runAgentCommand(ctx, agent, sub, restRaw) {
  const inv = { agent, rawInput: String(restRaw ?? "").trim() };
  if (sub === "import") return createImportCommand(ctx).handler(inv);
  if (sub === "member") return createMemberCommand(ctx).handler(inv);
  if (sub === "task") return createTaskCommand(ctx).handler(inv);
  return { kind: "error", text: "未知子命令 " + sub + "（支持 import|member|task）" };
}

/** 统一指令头 /dsh-agent：<import|member|task> <…>，参数与旧指令一致。 */
function createAgentCommand(ctxCtx) {
  const ctx = ctxCtx || MODULE_CTX;
  const SUB_HINT = "import <模板> | member <archive|restock|rename|restore|archive-list> | task <create|claim|complete|reopen|delete|edit|assign>";
  return {
    name: "dsh-agent",
    description:
      "智能体团队统一指令（Lead 专属）：import=一键部署专家团/成员；member=成员生命周期与归档；" +
      "task=共享任务全生命周期。用法：/dsh-agent " + SUB_HINT,
    input: { hint: SUB_HINT },
    async handler(invocation) {
      const raw = String(invocation.rawInput ?? "").trim();
      if (!raw) return { kind: "error", text: "用法：/dsh-agent " + SUB_HINT };
      const sp = raw.indexOf(" ");
      const sub = (sp < 0 ? raw : raw.slice(0, sp)).toLowerCase();
      const rest = sp < 0 ? "" : raw.slice(sp + 1).trim();
      return runAgentCommand(ctx, invocation.agent, sub, rest);
    },
  };
}

/* ---------------- 浮窗直连 JSON RPC（web host /plugins/dsh-expert-team/*） ----------------
 * 环回 3080 可达；所有写操作经 runAgentCommand（内含 lead-only 校验）。 */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) { reject(new Error("body too large")); req.destroy(); } });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("bad json body")); } });
    req.on("error", reject);
  });
}
function sendJson(res, value) {
  try { res.writeHead(200, { "content-type": "application/json" }); } catch { /* robust */ }
  res.end(JSON.stringify(value));
}

/** 身份：RPC 带 leadId（会话 id）→ agents 服务解析出 agent；Lead-only 再交各 handler 校验。 */
function resolveLeadAgent(ctx, leadId) {
  if (!leadId) return null;
  const agents = serviceCtx(ctx, "agents");
  const list = agents?.list?.() ?? [];
  const hit = list.find((a) => a && (a.id === leadId || a.name === leadId));
  return hit || null;
}

/**
 * 动作表：浮窗动作名 → 统一走 runAgentCommand（含 CAS/lead 校验）。
 * 模块级缓存（列表静态，避免每请求重建闭包）。
 */
let cachedAgentRoutes = null;
function buildActionRoutes(ctx) {
  const q = (s) => String(s ?? "").replace(/"/g, '\\"');
  return {
    // 任务
    "task.create": (b) => runAgentCommand(ctx, b.__agent, "task", 'create "' + q(b.title) + '"' + (b.desc ? " --desc " + q(b.desc) : "")),
    "task.claim": (b) => runAgentCommand(ctx, b.__agent, "task", "claim " + q(b.taskId)),
    "task.complete": (b) => runAgentCommand(ctx, b.__agent, "task", "complete " + q(b.taskId)),
    "task.reopen": (b) => runAgentCommand(ctx, b.__agent, "task", "reopen " + q(b.taskId)),
    "task.delete": (b) => runAgentCommand(ctx, b.__agent, "task", "delete " + q(b.taskId)),
    "task.edit": (b) => runAgentCommand(ctx, b.__agent, "task", "edit " + q(b.taskId) + ' "' + q(b.title) + '"' + (b.desc ? " --desc " + q(b.desc) : "")),
    "task.assign": (b) => runAgentCommand(ctx, b.__agent, "task", "assign " + q(b.taskId) + " " + q(b.ownerName)),
    // 成员（rename 例外：client 直连 sessions.rename RPC，见 client.js）
    "member.restock": (b) => runAgentCommand(ctx, b.__agent, "member", "restock " + q(b.name)),
    "member.archive": (b) => runAgentCommand(ctx, b.__agent, "member", "archive " + q(b.name)),
    "member.restore": (b) => runAgentCommand(ctx, b.__agent, "member", "restore " + q(b.dirName)),
    "member.archiveList": (b) => runAgentCommand(ctx, b.__agent, "member", "archive-list"),
  };
}
function getActionRoutes() {
  if (!cachedAgentRoutes) cachedAgentRoutes = buildActionRoutes(ctxHolder());
  return cachedAgentRoutes;
}

function makeAgentRoute() {
  return (req, res) => {
    let url;
    try { url = new URL(req.url ?? "/", "http://x"); } catch {
      sendJson(res, { ok: false, error: "bad url" }); return;
    }
    const action = url.pathname.replace(/^\/plugins\/dsh-expert-team\/?/, "").split("/").filter(Boolean).join("/");
    const handle = async () => {
      const routes = getActionRoutes();
      const fn = routes[action];
      if (!fn) return { ok: false, error: "unknown route: " + action };
      const body = { ...Object.fromEntries(url.searchParams), ...(req.method === "POST" ? await readBody(req) : {}) };
      const agent = resolveLeadAgent(ctxHolder(), body.leadId);
      if (!agent) return { ok: false, error: "lead agent not found for session " + String(body.leadId ?? "") };
      body.__agent = agent;
      const out = await fn(body);
      return { ok: out?.kind === "success", text: out?.text ?? out?.error ?? String(out) };
    };
    handle().then(
      (value) => sendJson(res, value),
      (err) => sendJson(res, { ok: false, error: err?.message ? String(err.message) : "route failed" }),
    );
  };
}

/** apply 时锁定模块级 ctx（同 MODULE_CTX 语义：cordis 每次 apply 覆盖后 handler 用之）。 */
function ctxHolder() { return MODULE_CTX; }

/** cordis 插件入口。 */
export function apply(ctx) {
  MODULE_CTX = ctx; // handler 需要 ctx（agentTeams/commands 服务）——模块级共享
  // ── slash 指令：/dsh-agent 唯一指令头（kantu 同款，宿主 commands 服务）；
  //    子命令 import/member/task 的 handler 由 createAgentCommand 分发，GUI 浮窗 JSON RPC 直呼同一执行层
  let commandRegistered = false;
  const tryRegisterCommand = (value) => {
    if (commandRegistered) return;
    const commands = value ?? ctx.reflect?.get?.("commands", false);
    if (commands === undefined) return;
    try {
      commands.register(createAgentCommand());
      commandRegistered = true;
      console.log(
        paint(`[${NAME}]`, COL.cyan + COL.bold) +
        " " + paint("🧭 智能体团队插件", COL.yellow) +
        "（模板一键部署 + 团队图谱工作台 + 共享任务生命周期，官方 agentTeams 为执行内核）｜" +
        paint("agent 工具 4 枚", COL.green) + "按 agent scope 安装（部署类 Lead-only）｜" +
        paint("cli · /dsh-agent import|member|task", COL.cyan) + "（唯一指令头）｜" +
        paint("gui · 团队图谱 tab", COL.green) + "（成员环 + 任务瀑布 + 浮窗直连 JSON-RPC = 同一执行层）"
      );
    } catch (e) {
      console.error(paint(`[${NAME}]`, COL.red) + ` slash register failed:`, e?.message ?? e);
    }
  };
  tryRegisterCommand(void 0);
  ctx.on("internal/service", (name) => {
    if (name === "commands") tryRegisterCommand();
  });

  // 去重键用 agent id（agents.list() 每次返回新对象引用，Set<对象> 会失效导致反复安装）
  const installed = new Set();

  const maybeInstall = (agent) => {
    const mid = agent?.id ?? agent?.name;
    if (!mid || installed.has(mid)) return;
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
      installed.add(mid);
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
  rescan();

  // 浮窗直连 JSON RPC（web host 前缀路由，环回 3080；无 webServer 时静默跳过）
  try {
    ctx.effect(() => {
      const ws = ctx.get ? ctx.get("webServer") : ctx.webServer;
      if (ws && typeof ws.register === "function") {
        ws.register({
          kind: "prefix",
          path: "/plugins/dsh-expert-team",
          handler: makeAgentRoute(),
        });
      }
    }, "dsh-expert-team: rpc route");
  } catch (e) {
    console.warn(`[${NAME}] webServer 路由注册跳过：`, e?.message ?? e);
  }
}

export { NAME };
export { createImportCommand, MODULE_CTX as __pluginCtx };
