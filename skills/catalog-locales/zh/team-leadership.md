使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# 团队领导力

## 概述

管理团队并不是告诉人们该做什么。它是关于明确定义期望的结果，减少合作的摩擦，并创建使成功成为默认路径的结构。

这项技能涵盖了个人 MBA 中最具可操作性的领导框架：指挥官意图、沟通开销、黄金三连胜、赢得尊重、强制职能和旁观者冷漠。

## 使用说明

当用户询问团队管理、改进协作、设定目标、召开会议或建立问责制时，请应用这些框架。

### 框架 1：指挥官的意图

**定义：** 定义所需的最终状态并让团队弄清楚如何到达那里。

军方发明了这个概念，因为作战计划在与敌人第一次接触时就崩溃了。指挥官传达的意图不是立即过时的详细分步命令，而是：“我们需要在黎明前控制那座桥。根据你的判断来决定如何到达那里。”

**指挥官意图的格式：**
```
SITUATION: [What's happening and why this matters]
INTENT: [The end state we need to achieve]
SUCCESS LOOKS LIKE: [Measurable criteria — how we know we're done]
CONSTRAINTS: [What we must NOT do / non-negotiables]
RESOURCES: [What the team has available]
TIMELINE: [When this needs to be done]
```

**产品发布示例：**
```
SITUATION: We're launching the new pricing page next week. Current page converts
at 2.1%. Marketing has already scheduled campaigns driving 50k visits.

INTENT: Maximize trial signups from the pricing page during launch week.

SUCCESS LOOKS LIKE:
  - Trial signup rate > 4% (almost double the current 2.1%)
  - Page load time < 2 seconds
  - Zero broken payment flows
  - All 3 plans clearly differentiated

CONSTRAINTS:
  - Don't change actual prices (already approved by leadership)
  - Don't remove the enterprise "Contact Us" option
  - Must be mobile-responsive

RESOURCES: 2 frontend devs, 1 designer, access to A/B testing tool

TIMELINE: Live by Monday 9 AM EST. Test on staging by Friday.
```

**为什么这样做：** 团队拥有完整的背景（为什么）、明确的成功标准（什么）、明确的界限（不是什么）和自主权（如何）。他们会做出比你微观管理更好的决策，因为他们更接近实施细节。

### 框架 2：通信开销

**定义：** 通信开销按照公式 n × (n-1) / 2 增长，其中 n 是团队规模。

| 团队规模 | 沟通渠道 | 复杂性 |
|-----------|----------------------|------------|
| 3 | 3 | 可管理 |
| 5 | 10 | 变得复杂 |
| 8 | 28 | 大量开销 |
| 12 | 66 | 遇见地狱 |
| 20 | 190 | 官僚主义瘫痪 |

**这就是为什么添加人员会减慢团队速度。** 每个新人都会为每个现有人员添加频道。

**减少通信开销：**

1. **小团队** - 亚马逊的“两个披萨规则”（杰夫·贝索斯：团队不能超过两个披萨）。该规则没有规定人数； 5-8人是常见的阅读量，工作允许的情况下3-5人更好。

2. **默认异步** — 大多数通信不需要实时。
   - 使用：书面文档、Slack 线程、Loom 视频、带评论的 PR
   - 预留同步（会议）用于：需要辩论的决策、建立关系、解决复杂的问题

3. **减少会议数量和规模：**
   - 每次会议都需要：议程、负责人、时间限制、记录在案的决定
   - 决策会议最多 5 人。其他人得到笔记。
   - 取消每季度召开的定期会议。仅重新添加人们错过的内容。
   - 站立会议的时间不得超过 15 分钟，除非是研讨会。

4. **单一事实来源** — 一处用于项目状态、一处用于决策、一处用于规范。当信息存在于 5 个 Slack 频道和 3 个文档中时，人们花在搜索上的时间比工作的时间还要多。

5. **通讯协议：**
   ```
   Urgent + important:    Call or direct message with "URGENT:" prefix
   Important, not urgent:  Email or Slack thread (24-hour response expectation)
   FYI / async update:    Doc update or async standup
   Discussion needed:      Schedule a 15-min meeting with agenda
   ```

### 框架 3：黄金三连胜

**定义：** 每个健康的团队互动都建立在三件事之上：
1. **欣赏** — 真诚地感谢人们的贡献
2. **礼貌** — 始终以基本的尊重对待他人
3. **尊重**——重视他们的专业知识和自主权

**这听起来很明显。事实并非如此。** 在压力下，领导者：
- 跳过欣赏（“我们没有时间拍拍背”）
- 放弃礼貌（“只要解决它，我不在乎如何”）
- 破坏尊重（“让我自己做吧”）

**实际应用：**
- 每次一对一从该人做得好的具体事情开始。不是“干得好”——“你构建数据库迁移计划的方式为我们节省了一周的工作时间。”
- 在公开场合（团队频道）说“谢谢”，在私下（DM 或 1:1）提供建设性反馈。
- 当你不同意时，说“帮助我理解你的推理”而不是“那是错误的”。
- 永远不要将团队合作归功于自己。始终归因于：“莎拉对 X 的想法导致了 Y 结果。”

### 框架 4：赢得尊重

**定义：** 尊重和影响力是通过表现出的能力而不是头衔或权威来赢得的。

**两种类型的尊重：**
1. **基于能力** — “他们真的很擅长自己所做的事情”
2. **基于性格**——“他们总是言出必行”

**领导者如何赢得尊重：**
- **兑现承诺。**说出你要做什么，然后去做。每次。失去团队最快的方式就是违背承诺。
- **胜任团队所重视的事情。**您不需要成为最好的工程师，但您需要了解什么是优秀的工程师。
- **保护团队。** 保护他们免受组织政治、不合理要求和范围蔓延的影响。他们会注意到的。
- **公开承认错误。** “我对 X 做出了错误的决定。这是我学到的。这是我们将采取的不同做法。”这比从不犯错更能建立信任。

### 框架 5：强制函数

**定义：** 强制采取行动的结构，消除了拖延或避免的选择。

**强制功能示例：**

1. **公开演示** — 安排周五下午 3 点进行演示。该团队将在周四晚上之前发货。没有安排演示吗？ “我们会在准备好后发货”（从不）。

2. **具有后果的截止日期** —“该活动将于 3 月 1 日启动，无论是否有新功能。”具有外部依赖性的实际截止日期比内部依赖性更强大。

3. **“交付或终止”会议** — 每月审查：每个项目要么显示出可衡量的进展，要么被终止。不允许僵尸项目。

4. **站立签到** — “你昨天完成了什么？今天你会完成什么？”强调“完成”，而不是“努力完成”。

5. **事前剖析** — 在开始一个项目之前：“想象一下，从现在开始 3 个月后，这个项目失败了。为什么？”迫使团队提前考虑风险。

6. **预算限制** — “你有 5,000 美元和 2 周的时间。”限制孕育创造力。无限的资源会滋生膨胀。

**为什么强制功能有效：** 它们用结构（可靠）代替动机（不可靠）。您不需要团队想要按时发货——您需要一个使发货成为默认结果的系统。

### 框架 6：旁观者冷漠

**定义：** 当责任没有分配给特定的人时，就没有人采取行动。 “有人应该解决这个问题”意味着没有人会解决这个问题。

**规则：每项任务都需要一个所有者。**

不是一个团队，不是一个渠道，也不是“谁能接触到它”。一个人的名字与一种结果相关。

**不好：**
```
Action items:
  - Improve onboarding flow
  - Fix the billing bug
  - Update the docs
```

**好：**
```
Action items:
  - Sarah: Improve onboarding flow → new design by Wed
  - Marcus: Fix billing bug → PR merged by Thursday
  - Priya: Update API docs for v2 → published by Friday EOD
```

**在会议中：** 每次会议结束时都会问：“谁拥有这个？什么时候？”如果答案不明确，会议就浪费了。

## 示例

### 示例 1：为迁移项目编写 Commander 意图

**用户请求：**“我们需要从 Heroku 迁移到 AWS。我如何将此信息传达给我的 4 人团队？”

**输出：**
```
Commander's Intent: Heroku → AWS Migration

SITUATION:
Our Heroku costs have grown to $4,200/month. Equivalent AWS infrastructure
is estimated at $1,100/month. We also need auto-scaling for traffic spikes
that Heroku can't handle well. This migration is our Q2 priority.

INTENT:
Move our entire production stack from Heroku to AWS with zero customer
downtime and no data loss.

SUCCESS LOOKS LIKE:
  - All services running on AWS with health checks green
  - Response time equal or better than Heroku baseline (p95 < 200ms)
  - Zero customer-visible downtime during migration
  - Monthly infrastructure cost < $1,500
  - CI/CD pipeline deploys to AWS automatically
  - Rollback plan tested and documented

CONSTRAINTS:
  - No customer downtime (use blue-green deployment)
  - Don't change the API contracts — clients shouldn't notice
  - Keep Heroku running in parallel for 2 weeks post-migration (safety net)
  - Don't optimize infrastructure yet — mirror current setup first, optimize later

RESOURCES:
  - 4 engineers (full-time for 3 weeks)
  - $2,500 budget for parallel running costs (two weeks of Heroku is about $2,100)
  - AWS credits: $5,000 available

TIMELINE:
  - Week 1: Staging environment on AWS, all services running
  - Week 2: Data migration strategy tested, blue-green deployment ready
  - Week 3: Production cutover (Wednesday, lowest traffic day)
  - Week 4-5: Monitoring period, Heroku decommission

OWNER: Dana Whitfield (lead engineer), decides go/no-go for the Wednesday cutover
```

### 示例 2：减少不断壮大的团队的会议费用

**用户请求：**“我的团队从 5 人增加到 12 人。我们现在每天花 3 个多小时开会，但什么也没做。”

**输出：**
```
Meeting Overhead Diagnosis:

  Problem: Communication channels went from 10 (5 people) to 66 (12 people).
  6.6x more channels but probably only 2.4x more meetings — meaning those
  meetings are larger, longer, and less productive.

  Immediate Actions (implement this week):

  1. SPLIT INTO SUB-TEAMS
     - 2 teams of 5-6 with clear ownership areas
     - Each team has their own standup, their own planning
     - Cross-team sync: 1 meeting per week, 30 min, leads only

  2. AUDIT ALL RECURRING MEETINGS
     For each meeting, ask: "If we cancel this forever, what breaks?"
     If the answer is "nothing" or "we'd just use Slack" — cancel it.

     Likely survivors:
       - Team standup: 15 min, per sub-team, async option available
       - Sprint planning: 1 hr, bi-weekly
       - Cross-team sync: 30 min, weekly, leads only
       - 1:1s: 30 min, weekly (don't cut these)

     Likely cuts:
       - All-hands standup with 12 people (replace with async update)
       - "Sync" meetings that are actually status updates (use a doc)
       - Meetings without an agenda (no agenda = no meeting)

  3. MEETING RULES
     - Max 5 people in any decision meeting. Others get notes.
     - Every meeting has a written agenda shared 1 hour before.
     - Meetings end with: action items, owners, deadlines — written down.
     - Default meeting: 25 min (not 30). Default longer meeting: 50 min (not 60).
     - No-meeting mornings (8 AM - 12 PM): deep work time.

  Expected result: 3+ hrs/day → ~1.5 hrs/day of meetings.
  That's 7.5 extra hours of productive work per person per week.
  For 12 people: 90 hours/week reclaimed.
```

## 指南

- 指挥官的意图应始终包括约束（不该做什么）。没有边界的自治是混乱的。
- 在讨论通信开销时，请始终计算实际的通道数 (n×(n-1)/2)，以使问题具体化。
- 强制功能应该感觉自然，而不是惩罚性的。当范围合适时，公开演示是令人兴奋的，而不是有压力的。
- 每个行动项目都需要一个所有者和一个截止日期。 “团队会处理它”意味着没有人会处理它。
- 黄金三连音听起来很柔和，但练习起来很便宜，而且在压力下很容易跳过。人们常常会因为不欣赏、不尊重、不礼貌而离开经理。
- 更喜欢异步通信来共享信息。为决策和辩论保留同步（会议）。
