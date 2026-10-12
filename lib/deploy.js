/**
 * dsh-expert-team — 部署计划：把成员模板 / 专家团模板翻译成 Agent Teams 的 spawn 请求。
 *
 * 每个部署 item 产出 spawnTeammate 所需字段：
 *   { name, description, prompt: [{type:"text",...}], context, provider?, signal? }
 *
 * 命名规则（roster 名字永久、不可复用，因此一律带前缀防冲突）：
 *   - 单成员部署：默认用模板名，可用 --name 覆盖（仍须全局唯一，冲突由服务层报错）
 *   - 专家团部署：主理人 = "{team}-lead"，成员 = "{team}-{member}"
 */
import { getMember, getTeam } from "./templates.js";

const IDENTITY_REMINDER = (name) =>
  `<system-reminder>
You are teammate "${name}".
Your Team Lead is named "lead".
Use list_agents({}) to find your teammates and their names.
To message your Team Lead, use send_message({ target: "lead", message: "..." }).
To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).
</system-reminder>

`;

/** 默认团队协作铁律（WorkBuddy 专家团同款纪律，可被 team.json 的 sop 追加/覆盖）。 */
export const DEFAULT_SOP = `团队协作铁律（主理人必须遵守）：
1. 建团：成员已在部署阶段创建完毕，你负责调度，严禁自行 spawn 任何人。
2. 调度：按阶段把任务拆解并分派给最合适的成员（send_message 派活 + team_task_* 记任务）。
3. 中转：跨成员的信息流必须经你中转；成员之间不直接交换上下文。
4. 采信：每个专业产出以对应成员结论为准，你只做编排、追问与汇编，不得代成员作答。
5. 严禁：跳过阶段、催进度但不给输入、把部分产出当作最终交付。
6. 验收：收齐所有成员产出并核对后，整合成完整交付答复给 Lead（用户）。`;

function blocks(...texts) {
  return texts.filter((t) => t && t.trim()).map((t) => ({ type: "text", text: t }));
}

function describeMember(m) {
  const prof = m.profession?.zh ?? m.profession?.en ?? m.name;
  return prof + (m.description ? `：${m.description}` : "");
}

/** 单个成员模板 → spawn 请求。 */
export function buildMemberRequest(memberName, { asName, description } = {}) {
  const m = getMember(memberName);
  if (!m) throw new Error(`成员模板不存在或损坏: ${memberName}（需 member.json + agent.md）`);
  const name = asName && /^[a-z][a-z0-9-]*$/.test(asName) ? asName : m.name;
  const skills = m.skills.length ? `\n\n预加载技能：${m.skills.join("、")}（如会话内有对应技能请直接加载使用）` : "";
  const prompt = blocks(
    IDENTITY_REMINDER(name),
    `你是一位「${m.profession.zh ?? m.profession.en}」。`,
    m.prompt,
    skills,
    "所有产出直接通过 send_message 发回给 lead。",
  );
  return {
    name,
    description: description ?? `${m.profession.zh ?? m.profession.en}（来自成员模板 ${memberName}）`,
    prompt,
    context: "fresh",
    provider: m.provider ?? "spawn",
  };
}

/**
 * 专家团模板 → 部署计划（先主理人后成员）。
 * @param {string} teamName 模板名
 * @param {{prefix?: string}} [opts] prefix 覆盖默认团队名前缀
 */
export function buildTeamPlan(teamName, opts = {}) {
  const team = getTeam(teamName);
  if (!team) throw new Error(`专家团模板不存在或损坏: ${teamName}`);
  if (!team.members.length) throw new Error(`专家团模板缺少成员: ${teamName}（team.json.members 为空）`);

  const prefix = opts.prefix ? String(opts.prefix) : team.name;
  const leadName = `${prefix}-lead`;

  // 主理人：优先 lead.prompt 内联；其次 lead.template 成员模板；最后默认文案
  const leadTemplate = team.lead?.template ? getMember(team.lead.template) : null;
  const leadDoc =
    team.lead?.prompt && String(team.lead.prompt).trim() ? String(team.lead.prompt).trim() : leadTemplate?.prompt;
  const leadProfession = team.lead?.profession ?? leadTemplate?.profession ??
    { en: "Team Lead", zh: "主理人" };

  // 成员清单：name（spawn 用，默认模板名）+ template 引用
  const rosterLines = [team.displayName?.zh ?? team.name].concat(
    team.members.map((mr) => {
      const t = getMember(mr.template);
      if (!t) throw new Error(`专家团 ${teamName} 引用了不存在的成员模板: ${mr.template}`);
      return `- ${mr.name ?? t.name}：${t.profession.zh ?? t.profession.en}${t.description ? `（${t.description}）` : ""}`;
    }),
  ).join("\n");

  const leadPrompt = blocks(
    IDENTITY_REMINDER(leadName),
    `你是专家团「${team.displayName?.zh ?? team.name}」的主理人（Team Lead）。`,
    team.description ? `团队定位：${team.description}` : "",
    `团队成员（部署完成，各自独立会话）：\n${rosterLines}`,
    leadDoc,
    team.sop && team.sop.trim() ? `\n本团队专属协作流程（SOP）：\n${team.sop.trim()}` : "",
    DEFAULT_SOP,
    "你的最终成果：对用户任务的完整交付（整合所有成员产出）。",
  );

  const leadRequest = {
    name: leadName,
    description: `${team.displayName?.zh ?? team.name} 主理人${leadProfession.zh ? `（${leadProfession.zh}）` : ""}`,
    prompt: leadPrompt,
    context: "fresh",
    provider: team.lead?.provider ?? leadTemplate?.provider ?? "spawn",
  };

  const memberRequests = team.members.map((mr) => {
    const t = getMember(mr.template);
    const req = buildMemberRequest(mr.template, {
      asName: `${prefix}-${mr.name ?? t.name}`,
      description: `${prefix}-${t.name}（${t.profession.zh ?? t.profession.en}）`,
    });
    if (mr.prompt && String(mr.prompt).trim()) {
      req.prompt = blocks(IDENTITY_REMINDER(req.name), `你是「${t.profession.zh ?? t.profession.en}」。`, String(mr.prompt).trim());
    } else {
      req.prompt = blocks(
        IDENTITY_REMINDER(req.name),
        `你是专家团「${team.displayName?.zh ?? team.name}」的成员，担任「${t.profession.zh ?? t.profession.en}」。`,
        t.prompt,
        t.skills.length ? `预加载技能：${t.skills.join("、")}` : "",
        "你的产出经 send_message 发回给 lead（主理人），再由主理人整合。",
      );
    }
    return req;
  });

  return {
    team: team.name,
    lead: leadRequest,
    members: memberRequests,
  };
}
