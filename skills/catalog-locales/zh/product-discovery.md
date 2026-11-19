使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# 产品发现——从假设到证据


## 概述


产品发现，是根据证据而不是意见来决定构建什么的持续过程。帮助产品团队确定假设、设计实验、进行用户访谈、构建机会解决方案树，并确定下一步要验证的优先级 - 遵循 Teresa Torres（持续发现习惯）和 Alberto Savoia（The Right It）的框架。


## 使用说明

### 机会解决方案树

```markdown
## Build an Opportunity Solution Tree (OST)

An OST connects a desired outcome to the opportunities, solutions, and experiments
that could achieve it. It prevents solution-first thinking by forcing you to
map the problem space before jumping to features.

### Step 1: Define the Desired Outcome
Start with a measurable business or product outcome:
- "Increase 7-day retention from 35% to 50%"
- "Reduce time-to-first-value from 15 min to 3 min"
- "Increase monthly expansion revenue by 20%"

### Step 2: Map Opportunities
Opportunities are unmet needs, pain points, or desires discovered through research.
They are NOT solutions.

❌ Bad opportunity: "Add onboarding wizard" (this is a solution)
✅ Good opportunity: "New users don't understand the core value in the first session"

Interview questions to discover opportunities:
- "Walk me through the last time you [did the thing]. What was hardest?"
- "What workarounds have you built?"
- "If you could wave a magic wand, what would change?"

### Step 3: Generate Solutions per Opportunity
For each opportunity, brainstorm multiple solutions (minimum 3).
Avoid anchoring on the first idea.

Opportunity: "Users don't understand core value in first session"
  → Solution A: Interactive product tour
  → Solution B: Template gallery with pre-built examples
  → Solution C: AI-assisted setup that auto-configures based on use case
  → Solution D: 2-minute video showing "aha moment" before signup

### Step 4: Design Assumption Tests
For each solution, identify the riskiest assumption and design
the cheapest experiment to test it.

Solution: "AI-assisted setup"
  Riskiest assumption: "Users will trust AI to configure their workspace"
  Experiment: Wizard of Oz — show AI suggestions but have a human generate them
  Success metric: a threshold you fix before the test (the 60% acceptance figure
  here is an illustrative heuristic, not a benchmark)
  Duration: 1 week, 50 users (illustrative sizing)
```

### 假设映射

```markdown
## Map and Prioritize Assumptions

Every product idea is a bundle of assumptions. Most teams build the whole thing
and discover which assumptions were wrong after launch. Discovery teams test
assumptions before building.

### Assumption Categories

**Desirability** (Do people want this?)
- Users have this problem frequently enough to pay for a solution
- The problem is painful enough that users will switch from their current solution
- Users are willing to change their workflow

**Viability** (Can the business sustain this?)
- We can acquire users at a CAC below $X
- Users will pay $Y/month for this
- This will generate enough revenue to justify development cost

**Feasibility** (Can we build this?)
- We can build this in <X weeks with current team
- The technology exists to do this at the required scale
- We can integrate with the required third-party APIs

**Usability** (Can people use this?)
- Users can complete the core workflow without training
- Users understand the terminology and interface
- Users can set up the product in <10 minutes

### Prioritize: Risk × Impact Matrix

Plot each assumption on a 2×2 matrix:
- X-axis: How confident are we? (high confidence → low risk)
- Y-axis: How critical is this? (if wrong, does the whole idea fail?)

Test the HIGH RISK + HIGH IMPACT assumptions first.
Don't waste time validating things you're already confident about.
```

### 实验设计

```markdown
## Design Experiments (Cheapest Test First)

### Experiment Ladder (from cheapest to most expensive)

The time and cost figures and the success thresholds below are rough
heuristics from common practice, not sourced benchmarks. Set your own
thresholds before each test.

1. **Desk Research** (hours, $0)
   Search for existing data: analytics, support tickets, competitor reviews
   "Do users actually complain about this? What do Intercom tickets say?"

2. **One-Question Survey** (1 day, $0)
   Ask existing users a single question via in-app prompt
   "How do you currently handle [problem]?"

3. **Smoke Test / Fake Door** (2-3 days, $0)
   Add a button/link for the feature. Track clicks. Don't build the feature.
   Success: a click-through threshold set before launch (heuristic)

4. **Landing Page Test** (3-5 days, ~$200 ads)
   Build a landing page describing the solution. Drive traffic. Measure signups.
   Success: a visitor-to-signup threshold set before launch (heuristic)

5. **Wizard of Oz** (1-2 weeks, $0)
   Deliver the experience manually behind the scenes. Users think it's automated.
   Test: "Will users actually use this if it exists?"

6. **Concierge MVP** (2-4 weeks, $0)
   Deliver the service manually, one customer at a time.
   Learn the workflow deeply before automating.

7. **Prototype Test** (1-2 weeks)
   Build a clickable prototype (Figma). Test with 5 users.
   Measure: task completion rate, time-on-task, confusion points

8. **Feature Flag MVP** (2-4 weeks)
   Build the simplest version. Release to 5% of users. Compare metrics.
   This is the first time you write production code.

### Experiment Brief Template

**Hypothesis**: We believe [solution] will [outcome] for [users]
**Riskiest assumption**: [what must be true for this to work]
**Experiment type**: [from the ladder above]
**Success metric**: [specific, measurable threshold]
**Sample size**: [how many users/responses needed]
**Duration**: [time to run the experiment]
**Decision**: If success → [next step]. If fail → [pivot/kill/iterate]
```

### 用户访谈指南

```markdown
## Conduct Discovery Interviews

### Rules
1. Ask about past behavior, not future intentions
   ❌ "Would you use a feature that..."
   ✅ "Tell me about the last time you..."

2. Ask open questions, not leading ones
   ❌ "Don't you think it would be better if..."
   ✅ "How do you handle that today?"

3. Listen for workarounds — they reveal unmet needs
   "I export to Excel and then manually..." = opportunity

4. Get specific stories, not generalizations
   ❌ "Do you usually..."
   ✅ "Walk me through the most recent time you..."

### Interview Script Template

**Opening (2 min)**
"Thanks for joining. I'm researching how people [context]. There are no right
or wrong answers — I'm here to learn from your experience."

**Context (5 min)**
"Tell me about your role. How does [topic] fit into your day-to-day?"
"How often do you [activity]?"

**Story Mining (15 min)**
"Walk me through the last time you [did the thing]."
"What happened next?"
"What was the hardest part?"
"How did you work around that?"
"How much time did that take?"

**Pain Discovery (5 min)**
"If you could change one thing about this process, what would it be?"
"Have you tried any other tools/approaches? What happened?"

**Closing (3 min)**
"Is there anything I should have asked but didn't?"
"Would you be open to trying a prototype if we build something?"

### After the Interview
- Summarize within 1 hour (memory fades fast)
- Extract: opportunities, quotes, workarounds, emotional moments
- Tag by theme
- Every 3-4 interviews: revisit the opportunity space and refine the OST
  (Torres, producttalk.org: revisit the opportunity space every three to four
  customer interviews)
```

### 持续发现节奏

```markdown
## Weekly Discovery Rhythm

**Monday**: Review last week's experiment results. Update OST.
**Tuesday-Wednesday**: Conduct customer interviews (30 min each). Teresa Torres
recommends interviewing continuously, week over week; the 2-3 per week count
is a heuristic.
**Thursday**: Synthesize interviews. Identify new opportunities.
**Friday**: Design next experiment. Write experiment brief.

### Quarterly Review
- How many assumptions did we test? (a team target you choose; no source benchmark)
- What did we learn that changed our roadmap?
- Which opportunities are validated vs invalidated?
- Update the OST with new evidence.
```


## 示例


### 示例 1：为新产品构建机会解决方案树

**用户请求：**

```
We're launching a project management tool for remote design teams. Our outcome is 4-week retention of design leads going from 30% to 40%. Help me build an opportunity solution tree.
```

代理首先询问存在哪些设计主管访谈，然后将树写入嵌套列表：根部的结果，从访谈故事中提取的三个或更多机会（例如“设计主管在每个冲刺中手动将框架重新导出到移交工具中”），以及每个机会下至少三个解决方案。每个解决方案都以最危险的假设和最便宜的测试结束。输出是团队每周可以编辑的单个 Markdown 文件。

### 示例 2：设计实验来检验假设

**用户请求：**

```
We assume enterprise teams will pay $200/month for our reporting feature. Design experiments to validate this before we build it.
```

代理将支付意愿假设命名为高风险和高影响，然后在任何构建之前在报告页面上提出假门测试（计算“请求报告访问”按钮的点击次数并收集价格意图问题）。它使用上面的模板编写实验简介，其中包含团队预先设置的成功阈值以及每个结果的决策规则。 200 美元的价格是测试中的假设，而不是基准。


## 指南

1. **每周与用户交谈** — 持续发现意味着每周持续接触（Teresa Torres，producttalk.org）
2. **测试假设，而不是想法** — 将每个想法分解为假设；首先用最便宜的实验来测试风险最大的
3. **机会解决方案树** — 映射结果 → 机会 → 解决方案 → 实验；它阻碍了解决方案优先的思维
4. **首先进行最便宜的测试** — 在构建原型之前从案头研究和调查开始；大多数假设无需代码即可测试
5. **比较，不要问** — 向用户展示替代方案，而不是问“你会使用这个吗？”；行为比意见更能揭示偏好
6. **时间盒实验** - 每个实验都有一个截止日期和在开始前定义的成功指标；没有开放式的探索
7. **快速扼杀创意**——如果最危险的假设失败，就扼杀这个创意；不要将沉没成本合理化
8. **记录一切** — 记录采访、标记引言、跟踪实验结果；您的发现日志是每个产品决策的证据基础
