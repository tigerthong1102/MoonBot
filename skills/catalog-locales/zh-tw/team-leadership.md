使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# 團隊領導力

## 概述

管理團隊並不是告訴人們該做什麼。它是關於明確定義期望的結果，減少合作的摩擦，並創建使成功成為預設路徑的結構。

這項技能涵蓋了個人 MBA 中最具可操作性的領導框架：指揮官意圖、溝通開銷、黃金三連勝、贏得尊重、強制職能和旁觀者冷漠。

## 使用說明

當使用者詢問團隊管理、改善協作、設定目標、召開會議或建立問責制時，請套用這些框架。

### 框架 1：指揮官的意圖

**定義：** 定義所需的最終狀態並讓團隊弄清楚如何到達那裡。

軍方發明了這個概念，因為作戰計畫在與敵人第一次接觸時就崩潰了。指揮官傳達的意圖不是立即過時的詳細分步命令，而是：“我們需要在黎明前控制那座橋。根據你的判斷來決定如何到達那裡。”

**指揮官意圖的格式：**
```
SITUATION: [What's happening and why this matters]
INTENT: [The end state we need to achieve]
SUCCESS LOOKS LIKE: [Measurable criteria — how we know we're done]
CONSTRAINTS: [What we must NOT do / non-negotiables]
RESOURCES: [What the team has available]
TIMELINE: [When this needs to be done]
```

**產品發布範例：**
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

**為什麼這樣做：** 團隊擁有完整的背景（為什麼）、明確的成功標準（什麼）、明確的界限（不是什麼）和自主權（如何）。他們會做出比你微觀管理更好的決策，因為他們更接近實施細節。

### 框架 2：通訊開銷

**定義：** 通訊開銷依照公式 n × (n-1) / 2 成長，其中 n 是團隊規模。

| 團隊規模 | 溝通管道 | 複雜度 |
|-----------|----------------------|------------|
| 3 | 3 | 可管理 |
| 5 | 10 | 變得複雜 |
| 8 | 28 | 大量開銷 |
| 12 | 66 | 遇見地獄 |
| 20 | 190 | 官僚主義癱瘓 |

**這就是為什麼添加人員會減慢團隊速度。 ** 每個新人都會為每個現有人員添加頻道。

**減少通訊開銷：**

1. **小團隊** - 亞馬遜的“兩個披薩規則”（傑夫·貝索斯：團隊不能超過兩個披薩）。該規則沒有規定人數； 5-8人是常見的閱讀量，工作允許的情況下3-5人更好。

2. **預設非同步** — 大多數通訊不需要即時。
   - 使用：書面文件、Slack 線程、Loom 影片、帶有評論的 PR
   - 預留同步（會議）用於：需要辯論的決策、建立關係、解決複雜的問題

3. **減少會議數量和規模：**
   - 每次會議都需要：議程、負責人、時間限制、記錄在案的決定
   - 決策會議最多 5 人。其他人得到筆記。
   - 取消每季召開的定期會議。僅重新添加人們錯過的內容。
   - 站立會議的時間不得超過 15 分鐘，除非是研討會。

4. **單一事實來源** — 一處用於專案狀態、一處用於決策、一處用於規範。當資訊存在於 5 個 Slack 頻道和 3 個文件中時，人們花在搜尋上的時間比工作的時間還要多。

5. **通訊協定：**
   ```
   Urgent + important:    Call or direct message with "URGENT:" prefix
   Important, not urgent:  Email or Slack thread (24-hour response expectation)
   FYI / async update:    Doc update or async standup
   Discussion needed:      Schedule a 15-min meeting with agenda
   ```

### 框架 3：黃金三連勝

**定義：** 每個健康的團隊互動都建立在三件事之上：
1. **欣賞** — 真誠地感謝人們的貢獻
2. **禮貌** — 永遠以基本的尊重對待他人
3. **尊重**－重視他們的專業知識和自主權

**這聽起來很明顯。事實並非如此。 ** 在壓力下，領導者：
- 跳過欣賞（“我們沒有時間拍拍背”）
- 放棄禮貌（“只要解決它，我不在乎如何”）
- 破壞尊重（「讓我自己做吧」）

**實際應用：**
- 每次一對一從那個人做得好的具體事情開始。不是“幹得好”——“你建立資料庫遷移計劃的方式為我們節省了一周的工作時間。”
- 在公開場合（團隊頻道）說“謝謝”，在私下（DM 或 1:1）提供建設性回饋。
- 當你不同意時，說「幫助我理解你的推理」而不是「那是錯的」。
- 永遠不要將團隊合作歸功於自己。始終歸因於：“莎拉對 X 的想法導致了 Y 結果。”

### 框架 4：贏得尊重

**定義：** 尊重和影響力是透過表現出的能力而不是頭銜或權威來贏得的。

**兩種類型的尊重：**
1. **基於能力** — “他們真的很擅長自己所做的事情”
2. **基於性格**——“他們總是言出必行”

**領導者如何贏得尊重：**
- **兌現承諾。 **說出你要做什麼，然後去做。每次。失去團隊最快的方式就是違背承諾。
- **勝任團隊所重視的事。 **您不需要成為最好的工程師，但您需要了解什麼是優秀的工程師。
- **保護團隊。 ** 保護他們免受組織政治、不合理要求和範圍蔓延的影響。他們會注意到的。
- **公開承認錯誤。 ** 「我對 X 做出了錯誤的決定。這是我學到的。這是我們將採取的不同做法。」這比從不犯錯更能建立信任。

### 框架 5：強制函數

**定義：** 強制採取行動的結構，消除了拖延或避免的選擇。

**強制功能範例：**

1. **公開演示** — 安排週五下午 3 點進行演示。該團隊將在周四晚上之前發貨。沒有安排演示嗎？ 「我們會在準備好後發貨」（從不）。

2. **具有後果的截​​止日期** —「該活動將於 3 月 1 日啟動，無論是否有新功能。」具有外部依賴性的實際截止日期比內部依賴性更強大。

3. **「交付或終止」會議** — 每月審查：每個項目要么顯示可衡量的進展，要么被終止。不允許殭屍項目。

4. **站立簽到** — “你昨天完成了什麼？今天你會完成什麼？”強調“完成”，而不是“努力完成”。

5. **事前剖析** — 在開始一個專案之前：「想像一下，從現在開始 3 個月後，這個專案失敗了。為什麼？」迫使團隊提前考慮風險。

6. **預算限制** — 「你有 5,000 美元和 2 週的時間。」限制孕育創造力。無限的資源會滋生膨脹。

**為什麼強制功能有效：** 它們用結構（可靠）代替動機（不可靠）。您不需要團隊想要按時發貨——您需要一個使發貨成為預設結果的系統。

### 框架 6：旁觀者冷漠

**定義：** 當責任沒有分配給特定的人時，就沒有人採取行動。 「有人應該解決這個問題」意味著沒有人會解決這個問題。

**規則：每項任務都需要一個所有者。 **

不是一個團隊，不是一個管道，也不是「誰能接觸到它」。一個人的名字與一種結果有關。

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

**在會議中：** 每次會議結束時都會問：「誰擁有這個？什麼時候？」如果答案不明確，會議就浪費了。

## 範例

### 範例 1：為遷移項目編寫 Commander 意圖

**使用者要求：**“我們需要從 Heroku 遷移到 AWS。我如何將此訊息傳達給我的 4 人團隊？”

**輸出：**
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

### 範例 2：減少不斷成長的團隊的會議費用

**用戶請求：**“我的團隊從 5 人增加到 12 人。我們現在每天花 3 個多小時開會，但什麼也沒做。”

**輸出：**
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

- 指揮官的意圖應始終包括約束（不該做什麼）。沒有邊界的自治是混亂的。
- 在討論通訊開銷時，請務必計算實際的通道數 (n×(n-1)/2)，以使問題具體化。
- 強制功能應該感覺自然，而不是懲罰性的。當範圍合適時，公開演示是令人興奮的，而不是有壓力的。
- 每個行動項目都需要一個所有者和一個截止日期。 「團隊會處理它」意味著沒有人會處理它。
- 黃金三連音聽起來很柔和，但練習起來很便宜，而且在壓力下很容易跳過。人們常常會因為不欣賞、不尊重、不禮貌而離開經理。
- 喜歡異步通信來共享資訊。為決策和辯論保留同步（會議）。
