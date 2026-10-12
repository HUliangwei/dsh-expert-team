/**
 * dsh-expert-team — 模板发现与解析
 *
 * 规范目录（DSH_EXPERT_TEAM_TEMPLATES 可覆盖，默认 <包根>/templates）：
 *   templates/
 *   ├── members/<name>/          成员模板（与 teams 同级）
 *   │   ├── member.json          { name, displayName, profession, description, maxTurns?, skills?, provider? }
 *   │   └── agent.md             提示词正文（成员人设/方法论/输出规范）
 *   └── teams/<name>/            专家团模板（与 members 同级）
 *       ├── team.json            { name, displayName, description, sop?, lead?, members[] }
 *       └── README.md            （可选说明）
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = fileURLToPath(new URL("..", import.meta.url));
export const TEMPLATES_ROOT = process.env.DSH_EXPERT_TEAM_TEMPLATES
  ? String(process.env.DSH_EXPERT_TEAM_TEMPLATES)
  : join(PKG_DIR, "templates");
export const MEMBERS_DIR = join(TEMPLATES_ROOT, "members");
export const TEAMS_DIR = join(TEMPLATES_ROOT, "teams");

const KEBAB = /^[a-z][a-z0-9-]*$/;
const DISPLAY_RE = /^[A-Za-z\u4e00-\u9fa5][A-Za-z0-9\u4e00-\u9fa5·_\- ]{0,40}$/;

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function subdirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && KEBAB.test(d.name))
    .map((d) => d.name)
    .sort();
}

/** 罗列所有成员模板名（按字母序）。 */
export function listMemberNames() {
  return subdirs(MEMBERS_DIR);
}

/** 罗列所有专家团模板名（按字母序）。 */
export function listTeamNames() {
  return subdirs(TEAMS_DIR);
}

/** 读取一个成员模板；不合法返回 null。 */
export function getMember(name) {
  if (!KEBAB.test(String(name))) return null;
  const dir = join(MEMBERS_DIR, name);
  if (!existsSync(dir)) return null;
  const meta = readJson(join(dir, "member.json"));
  const mdPath = join(dir, "agent.md");
  if (!meta || !existsSync(mdPath)) return null;
  const prompt = readFileSync(mdPath, "utf8").trim();
  if (!prompt) return null;
  return {
    name,
    dir,
    displayName: meta.displayName ?? { en: name, zh: name },
    profession: meta.profession ?? { en: "Member", zh: "成员" },
    description: meta.description ?? "",
    maxTurns: meta.maxTurns,
    skills: Array.isArray(meta.skills) ? meta.skills : [],
    provider: meta.provider,
    model: meta.model,
    prompt,
  };
}

/** 成员模板的列表视图（不含正文）。 */
export function listMembers() {
  return listMemberNames().map((n) => {
    const m = getMember(n);
    if (!m) return null;
    return {
      name: m.name,
      displayName: m.displayName,
      profession: m.profession,
      description: m.description,
      skills: m.skills,
    };
  }).filter(Boolean);
}

/** 读取一个专家团模板；不合法返回 null。 */
export function getTeam(name) {
  if (!KEBAB.test(String(name))) return null;
  const dir = join(TEAMS_DIR, name);
  if (!existsSync(dir)) return null;
  const meta = readJson(join(dir, "team.json"));
  if (!meta) return null;
  return {
    name,
    dir,
    displayName: meta.displayName ?? { en: name, zh: name },
    description: meta.description ?? "",
    sop: meta.sop ?? "",
    lead: meta.lead ?? {},
    members: Array.isArray(meta.members) ? meta.members : [],
  };
}

/** 专家团模板的列表视图。 */
export function listTeams() {
  return listTeamNames().map((n) => {
    const t = getTeam(n);
    if (!t) return null;
    return {
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      leadTemplate: t.lead?.template ?? null,
      memberCount: t.members.length,
      memberTemplates: t.members.map((m) => m.template),
    };
  }).filter(Boolean);
}

export function validateDisplayName(v) {
  const zh = v?.zh;
  if (typeof zh !== "string" || !DISPLAY_RE.test(zh.trim())) {
    return "displayName.zh 必须是 1–40 字的中英文显示名";
  }
  return null;
}
