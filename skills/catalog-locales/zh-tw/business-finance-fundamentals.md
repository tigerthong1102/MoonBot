使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# 商業財務基礎知識

## 概述

您無需擁有 MBA 學位即可了解商業財務。您需要了解五件事：錢如何進來（收入）、錢如何出去（成本）、剩下什麼（利潤）、客戶停留和付款的時間（LTV）以及獲得這些客戶的成本是多少（CAC）。其他一切都是這五種的變體。

這項技能涵蓋了基本的財務框架——增加收入的 4 種方法、單位經濟效益、LTV/CAC 分析以及利潤和現金流之間的關鍵區別。

## 使用說明

當使用者詢問企業獲利能力、單位經濟效益、定價影響或財務狀況時，請套用這些框架。

### 增加收入的 4 種方法

世界上每家企業只能透過四種方式增加收入。沒有例外：

1. **增加客戶數量** — 更多行銷、更好的轉換、新管道。線性影響：2x 客戶 = 2x 收入（通常是最難且最昂貴的）。

2. **增加平均交易規模** — 追加銷售、捆綁銷售、高級套餐、附加服務。例如：「你想配薯條嗎？」為麥當勞創造了數十億美元的收入。

3. **增加交易頻率**－訂閱、消耗品、習慣養成。範例：從一次性購買轉向訂閱模式 = 經常性收入。

4. **提高價格** — 基於價值的定價，高端定位。最高槓桿：在成本不變的情況下，價格上漲 10% 可直接帶來利潤。

**收入影響公式：**
```
Revenue = Customers × Units per Transaction × Frequency × Price per Unit
```

所有四個因素均提高 10%：
```
1.1 × 1.1 × 1.1 × 1.1 = 1.46 → 46% revenue increase from four 10% improvements
```

### 利潤率分析

**毛利率** =（收入 - 銷售成本）/收入
- 粗略的啟發法，沒有來源的統計數據；與您自己的行業進行比較：
- 軟體即服務：70-85%
- 服務：40-60%
- 實體產品：30-50%

**淨利潤** =（收入 - 所有成本）/收入
- 粗略啟發：SaaS 規模淨利潤率為 15-25%；服務 10-20%

**為什麼利潤比收入重要：**
- 10% 利潤率下的 100 萬美元收入 = 10 萬美元利潤
- 利潤率為 40% 時，營收 50 萬美元 = 利潤 20 萬美元
- 規模較小的企業利潤較高。收入是虛榮，利潤是理智。

### 單位經濟效益：LTV 和 CAC

**客戶終身價值 (LTV)：**
```
LTV = ARPU / Monthly Churn Rate

Example:
  ARPU = $90/month
  Monthly churn = 5%
  LTV = $90 / 0.05 = $1,800
```

更精確的毛利率：
```
LTV = (ARPU × Gross Margin) / Monthly Churn Rate

Example:
  ARPU = $90, Gross Margin = 80%, Churn = 5%
  LTV = ($90 × 0.80) / 0.05 = $1,440
```

**客戶獲取成本（CAC）：**
```
CAC = Total Sales & Marketing Spend / New Customers Acquired

Example:
  Spent $17,000 on marketing last month
  Acquired 50 new customers
  CAC = $17,000 / 50 = $340
```

**LTV/CAC 比率 - 核心 SaaS 指標（3:1 範圍是常見的經驗法則，而非標準）：**

| LTV/CAC | 判決 | 訴訟 |
|---------|---------|--------|
| < 1:1 | 每位顧客都賠錢 | 停止取得。立即修復產品或定價。 |
| 1-2:1 | 勉強生存 | 緊急降低 CAC 或提高 LTV。 |
| 2-3:1 | 處於健康邊緣 | 優化 — 您擁有一家企業，但它很脆弱。 |
| 3-5:1 | 健康 | 良好的單位經濟效益。仔細衡量。 |
| > 5:1 | 優秀或投資不足 | 要么非常高效，要么在增長方面投入不足。 |

**CAC 投資回收期：**
```
Payback = CAC / (ARPU × Gross Margin)

Example:
  CAC = $340, ARPU = $90, Gross Margin = 80%
  Payback = $340 / ($90 × 0.80) = 4.7 months
```

經驗法則：12 個月內回本投資； 6個月以下就很好了。

### 損益平衡分析

```
Breakeven Point = Fixed Costs / (Price per Unit - Variable Cost per Unit)

Example:
  Fixed costs: $8,000/month (salaries, hosting, tools)
  Price per customer: $90/month
  Variable cost per customer: $12/month (API calls, support)
  Breakeven = $8,000 / ($90 - $12) = 103 customers
```

低於103個客戶：賠錢。高於 103：每位新客戶每月增加 78 美元的利潤。

### 現金流與利潤

**利潤**是一個會計概念。 **現金流**是現實。您可能在紙面上實現盈利，但仍然破產（客戶支付 Net 60，您現在支付工資 - 利潤為正，現金為負，業務死亡）。

**現金流規則：**
1. 盡快收款（年計劃>月計劃，預付款>Net 30）
2. 盡可能晚支付費用（協商條款）
3. 始終保留 3-6 個月的營運費用儲備
4. 折扣的年度方案幾乎總是值得的：提供 890 美元/年 vs 90 美元/月（1,080 美元）。您現在可以獲得 890 美元現金。

### 允許的購置成本

您可以花多少錢來獲取客戶？最大允許 CAC = LTV x (1 - 目標利潤)。範例：LTV = $1,800，收購後目標利潤率維持 60%，最大 CAC = $1,800 x 0.40 = $720。如果實際 CAC 為 340 美元，您就有 380 美元的空間用於在成長方面進行更多投資。

## 關鍵公式

```
ARPU = MRR / Customer Count
LTV = (ARPU × Gross Margin) / Monthly Churn Rate
CAC = Total Sales & Marketing Spend / New Customers Acquired
LTV/CAC Ratio = LTV / CAC
CAC Payback = CAC / (ARPU × Gross Margin)
Breakeven Customers = (Fixed Costs + Marketing Spend) / (ARPU × Gross Margin)
Max Allowable CAC = LTV × 0.40 (keep 60%, spend up to 40% on acquisition)
```

## 範例

### 範例1：SaaS健康檢查

**用戶要求：**“我的 SaaS 的 MRR 為 45,000 美元，客戶數為 500，每月流失率為 8%，營銷支出為 17,000 美元/月，每月有 50 個新客戶，毛利率為 75%，固定成本為 22,000 美元。我健康嗎？”

**輸出：**
```
SaaS Unit Economics Report:

  ARPU:               $90/month
  LTV:                $844 (low — churn is killing you)
  CAC:                $340
  LTV/CAC:            2.5x — WARNING: Borderline healthy
  CAC Payback:        5.0 months (acceptable)
  Average Customer Life: 12.5 months

  Monthly P&L:
    Revenue:          $45,000
    Gross Profit:     $33,750 (75%)
    - Fixed Costs:    -$22,000
    - Marketing:      -$17,000
    Net Margin:       -$5,250 (-11.7%) ← LOSING MONEY

  Breakeven:          578 customers (you have 500 — 78 short)

  Revenue Lever Impact (each lever changed on its own):
    Churn 8%→7.2%:        LTV $844→$938 (+11%); the effect builds over months
    ARPU $90→$99:         +$4,500 MRR immediately (+$3,375 gross profit)
    Price +10%:           same as ARPU if applied to all customers
    Acquisition 50→55/mo: +5 customers/month (+$450 MRR per monthly cohort)

  Diagnosis: Your #1 problem is churn. At 8%/month, customers live only
  12.5 months on average. Fix churn first: retention gains compound, while the price
  lever pays off immediately. If you halve churn to 4%, LTV doubles to $1,688 and
  the steady-state customer base (50 new/month / churn) doubles from 625 to 1,250,
  far above the 578 breakeven.
```

### 範例 2：價格上漲影響建模

**用戶要求：**“如果我將價格從每月 49 美元提高到 59 美元 20%，會發生什麼？我有 300 名客戶。”

**輸出：**
```
Price Increase Impact Model: $49 → $59/month (+20%)

  Scenario A: No customer loss (best case)
    Revenue: $14,700 → $17,700 (+$3,000/month, +$36k/year)
    If costs unchanged: $3,000/month goes straight to profit

  Scenario B: 5% customer loss (typical)
    Customers: 300 → 285
    Revenue: $14,700 → $16,815 (+$2,115/month, +$25k/year)
    Still a clear win.

  Scenario C: 15% customer loss (aggressive)
    Customers: 300 → 255
    Revenue: $14,700 → $15,045 (+$345/month)
    Marginal win, but fewer customers = lower support cost.

  Break-even churn from price increase:
    You'd need to lose 51+ customers (17%) for this to be net negative.
    Churn after a price increase varies by product; test it with a
    subset of customers before applying it to everyone.

  Recommendation: DO IT. Grandfather existing customers for 3 months,
  apply new price to all new signups immediately.
```

## 指南

- 始終使用毛利率而非原始 ARPU 來計算 LTV。 LTV = (ARPU × 毛利率) / 流失率。
- 當每月流失率超過 5%（SaaS 的經驗法則）時，將其標記為最高優先順序。
- 顯示按對特定業務的影響排名的 4 個收入槓桿，而不是按通用順序。
- 當企業帳面獲利但現金為負時，現金流量警告應該會很突出。
- 價格上漲模型應始終包括 3 種情況：無損失、典型損失 (5%) 和積極損失 (15%)。
- 提醒用戶：“收入是虛榮，利潤是理智，現金為王。”
