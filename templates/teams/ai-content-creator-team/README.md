# AI 内容创作专家团（ai-content-creator-team）

> **来源**：WorkBuddy 专家市场 `ai-content-creator-team` 1.0.0（CodeBuddy Teams 出品）。
> 本目录为该包的**本地化副本**，供 dsh-expert-team 模板部署使用（个人自用，非再分发）。
> 头像为包内置生成图；人设/知识为提示词文本。导出自 `~/.workbuddy-ai/plugins/cache/experts/ai-content-creator-team/1.0.0/`（2026-10-12）。

AI 驱动的多模态内容生产团队（6 人 + 主理人），覆盖从创意策划到成品交付的端到端能力：

- **创意策划**：品牌定位、情绪板/视觉方向、广告创意方向、场景构思、镜头设计、Logo 概念（策凌）
- **文案创作**：公众号/知乎长文、小红书/社媒短文案、视频脚本、营销文案（笔澜）
- **视频生成**：文生视频/图生视频，HY-Video-1.5、YT-Video-2.0、YT-Video-HumanActor、YT-Video-FX（维欧）
- **图文创作**：7 种场景策略、20 变体矩阵批量生成、发布级精修（珀西）
- **智能编辑**：Track 结构编辑（5 元素 + 11 滤镜），裁剪/拼接/转场/字幕/去水印（柯立）
- **素材改编**：视频翻译（声纹克隆+唇型同步）、精彩片段提取、多媒体合成（艾达）

## 目录

| 路径 | 内容 |
|---|---|
| `team.json` | 团队定义（sop / lead.prompt / members / prompts / skills） |
| `team-agent.md` | 主理人完整人设（创意制片人司远，26.7KB 原稿） |
| `avatars/` | 8 张 512×512 头像（team + 7 成员） |
| `../../members/*/agent.md` | 6 位成员的人设原稿（去 frontmatter） |
| `../../skills/ai-content-production/` | 技能包：SKILL.md + 6 份参考知识文档（策略/视频/图片/精修/编辑/改编） |

## 使用示例（quickPrompts）

- 帮我确定新产品的品牌视觉方向，做一个情绪板
- 帮我用 AI 生成一段 15 秒的产品宣传短视频
- 为我的新品上市生成一组小红书风格的种草图文，包含配图和文案
