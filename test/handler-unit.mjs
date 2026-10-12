// Round 28d 单元验证：/expert-import handler 直接 spawn（不依赖模型）。
// 用 fake agentTeams 服务驱动 createImportCommand，验证：解析、参数映射（ctx→provider）、
// 成员/团队两条 spawn 路径、错误分支。
// 用法：node test/handler-unit.mjs
import { createImportCommand } from "../lib/index.js";

const spawnLog = [];
const fakeTeams = {
  membership: () => ({ name: "test-lead", role: "lead" }),
  async spawnTeammate(agent, req) {
    spawnLog.push({ agent: agent && agent.id, name: req.name, provider: req.provider, context: req.context, model: req.model, hasPrompt: Array.isArray(req.prompt) && req.prompt.length > 0 });
    return { member: { name: req.name } };
  },
};
const fakeCtx = {
  reflect: { get: (n) => (n === "agentTeams" ? fakeTeams : undefined) },
};

const cases = [
  ["/expert-import content-adapter --ctx fresh", "content-adapter", "spawn"],
  ["/expert-import narrative-designer --ctx fork", "narrative-designer", "fork"],
  ["/expert-import trading-team --ctx fresh --model follow", "trading-team-lead", "spawn"],
  ["/expert-import content-adapter", "content-adapter", "spawn"],
];
let ok = 0;
for (const [raw, expectLeadName, expectProvider] of cases) {
  const cmd = createImportCommand(fakeCtx);
  const r = await cmd.handler({ rawInput: raw, agent: { id: "lead-1" }, signal: undefined });
  if (r.kind !== "success") throw new Error("FAIL " + raw + " -> " + r.text);
  ok++;
}
const membersOnly = spawnLog.filter((s) => s.name !== "trading-team-lead" && s.name.startsWith("trading-team-"));
if (membersOnly.length === 0) throw new Error("team path did not spawn members");
const single = spawnLog.find((s) => s.name === "content-adapter");
if (!single) throw new Error("member path missing");
if (spawnLog[0].provider !== "spawn" || spawnLog[1].provider !== "fork") throw new Error("ctx->provider mapping wrong: " + JSON.stringify(spawnLog.slice(0, 2)));
if (spawnLog[0].context !== "fresh" || spawnLog[1].context !== "fork") throw new Error("context mapping wrong");
if (!single.hasPrompt) throw new Error("member prompt missing");

// 错误分支
const err1 = await createImportCommand(fakeCtx).handler({ rawInput: "", agent: { id: "x" } });
if (err1.kind !== "error") throw new Error("empty raw should error");
const err2 = await createImportCommand(fakeCtx).handler({ rawInput: "/expert-import no-such-template", agent: { id: "x" } });
if (err2.kind !== "error") throw new Error("unknown template should error");
const err3 = await createImportCommand(fakeCtx).handler({ rawInput: "/expert-import a --ctx bogus", agent: { id: "x" } });
if (err3.kind !== "error") throw new Error("bad ctx should error");

// 无 agent / 无服务 → 退回旧链路（success 文本里含 expert_member_deploy）
const fallback = await createImportCommand(fakeCtx).handler({ rawInput: "/expert-import content-adapter" });
if (fallback.kind !== "success" || !fallback.text.includes("expert_member_deploy")) throw new Error("fallback broken: " + fallback.text);
// 无 agent（invocation.agent 缺失）也应退回旧链路
const fallback2 = await createImportCommand(fakeCtx).handler({ rawInput: "/expert-import content-adapter --ctx fork" });
if (fallback2.kind !== "success" || !fallback2.text.includes("context=fork")) throw new Error("fallback2 broken: " + fallback2.text);

console.log(JSON.stringify({
  unit: true,
  ok,
  spawnLog: spawnLog.map((s) => ({ name: s.name, provider: s.provider, context: s.context, model: s.model })),
  teamSpawnCount: spawnLog.filter((s) => s.name.startsWith("trading-team")).length,
}, null, 1));
