使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# 產品發現－從假設到證據


## 概述


產品發現，是根據證據而不是意見來決定建構什麼的持續過程。幫助產品團隊確定假設、設計實驗、進行使用者訪談、建立機會解決方案樹，並確定下一步要驗證的優先順序 - 遵循 Teresa Torres（持續發現習慣）和 Alberto Savoia（The Right It）的框架。


## 使用說明

### 機會解決方案樹

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

### 假設映射

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

### 實驗設計

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

### 使用者訪談指南

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

### 持續發現節奏

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


## 範例


### 範例 1：為新產品建立機會解決方案樹

**使用者請求：**

```
We're launching a project management tool for remote design teams. Our outcome is 4-week retention of design leads going from 30% to 40%. Help me build an opportunity solution tree.
```

代理人首先詢問存在哪些設計主管訪談，然後將樹寫入嵌套列表：根部的結果，從訪談故事中提取的三個或更多機會（例如“設計主管在每個衝刺中手動將框架重新導出到移交工具中”），以及每個機會下至少三個解決方案。每個解決方案都以最危險的假設和最便宜的測試結束。輸出是團隊每周可以編輯的單一 Markdown 文件。

### 範例 2：設計實驗來檢驗假設

**使用者請求：**

```
We assume enterprise teams will pay $200/month for our reporting feature. Design experiments to validate this before we build it.
```

代理人將支付意願假設命名為高風險和高影響，然後在任何建置之前在報告頁面上提出假門測試（計算「請求報告訪問」按鈕的點擊次數並收集價格意圖問題）。它使用上面的模板編寫實驗簡介，其中包含團隊預先設定的成功閾值以及每個結果的決策規則。 200 美元的價格是測試中的假設，而不是基準。


## 指南

1. **每週與使用者交談** — 持續發現意味著每週持續接觸（Teresa Torres，producttalk.org）
2. **測試假設，而不是想法** — 將每個想法分解為假設；首先用最便宜的實驗來測試風險最大的
3. **機會解決方案樹** — 映射結果 → 機會 → 解決方案 → 實驗；它阻礙了解決方案優先的思維
4. **先進行最便宜的測試** — 在建立原型之前從案頭研究和調查開始；大多數假設無需程式碼即可測試
5. **比較，不要問** — 向使用者展示替代方案，而不是問「你會使用這個嗎？」；行為比意見更能揭示偏好
6. **時間盒實驗** - 每個實驗都有一個截止日期和在開始前定義的成功指標；沒有開放式的探索
7. **快速扼殺創意**－如果最危險的假設失敗，就扼殺這個創意；不要將沉沒成本合理化
8. **記錄一切** — 記錄訪談、標記引言、追蹤實驗結果；您的發現日誌是每個產品決策的證據基礎
