使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# DCF 模型產生器

## 概述

這項技能可以根據投資銀行標準創建機構品質的 DCF 模型，用於股權估值。每次分析都會產生詳細的 Excel 模型（DCF 表底部包含敏感度分析）。

## 工具

- 預設使用使用者提供的所有資訊和可用於資料來源的 MCP 伺服器。

## 關鍵限制 - 首先閱讀這些

這些約束適用於所有 DCF 模型建置。開始前回顧：

**環境：Office JS 與 Python/openpyxl：**
- **如果在 Excel 中執行（Office 加載項/Office JS 環境）：** 直接使用 Office JS — 不要使用 Python/openpyxl。透過`range.formulas = [["=D19*(1+$B$8)"]]`編寫公式。無需單獨的重新計算步驟； Excel 本身進行計算。使用 `range.format.*` 進行造型。相同的公式硬編碼規則適用：對於衍生單元格設定 `.formulas`，而不是 `.values`。
- **如果產生獨立的 .xlsx 檔案（無即時 Excel 會話）：** 如下所述使用 Python/openpyxl，然後在交付前運行 `recalc.py`。
- 此技能的其餘部分使用 openpyxl 範例 - 在該環境中轉換為 Office JS API 調用，但所有原則（公式字串、單元格註釋、部分檢查點、敏感度表循環）都同樣適用。

**⚠️ Office JS 合併儲存格陷阱：** 使用合併儲存格建置節標題時，請勿呼叫 `.merge()`，然後在合併範圍上設定 `.values` — Office JS 仍會報告範圍的原始尺寸並會拋出 `InvalidArgument: The number of rows or columns in the input array doesn't match the size or dimensions of the range`。相反，將值單獨寫入左上角的儲存格，然後合併並格式化整個範圍：

```js
// WRONG — throws InvalidArgument:
const hdr = ws.getRange("A7:H7");
hdr.merge();
hdr.values = [["MARKET DATA & KEY INPUTS"]];  // 1×1 array vs 1×8 range → fails

// CORRECT — value first on single cell, then merge + format the range:
ws.getRange("A7").values = [["MARKET DATA & KEY INPUTS"]];
const hdr = ws.getRange("A7:H7");
hdr.merge();
hdr.format.fill.color = "#1F4E79";
hdr.format.font.bold = true;
hdr.format.font.color = "#FFFFFF";
```

這適用於 DCF 中的每個合併部分標題（市場資料、情境區塊、現金流量預測、終值、估值摘要、敏感度表）。

**公式優於硬編碼（不可協商）：**
- 每個預測、保證金、折扣因子、PV 和敏感度單元格都必須是即時 Excel 公式 — 絕對不能是用 Python 計算並寫為數字的值
- 使用openpyxl時：`ws["D20"] = "=D19*(1+$B$8)"`正確； `ws["D20"] = calculated_revenue` 是錯誤的
- 唯一允許的硬編碼數字是：(1) 原始歷史輸入，(2) 假設驅動因素（成長率、WACC 輸入、終端 g），(3) 當前市場資料（股價、債務餘額）
- 如果你發現自己在用 Python 計算一些東西並寫出結果——停下來。當使用者改變假設時，模型必須進行調整。

**與使用者一起逐步驗證（不要建立端到端）：**
- 資料檢索後→向使用者顯示原始輸入區塊（收入、利潤、股票、淨債務）並在預測前確認
- 收入預測後→顯示預計的收入和成長率，在建立利潤率之前確認
- FCF建置後→顯示完整的FCF時間表，在計算WACC之前確認邏輯
- WACC後→顯示計算與輸入，折扣前確認
- 終值+PV→顯示權益橋（EV→權益價值→每股）後，在敏感度表前確認
- 在每個階段捕獲錯誤——建立敏感性表後發現錯誤的裕度假設意味著重建下游的所有內容

**靈敏度表：**
- **使用奇數行和列**（標準：5×5，有時 7×7）－這保證了真正的中心單元
- **中心單元 = 基本情況。 ** 建立軸值，使中間行標題和中間列標題完全等於模型的實際假設（例如，如果基本 WACC = 9.0%，則中間行為 9.0%；如果終端 g = 3.0%，則中間列為 3.0%）。因此，中心單元格的輸出必須等於模型的實際隱含股價 - 這是表格正確建構的健全性檢查。
- **使用中藍色填滿 (`#BDD7EE`) + 粗體反白顯示​​中心單元格**，以便立即看到哪個單元格是基本情況。
- 使用完整的 DCF 重新計算公式填入所有儲存格（通常為 3 個表 × 25 個儲存格 = 75）
- 使用 openpyxl 循環（或 Office JS 循環）以程式設計方式編寫公式
- 無需佔位符文本，無需線性近似，無需手動步驟
- 每個單元必須重新計算該假設組合的完整 DCF

**細胞評論：**
- 建立每個硬編碼值時新增儲存格註釋
- 格式：“來源：[系統/文件]、[日期]、[參考]、[URL（如果適用）”
- 在進入下一部分之前，每個藍色輸入都必須有註釋
- 不要推遲結束或寫“TODO：添加來源”

**模型佈局規劃：**
- 在編寫任何公式之前定義所有部分行位置
- 首先寫入所有標題和標籤
- 第二個寫入所有節分隔符號和空白行
- 然後使用鎖定的行位置編寫公式
- 建立後立即測試公式

**公式重新計算：**
- 發貨前運行`python recalc.py model.xlsx 30`
- 修復所有錯誤，直到狀態為“成功”
- 要求零公式錯誤（#REF!、#DIV/0!、#VALUE! 等）

**場景區塊：**
- 為空頭/基本/牛市情況建立單獨的區塊
- 在每個區塊內水平顯示跨預測年份的假設
- 使用 IF 公式：`=IF($B$6=1,[Bear cell],IF($B$6=2,[Base cell],[Bull cell]))`
- 驗證公式引用正確的場景區塊儲存格

## DCF 流程工作流程

### 第 1 步：資料檢索與驗證

從 MCP 伺服器、使用者提供的資料和 Web 取得資料。

**資料來源優先權：**
1. **MCP 伺服器**（如果配置）- 來自 Daloopa 等提供者的結構化財務數據
2. **使用者提供的數據** - 他們研究的歷史財務數據
3. **網路搜尋/取得** - 當前價格、貝塔值、債務和現金（需要時）

**驗證清單：**
- 驗證淨債務與淨現金（對於估值至關重要）
- 確認稀釋後的已發行股票（檢查最近的回購/發行）
- 驗證歷史利潤率與業務模式一致
- 與行業基準交叉檢查收入成長率
- 驗證稅率是否合理（通常為 21-28%）

### 第2步：歷史分析（3-5年）

分析並記錄：
- **收入成長趨勢**：計算複合年增長率，確定驅動因素
- **利潤進展**：追蹤毛利率、稅前利潤率、自由現金流利潤率
- **資本強度**：D&A 和資本支出佔收入的百分比
- **營運資本效率**：NWC隨收入成長的百分比變化
- **回報指標**：ROIC、ROE 趨勢

建立匯總表顯示：
```
Historical Metrics (LTM):
Revenue: $X million
Revenue growth: X% CAGR
Gross margin: X%
EBIT margin: X%
D&A % of revenue: X%
CapEx % of revenue: X%
FCF margin: X%
```

### 第 3 步：建立收入預測

**方法論：**
1. 從最新的實際收入開始（LTM 或最近的財政年度）
2. 應用每個預測年的成長率
3. 顯示美元金額和計算的成長率

**增長率框架：**
- 第 1-2 年：更高的成長反映了近期的可見性
- 第 3-4 年：逐漸趨向產業平均水平
- 5年以上：接近終端成長率

**公式結構：**
- 收入（N 年）= 收入（N-1 年）×（1 + 成長率）
- 成長率（第 N 年）= 收入（第 N 年）/ 收入（第 N-1 年）- 1

**三種場景方法：**
```
Bear Case: Conservative growth (e.g., 8-12%)
Base Case: Most likely scenario (e.g., 12-16%)
Bull Case: Optimistic growth (e.g., 16-20%)
```

### 第 4 步：營運費用建模

**固定/變動成本分析：**

營運費用應模擬現實的營運槓桿：
- **銷售和行銷**：通常佔收入的 15-40%，取決於業務模式
- **研發**：科技公司通常為 10-30%
- **一般與行政**：通常佔收入的 8-15%，隨著公司規模的擴大而發揮槓桿作用

**關鍵原則：**
- 所有百分比均基於收入，而非毛利
- 模型營運槓桿：百分比應隨著收入規模而下降
- 為 S&M、R&D、G&A 維護單獨的行項目
- 計算 EBIT = 毛利 - 總營運支出

**利潤擴張框架：**
```
Current State → Target State (Year 5)
Gross Margin: X% → Y% (justify based on scale, efficiency)
EBIT Margin: X% → Y% (result of revenue growth + opex leverage)
```

### 第5步：自由現金流計算

**以正確的順序建立 FCF：**

```
EBIT
(-) Taxes (EBIT × Tax Rate)
= NOPAT (Net Operating Profit After Tax)
(+) D&A (non-cash expense, % of revenue)
(-) CapEx (% of revenue, typically 4-8%)
(-) Δ NWC (change in working capital)
= Unlevered Free Cash Flow
```

**營運資金建模：**
- 計算為收入變化的百分比（增量收入）
- 典型範圍：收入變化的 -2% 至 +2%
- 負數=現金來源（營運資金釋放）
- 正數 = 現金使用量（營運資金建設）

**維護與成長資本支出：**
- 維護資本支出：維持目前營運（約 2-3% 收入）
- 成長資本支出：支持擴張（額外 2-5% 收入）
- 總資本支出應與公司的成長策略保持一致

### 第 6 步：資本成本 (WACC) 研究

**股本成本的 CAPM 方法：**

```
Cost of Equity = Risk-Free Rate + Beta × Equity Risk Premium

Where:
- Risk-Free Rate = Current 10-Year Treasury Yield
- Beta = 5-year monthly stock beta vs market index
- Equity Risk Premium = 5.0-6.0% (market standard)
```

**債務成本計算：**

```
After-Tax Cost of Debt = Pre-Tax Cost of Debt × (1 - Tax Rate)

Determine Pre-Tax Cost of Debt from:
- Credit rating (if available)
- Current yield on company bonds
- Interest expense / Total Debt from financials
```

**資本結構權重：**

```
Market Value Equity = Current Stock Price × Shares Outstanding
Net Debt = Total Debt - Cash & Equivalents
Enterprise Value = Market Cap + Net Debt

Equity Weight = Market Cap / Enterprise Value
Debt Weight = Net Debt / Enterprise Value

WACC = (Cost of Equity × Equity Weight) + (After-Tax Cost of Debt × Debt Weight)
```

**特殊情況：**
- **淨現金部位**：如果現金>債務，則淨債務為負
  - 債務權重可能為負
  - WACC 計算相應調整
- **無債務**：WACC = 股本成本

**典型的 WACC 範圍：**
- 大盤股，穩定：7-9%
- 成長型公司：9-12%
- 高成長/風險：12-15%

### 第 7 步：折扣率應用（5-10 年預測）

**年中大會：**
- 假設年中發生的現金流量
- 折扣期：0.5、1.5、2.5、3.5、4.5等
- 折扣係數 = 1 / (1 + WACC)^期間

**現值計算：**
```
For each projection year:
PV of FCF = Unlevered FCF × Discount Factor

Example (Year 1):
FCF = $1,000
WACC = 10%
Period = 0.5
Discount Factor = 1 / (1.10)^0.5 = 0.9535
PV = $1,000 × 0.9535 = $954
```

**投影週期選擇：**
- **5 年**：大多數分析的標準
- **7-10年**：具有較長跑道的高成長公司
- **3年**：成熟、穩定的業務

### 步驟8：終值計算

**永續增長法（首選）：**

```
Terminal FCF = Final Year FCF × (1 + Terminal Growth Rate)
Terminal Value = Terminal FCF / (WACC - Terminal Growth Rate)

Critical Constraint: Terminal Growth < WACC (otherwise infinite value)
```

**最終成長率選擇：**
- 保守：2.0-2.5%（GDP成長率）
- 中：2.5-3.5%
- 激進：3.5-5.0%（僅適用於市場領導者）

**不要超過**：無風險利率或長期GDP成長

**退出多種方法（替代）：**
```
Terminal Value = Final Year EBITDA × Exit Multiple

Where Exit Multiple comes from:
- Industry comparable trading multiples
- Precedent transaction multiples
- Typical range: 8-15x EBITDA
```

**終值現值：**
```
PV of Terminal Value = Terminal Value / (1 + WACC)^Final Period

Where Final Period accounts for timing:
5-year model with mid-year convention: Period = 4.5
```

**終端值健全性檢查：**
- 應代表企業價值的 50-70%
- 如果 >75%，模型可能過度依賴最終假設
- 如果<40%，檢查最終假設是否過於保守

### 第九步：企業與股權價值的橋樑

**估值概要結構：**

```
(+) Sum of PV of Projected FCFs = $X million
(+) PV of Terminal Value = $Y million
= Enterprise Value = $Z million

(-) Net Debt [or + Net Cash if negative] = $A million
= Equity Value = $B million

÷ Diluted Shares Outstanding = C million shares
= Implied Price per Share = $XX.XX

Current Stock Price = $YY.YY
Implied Return = (Implied Price / Current Price) - 1 = XX%
```

**關鍵調整：**
- **淨債務 = 總債務 - 現金及等價物**
  - 如果為正：從 EV 中減去（減少股權價值）
  - 如果為負（淨現金）：加到 EV（增加股權價值）
- **使用稀釋股份**：包括選擇權、RSU、可轉換證券
- **其他調整**（如果適用）：
  - 少數利益
  - 退休金負債
  - 經營租賃義務

**評估輸出格式：**
```csv
Valuation Component,Amount ($M)
PV Explicit FCFs,X.X
PV Terminal Value,Y.Y
Enterprise Value,Z.Z
(-) Net Debt,A.A
Equity Value,B.B
,,
Shares Outstanding (M),C.C
Implied Price per Share,$XX.XX
Current Share Price,$YY.YY
Implied Upside/(Downside),+XX%
```

### 第10步：敏感度分析

在折現現金流表的底部建立**三個敏感度表**，顯示不同假設下估值如何變化：

1. **WACC 與終端成長** - 顯示企業價值對貼現率和永續成長的敏感度
2. **收入成長與息稅前利潤率** - 顯示收入成長和營運槓桿的影響
3. **貝塔利率與無風險利率** - 顯示對權益成分成本的敏感性

**實作**：這些是簡單的 2D 網格（不是 Excel 的「資料表」功能），每個儲存格中都有公式。每個單元格必須包含針對該特定假設組合的完整 DCF 重新計算。請參閱「關鍵約束」部分，以了解使用 openpyxl 以程式設計方式填入所有 75 個儲存格的詳細要求。

<correct_patterns>

本節包含建構 DCF 模型時要遵循的所有正確模式。

### 場景區塊選擇模式 - 遵循此方法

**針對每個場景，假設被組織在單獨的區塊中：**

**關鍵結構 - 每個節標題三行：**

```csv
BEAR CASE ASSUMPTIONS (section header, merge cells across)
Assumption,FY1,FY2,FY3,FY4,FY5
Revenue Growth (%),12%,10%,9%,8%,7%
EBIT Margin (%),45%,44%,43%,42%,41%

BASE CASE ASSUMPTIONS (section header, merge cells across)
Assumption,FY1,FY2,FY3,FY4,FY5
Revenue Growth (%),16%,14%,12%,10%,9%
EBIT Margin (%),48%,49%,50%,51%,52%

BULL CASE ASSUMPTIONS (section header, merge cells across)
Assumption,FY1,FY2,FY3,FY4,FY5
Revenue Growth (%),20%,18%,15%,13%,11%
EBIT Margin (%),50%,51%,52%,53%,54%
```

**每個場景區塊必須有一個列標題行**，在部分標題的正下方顯示預測年份（FY2025E、FY2026E 等）。如果沒有這個，使用者就無法判斷哪個假設值對應哪一年。

**如何引用假設 - 建立合併列：**
1. 案例選擇器儲存格（例如 B6）包含 1=Bear、2=Base 或 3=Bull
2. 使用 INDEX 或 OFFSET 公式建立合併列以從正確的場景區塊中提取
3. 投影公式引用合併列（乾淨的儲存格引用）
4. 每個情境區塊包含跨預測年份的全套 DCF 假設

**建議的合併列模式（使用 INDEX）：**
`=INDEX(B10:D10, 1, $B$6)`

**不是這個 - 散佈在各處的 IF 語句：**
`=IF($B$6=1,[Bear block cell],IF($B$6=2,[Base block cell],[Bull block cell]))`

合併列方法集中了邏輯並使模型更易於審核。

### 正確的收入預測模式

**使用 INDEX 公式建立合併列，然後在投影中引用它：**

**第 1 步 - 第一財年成長的合併欄位：**
`=INDEX([Bear FY1 growth]:[Bull FY1 growth], 1, $B$6)`

**步驟 2 - 收入預測參考合併列：**
`Revenue Year 1: =D29*(1+$E$10)`

其中：
- D29 = 上一年收入
- $E$10 = FY1 增長的合併列單元格（包含 INDEX 公式）
- $B$6 = 案例選擇器（1=熊市，2=基礎，3=多頭市場）

**這種方法比在每個預測公式中嵌入 IF 語句更清晰**，並且可以更輕鬆地審核正在使用的場景假設。

### 正確的 FCF 公式模式

**使用帶有 INDEX 公式的合併列，然後在 FCF 計算中引用它們：**

**合併柱方法：**
```csv
Item,Formula,Reference
D&A,=E29*$E$21,$E$21 = consolidation column for D&A %
CapEx,=E29*$E$22,$E$22 = consolidation column for CapEx %
Δ NWC,=(E29-D29)*$E$23,$E$23 = consolidation column for NWC %
Unlevered FCF,=E57+E58-E60-E62,E57=NOPAT E58=D&A E60=CapEx E62=Δ NWC
```

**每個合併列單元格都包含一個 INDEX 公式**，該公式根據案例選擇器從適當的場景區塊中提取。這使投影公式保持乾淨且可審計。

在編寫公式之前，請確認場景區塊行位置並設定合併列。

### 正確的儲存格註解格式

**每個硬編碼值都需要這種格式：**

“來源：[系統/文件]、[日期]、[參考]、[URL（如果適用）”

**範例：**
```csv
Item,Source Comment
Stock price,Source: Market data script 2025-10-12 Close price
Shares outstanding,Source: 10-K FY2024 Page 45 Note 12
Historical revenue,Source: 10-K FY2024 Page 32 Consolidated Statements
Beta,Source: Market data script 2025-10-12 5-year monthly beta
Consensus estimates,Source: Management guidance Q3 2024 earnings call
```

### 正確的假設表結構

**關鍵：每個場景區塊需要三個結構元素：**

1. **節標題行**（合併儲存格）：例如“BEAR CASE ASSUMPTIONS”
2. **列標題行**顯示年份 - 這是必要的，請勿跳過
3. **資料行** 與假設值

**結構：**
```csv
BEAR CASE ASSUMPTIONS (section header - merge across columns A:G)
Assumption,FY1,FY2,FY3,FY4,FY5
Revenue Growth (%),X%,X%,X%,X%,X%
EBIT Margin (%),X%,X%,X%,X%,X%
Terminal Growth,X%,,,,
WACC,X%,,,,

BASE CASE ASSUMPTIONS (section header - merge across columns A:G)
Assumption,FY1,FY2,FY3,FY4,FY5
Revenue Growth (%),X%,X%,X%,X%,X%
EBIT Margin (%),X%,X%,X%,X%,X%
Terminal Growth,X%,,,,
WACC,X%,,,,

BULL CASE ASSUMPTIONS (section header - merge across columns A:G)
Assumption,FY1,FY2,FY3,FY4,FY5
Revenue Growth (%),X%,X%,X%,X%,X%
EBIT Margin (%),X%,X%,X%,X%,X%
Terminal Growth,X%,,,,
WACC,X%,,,,
```

**如果列標題行沒有顯示預測年份（FY2025E、FY2026E 等），使用者無法判斷哪個假設值對應於哪個年份。此行是強制性的。 **

**然後建立一個合併列**（通常是右側的下一列），該列使用 INDEX 公式根據案例選擇器從選定的場景區塊中提取。此合併列是您的投影公式所引用的內容。

### 正確的行規劃流程

**1.先寫入所有標題和標籤：**
```csv
Row,Content
1,[Company Name] DCF Model
2,Ticker | Date | Year End
4,Case Selector
7,KEY ASSUMPTIONS
26,Assumption headers
27-31,Growth assumptions
...,...
```

**2.寫入所有節分隔線和空白行**

**3.然後使用鎖定的行位置編寫公式**

**4.建立後立即測試公式**

**把它想像成建築物：**
- 好：澆築地基，然後建造牆壁（結構穩定）
- 壞：先建牆，然後澆地基（牆倒塌）

**Excel版本：**
- 好：添加標題，然後編寫公式（公式穩定）
- 不好：寫公式，然後添加標題（公式中斷）

### 正確的靈敏度表實施

**重要**：這些不是 Excel 的「資料表」功能。這些是簡單的網格，您可以在其中使用 openpyxl 編寫常規公式。是的，這意味著總共大約 75 個公式（每個表格 3 個表格 × 25 個單元格），但這是簡單且必要的。

**使用公式進行程式化填滿：**

每個敏感度表必須完全填入公式，以重新計算每種假設組合的隱含股價。 **不要使用Excel的資料表功能**（它需要手動幹預，並且無法透過openpyxl自動化）。

**實施方法 - 具體範例：**

**表格結構 - 5×5 網格（ODD 尺寸，基本案例居中）：**

如果模型的基礎 WACC = 9.0% 且基礎終端成長率 = 3.0%，則圍繞這些值對稱建立軸：

```csv
WACC vs Terminal Growth,  2.0%,  2.5%,  3.0%,  3.5%,  4.0%
              8.0%,       [fml], [fml], [fml], [fml], [fml]
              8.5%,       [fml], [fml], [fml], [fml], [fml]
              9.0%,       [fml], [fml], [★  ], [fml], [fml]   ← middle row = base WACC
              9.5%,       [fml], [fml], [fml], [fml], [fml]
             10.0%,       [fml], [fml], [fml], [fml], [fml]
                                   ↑
                          middle col = base terminal g
```

**★ = 中心單元格。 ** 其公式輸出必須等於模型的實際隱含股價（來自估值摘要）。對此單元格應用中藍色填充 (`#BDD7EE`) 和粗體字體，以便在視覺上錨定基本情況。

**軸值規則：** `axis_values = [base - 2*step, base - step, base, base + step, base + 2*step]` — 圍繞底座對稱，奇數計數保證中心。

**配方模式 - B88 細胞（WACC=8.0%，最終生長=2.0%）：**

B88 中的公式應使用以下方法重新計算隱含價格：
- 行標題中的 WACC：`$A88` (8.0%)
- 列標題的最終增長：`B$87` (2.0%)

**建議方法：** 參考主要 DCF 計算，但取代這些值。

**公式結構範例：**
`=([SUM of PV FCFs using $A88 as discount rate] + [Terminal Value using B$87 as growth rate and $A88 as WACC] - [Net Debt]) / [Shares]`

**關鍵 - 為 5x5 網格中的每個單元格編寫公式（每個表 25 個單元格，總共 75 個單元格）。 ** 使用 openpyxl 以程式設計方式在迴圈中編寫這些公式。不要跳過此步驟或留下佔位符文字。

**Python實作模式：**
```python
# Pseudocode for populating sensitivity table
for row_idx, wacc_value in enumerate(wacc_range):
    for col_idx, term_growth_value in enumerate(term_growth_range):
        # Build formula that uses wacc_value and term_growth_value
        formula = f"=<DCF recalc using {wacc_value} and {term_growth_value}>"
        ws.cell(row=start_row+row_idx, column=start_col+col_idx).value = formula
```

**開啟模型後，靈敏度表必須立即作用，無需使用者執行手動步驟。 **

</correct_patterns>

<common_mistakes>

本節包含建置 DCF 模型時要避免的所有錯誤模式。

### 錯誤：簡化的靈敏度表近似值或占位符文本

**不要用線性近似：**

```
// WRONG - Linear approximation
B97: =B88*(1+(0.096-0.116))    // Assumes linear relationship

// WRONG - Division shortcut
B105: =B88/(1+(E48-0.07))      // Doesn't recalculate full DCF
```

**不要留下佔位符文字：**
```
// WRONG - Placeholder note
"Note: Use Excel Data Table feature (Data → What-If Analysis → Data Table) to populate sensitivity tables."

// WRONG - Empty cells
[leaving cells blank because "this is complex"]
```

**不要混淆名詞：**
- ❌「靈敏度表需要 Excel 的資料表功能」（否 - 這是我們無法使用的特定 Excel 工具）
- ✅「敏感度表是簡單的網格，每個單元格中都有公式」（是的 - 這就是我們建立的）

**為什麼這些快捷鍵是錯的：**
- 線性近似公式實際上並不會重新計算 DCF - 它們只是應用簡單的數學調整
- 關係不是線性的，因此結果不準確
- 佔位符文字需要使用者手動幹預
- 模型交付後不能立即使用
- 不專業或不適合客戶
- 空白單元格 = 不完整的可交付成果

**拒絕的常見合理化：**
“編寫 75 個以上的公式感覺很複雜，所以我會留下註釋，讓用戶手動完成。”

**現實：** 當您在 Python 中透過 openpyxl 使用循環時，編寫 75 個公式非常簡單。每個公式都遵循相同的模式 - 只需替換行/列值。這是可交付成果的必要部分。

**相反：** 使用公式填充每個敏感度單元格，重新計算該特定假設組合的完整 DCF

### 錯誤：缺少單元格註釋

**不要這樣做：**
- 建立所有不含註釋的硬編碼輸入
- 認為“我稍後會添加它們”
- 寫入“TODO：新增來源”
- 留下藍色輸入而沒有文檔

**為什麼錯誤：**
- 無法驗證資料來自哪裡
- 未達 xlsx 技能要求
- 尚未做好審核準備
- 浪費時間稍後修復

**相反：** 在建立每個硬編碼值時加入儲存格註釋

### 錯誤：公式行引用關閉

**症狀：**
FCF 部分引用了錯誤的假設行：
`D&A:  =E29*$E$34    // Should be $E$21, but referencing wrong row`
`CapEx: =E29*$E$41   // Should be $E$22, but row shifted`

**為什麼會發生這種情況：**
1. 先寫公式
2. 然後插入標題
3. 所有行引用均已移動
4. 現在公式指向錯誤的單元格→#REF！錯誤

**相反：** 先鎖定行佈局，然後寫公式

### 錯誤：跨場景的每個假設都是單行

**不要建構這樣的假設：**
```csv
Assumption,Bear,Base,Bull
Revenue Growth FY1,10%,13%,16%
Revenue Growth FY2,9%,12%,15%
```
這種垂直佈局使得很難看到每個場景中多年來的進展。

**為什麼錯誤：**
- 很難看出每個場景中的假設多年來的演變
- 更難比較整個預測期間的情境假設
- 審查場景邏輯不太直觀

**相反：**
- 為每個場景建立單獨的區塊（Bear、Base、Bull）
- 在每個區塊中，水平顯示跨預測年份的假設
- 這使得每個場景的假設更容易作為一個有凝聚力的集合進行審查

### 錯誤：無國界

**不要提供無邊界的模型：**
- 無剖面劃分
- 所有細胞混合在一起
- 難以閱讀且不專業

**為什麼錯誤：**
- 尚未為客戶做好準備
- 難以導航
- 看起來很業餘

**相反：** 在所有主要部分周圍添加邊框

### 錯誤：字體顏色錯誤或沒有字體顏色區別

**不要這樣做：**
- 所有文字均為黑色
- 僅使用填滿顏色（不更改字體顏色）
- 混淆哪些細胞是藍色的，哪些是黑色的

**為什麼錯誤：**
- 無法區分輸入和公式
- 審計變得不可能
- 違反 xlsx 技能要求

**相反：** 藍色文字表示所有硬編碼輸入，黑色文字表示所有公式，綠色文字表示工作表鏈接

### 錯誤：基於毛利的營運費用

**不要這樣做：**
`S&M: =E33*0.15    // E33 = Gross Profit (WRONG)`

**為什麼錯誤：**
- 營運費用與收入而非毛利成正比
- 產生不切實際的利潤進展
- 不是企業實際運作的方式

**相反：**
`S&M: =E29*0.15    // E29 = Revenue (CORRECT)`

### 前 5 個錯誤摘要

1. **公式行引用關閉** → 在編寫公式之前定義所有行位置
2. **缺少儲存格註解** → 新增註解是在儲存格建立時而不是在結束時新增的
3. **簡化的靈敏度表** → 使用完整的 DCF 重新計算公式（而不是近似值）填入所有儲存格
4. **場景區塊引用錯誤** → 確保 IF 公式從正確的 Bear/Base/Bull 區塊中擷取
5. **無邊框** → 新增專業的部分邊框，以實現客戶就緒的外觀

此外，請注意以下錯誤：

### WACC 計算錯誤
- 在資本結構中混合帳面價值和市場價值
- 錯誤地使用權益貝塔而不是資產/無槓桿貝塔
- 債務成本的稅率應用錯誤
- 無風險利率不正確（必須使用目前10年期國庫券）
- 未能調整淨債務與淨現金頭寸

### 成長假設的缺陷
- 終端增長>WACC（創造無限價值）
- 預測成長率與歷史表現不一致
- 忽視行業成長限制
- 收入成長與單位經濟效益不符
- 沒有營運理由的利潤擴張

### 終值錯誤
- 使用錯誤的成長方法（永續與退出倍數）
- 最終價值>企業價值的80%（顯示過度依賴）
- 終端利潤與穩態假設不一致
- 終值折現期錯誤

### 現金流量預測錯誤
- 營業費用是基於毛利而不是收入
- D&A/資本支出百分比與業務模式不一致
- 營運資金變動未正確計算
- 年間的稅率不一致
- NOPAT 計算錯誤

**這些錯誤是最常見的。在開始任何 DCF 建置之前請重新閱讀本節。 **

</common_mistakes>

## Excel 檔案建立

**此技能將 `xlsx` 技能用於所有電子表格操作。 ** xlsx 技能提供：
- 標準化公式建構規則
- 數字格式約定
- 透過 `recalc.py` 腳本自動重新計算公式
- 全面的錯誤檢查與驗證

此技能所建立的所有 Excel 檔案都必須遵循 xlsx 技能要求，包括零公式錯誤和正確的重新計算。

## 品質評價標準

每個 DCF 模型必須最大化：
1. **基於歷史績效的實際收入和利潤假設**
2. **採用適當的 CAPM 方法計算適當的資本成本**
3. **全面的敏感度分析**顯示估值範圍
4. **清晰的終值計算**並附有支持理由
5. **專業的模型結構**賦能場景分析
6. 所有關鍵假設的**透明文檔**

## 輸入要求

### 所需的最低輸入
1. **公司識別碼**：股票代碼或公司名稱
2. **成長假設**：預測期間的營收成長率（或稱「使用共識」）
3. **可選參數**：
   - 預測期（預設：5年）
   - 情境案例（熊市/基準/牛市成長和利潤率假設）
   - 終端成長率（預設：2.5-3.0%）
   - 如果不使用 CAPM，則特定 WACC 輸入

## Excel 模型結構

### 片材架構

建立**兩張表**：

1. **DCF** - 主要估值模型，底部有敏感度分析
2. **WACC** - 資本成本計算

**重要**：靈敏度表位於 DCF 表的底部（而不是在單獨的表上）。這將所有估值輸出放在一起。

### 公式重新計算（強制）

建立或修改 Excel 模型後，使用 xlsx 技能中的 recalc.py 腳本**重新計算所有公式**：

```bash
python recalc.py [path_to_excel_file] [timeout_seconds]
```

範例：
```bash
python recalc.py AAPL_DCF_Model_2025-10-12.xlsx 30
```

該腳本將：
- 使用 LibreOffice 重新計算所有工作表中的所有公式
- 掃描所有儲存格是否有 Excel 錯誤（#REF!、#DIV/0!、#VALUE!、#NAME?、#NULL!、#NUM!、#N/A）
- 傳回包含錯誤位置和計數的詳細 JSON

**預期輸出格式：**
```json
{
  "status": "success",           // or "errors_found"
  "total_errors": 0,              // Total error count
  "total_formulas": 42,           // Number of formulas in file
  "error_summary": {}             // Only present if errors found
}
```

**如果發現錯誤**，輸出將包括詳細資訊：
```json
{
  "status": "errors_found",
  "total_errors": 2,
  "total_formulas": 42,
  "error_summary": {
    "#REF!": {
      "count": 2,
      "locations": ["DCF!B25", "DCF!C25"]
    }
  }
}
```

**修復所有錯誤**並重新運行 recalc.py 直到狀態為“成功”，然後再交付模型。

### 格式化標準

**重要**：遵循 xlsx 技巧來了解公式建構規則和數字格式約定。 DCF技能增加了特定的視覺呈現標準。

**配色 - 兩層**：

**第 1 層：字型顏色（xlsx 技能強制）**
- **藍色文字（RGB：0,0,255）**：所有硬編碼輸入（股票價格、股份、歷史資料、假設）
- **黑色文字（RGB：0,0,0）**：所有公式和計算
- **綠色文字（RGB：0,128,0）**：其他工作表的連結（WACC 工作表參考）

**第 2 層：填滿顏色 - 專業藍色/灰色調色盤（預設值，除非使用者另有指定）**
- **保持最小化** - 僅使用藍色和灰色進行填充。不要引入綠色、黃色、橙色或多種強調色。顏色太多的模型看起來很業餘。
- **預設填滿調色板：**
  - **節標題**：深藍色（RGB：31,78,121 / `#1F4E79`）背景，白色粗體文本
  - **子標題/列標題**：淺藍色（RGB：217,225,242 / `#D9E1F2`）背景，黑色粗體文本
  - **輸入單元格**：淺灰色（RGB：242,242,242 / `#F2F2F2`）背景與藍色字體 - 或者如果您想要最大程度的極簡主義，則只需白色與藍色字體
  - **計算單元格**：白色背景黑色字體
  - **輸出/摘要行**（每股價值、EV 等）：中藍色（RGB：189,215,238 / `#BDD7EE`）背景，黑色粗體字體
- **就是這樣 - 3 個藍色 + 1 個灰色 + 白色。 ** 抵制增加更多的衝動。
- 使用者提供的範本或明確的顏色首選項始終會覆寫這些預設值。

**各層如何協同工作：**
- 輸入儲存格：藍色字體+淺灰色填滿=“硬編碼輸入”
- 公式單元格：黑色字體+白色背景=“計算值”
- 工作表連結：綠色字體+白色背景=“參考另一張工作表”
- 主要輸出：黑色粗體+中藍色填充=“這就是答案”

**字體顏色告訴您它是什麼（輸入/公式/連結）。填充顏色告訴你你在哪裡（標題/數據/輸出）。 **

### 邊界標準（專業外觀所需）

**主要部分周圍的粗邊框** (1.5pt)：
- 按鍵輸入部分
- 投影假設部分
- 5 年現金流量預測部分
- 終端值部分
- 估值摘要部分
- 每個敏感度分析表

**小節之間的中間邊框** (1pt)：
- 公司詳情與歷史業績
- 成長假設 vs 息稅前利潤率 vs FCF 參數

**資料表周圍的細邊框** (0.5pt)：
- 情境假設表（選擇熊市 | 基礎 | 牛市 |）
- 歷史與預期財務矩陣

**無邊框：** 表格內的各個儲存格（保持乾淨、可掃描）

**邊框是強制性的** - 沒有專業邊框的模型不適合客戶。

**數字格式**（遵循 xlsx 技能標準）：
- **年**：格式為文字字串（例如“2024”而不是“2,024”）
- **百分比**：`0.0%`（一位小數）
- **貨幣**：`$#,##0` 為百萬； `$#,##0.00` 每股 - 始終在標題中指定單位（「收入 ($mm)」）
- **零**：使用數字格式將所有零設為“-”（例如，`$#,##0;($#,##0);-`）
- **大數字**：`#,##0` 帶千位分隔符
- **負數**：`(#,##0)` 放在括號中（不是減號）

**儲存格註解（所有硬編碼輸入均強制）**：

根據 xlsx 技能，所有硬編碼值都必須具有記錄來源的儲存格註解。格式：“來源：[系統/文件]、[日期]、[參考]、[URL（如果適用）”

**重要**：在創建細胞時添加註釋。不要推遲到最後。

### DCF板材詳細結構

**第 1 部分：標題**
```csv
Row,Content
1,[Company Name] DCF Model
2,Ticker: [XXX] | Date: [Date] | Year End: [FYE]
3,Blank
4,Case Selector Cell (1=Bear 2=Base 3=Bull)
5,Case Name Display (formula: =IF([Selector]=1"Bear"IF([Selector]=2"Base""Bull")))
```

**第 2 部分：市場數據（不依賴具體情況）**
```csv
Item,Value
Current Stock Price,$XX.XX
Shares Outstanding (M),XX.X
Market Cap ($M),[Formula]
Net Debt ($M),XXX [or Net Cash if negative]
```

**第 3 節：DCF 情境假設**

使用 DCF 特定假設（收入成長率 %、息稅前利潤率 %、稅率 %、D&A 佔收入的 %、資本支出佔收入的 %、NWC 變化 ΔRev 的百分比、終端成長率、WACC）為每個情境（熊市、基礎、牛市）建立單獨的假設區塊，並在預測年份中橫向排列。每個區塊必須包括節標題、顯示預測年份（FY1、FY2 等）的列標題行和資料行。有關確切的佈局，請參閱 `<correct_patterns>` 部分「正確的假設表結構」。

**第 4 節：歷史與預計財務狀況**

**引用從場景區塊中提取的合併列（例如「選定案例」）**，而不是每個投影行中分散的 IF 公式。

```csv
Income Statement ($M),2020A,2021A,2022A,2023A,2024E,2025E,2026E
Revenue,XXX,XXX,XXX,XXX,[=E29*(1+$E$10)],[=F29*(1+$E$11)],[=G29*(1+$E$12)]
  % growth,XX%,XX%,XX%,XX%,[=E29/D29-1],[=F29/E29-1],[=G29/F29-1]
,,,,,,
Gross Profit,XXX,XXX,XXX,XXX,[=E29*E33],[=F29*F33],[=G29*G33]
  % margin,XX%,XX%,XX%,XX%,[=E33/E29],[=F33/F29],[=G33/G29]
,,,,,,
Operating Expenses:,,,,,,,
  S&M,XXX,XXX,XXX,XXX,[=E29*0.15],[=F29*0.14],[=G29*0.13]
  R&D,XXX,XXX,XXX,XXX,[=E29*0.12],[=F29*0.11],[=G29*0.10]
  G&A,XXX,XXX,XXX,XXX,[=E29*0.08],[=F29*0.07],[=G29*0.07]
  Total OpEx,XXX,XXX,XXX,XXX,[=E36+E37+E38],[=F36+F37+F38],[=G36+G37+G38]
,,,,,,
EBIT,XXX,XXX,XXX,XXX,[=E33-E39],[=F33-F39],[=G33-G39]
  % margin,XX%,XX%,XX%,XX%,[=E41/E29],[=F41/F29],[=G41/G29]
,,,,,,
Taxes,(XX),(XX),(XX),(XX),[=E41*$E$24],[=F41*$E$24],[=G41*$E$24]
  Tax rate,XX%,XX%,XX%,XX%,[=E43/E41],[=F43/F41],[=G43/G41]
,,,,,,
NOPAT,XXX,XXX,XXX,XXX,[=E41-E43],[=F41-F43],[=G41-G43]
```

**關鍵公式模式**：
- 營收成長：`=E29*(1+$E$10)` 其中 10 美元是第一年成長的合併欄
- 不是：`=E29*(1+IF($B$6=1,$B$10,IF($B$6=2,$C$10,$D$10)))`

這種方法更乾淨、更容易審核，並透過集中場景邏輯來防止公式錯誤。

**第 5 節：自由現金流建設**

**關鍵**：驗證行引用指向正確的假設行。建立後立即測試公式。

```csv
Cash Flow ($M),2020A,2021A,2022A,2023A,2024E,2025E,2026E
NOPAT,XXX,XXX,XXX,XXX,[=E45],[=F45],[=G45]
(+) D&A,XXX,XXX,XXX,XXX,[=E29*$E$21],[=F29*$E$21],[=G29*$E$21]
    % of Rev,XX%,XX%,XX%,XX%,[=E58/E29],[=F58/F29],[=G58/G29]
(-) CapEx,(XX),(XX),(XX),(XX),[=E29*$E$22],[=F29*$E$22],[=G29*$E$22]
    % of Rev,XX%,XX%,XX%,XX%,[=E60/E29],[=F60/F29],[=G60/G29]
(-) Δ NWC,(XX),(XX),(XX),(XX),[=(E29-D29)*$E$23],[=(F29-E29)*$E$23],[=(G29-F29)*$E$23]
    % of Δ Rev,XX%,XX%,XX%,XX%,[=E62/(E29-D29)],[=F62/(F29-E29)],[=G62/(G29-F29)]
,,,,,,
Unlevered FCF,XXX,XXX,XXX,XXX,[=E57+E58-E60-E62],[=F57+F58-F60-F62],[=G57+G58-G60-G62]
```

**行參考範例**（基於版面規劃）：
- $E$21 = D&A % 假設（合併列，第 21 行）
- $E$22 = 資本支出百分比假設（合併列，第 22 行）
- $E$23 = NWC % 假設（合併列，第 23 行）
- E29 = 年收入（第 29 行）
- E45 = 年份 NOPAT（第 45 行）

**在編寫公式之前**：確認這些行號與實際佈局相符。測試一列，然後複製。

**第 6 節：折現與估價**
```csv
DCF Valuation,2024E,2025E,2026E,2027E,2028E,Terminal
Unlevered FCF ($M),XXX,XXX,XXX,XXX,XXX,
Period,0.5,1.5,2.5,3.5,4.5,
Discount Factor,0.XX,0.XX,0.XX,0.XX,0.XX,
PV of FCF ($M),XXX,XXX,XXX,XXX,XXX,
,,,,,,
Terminal FCF ($M),,,,,,,XXX
Terminal Value ($M),,,,,,,XXX
PV Terminal Value ($M),,,,,,,XXX
,,,,,,
Valuation Summary ($M),,,,,,
Sum of PV FCFs,XXX,,,,,
PV Terminal Value,XXX,,,,,
Enterprise Value,XXX,,,,,
(-) Net Debt,(XX),,,,,
Equity Value,XXX,,,,,
,,,,,,
Shares Outstanding (M),XX.X,,,,,
IMPLIED PRICE PER SHARE,$XX.XX,,,,,
Current Stock Price,$XX.XX,,,,,
Implied Upside/(Downside),XX%,,,,,
```

### WACC 板材結構

```csv
COST OF EQUITY CALCULATION,,
Risk-Free Rate (10Y Treasury),X.XX%,[Yellow input]
Beta (5Y monthly),X.XX,[Yellow input]
Equity Risk Premium,X.XX%,[Yellow input]
Cost of Equity,X.XX%,[Calculated blue]
,,
COST OF DEBT CALCULATION,,
Credit Rating,AA-,[Yellow input]
Pre-Tax Cost of Debt,X.XX%,[Yellow input]
Tax Rate,XX.X%,[Link to DCF sheet]
After-Tax Cost of Debt,X.XX%,[Calculated blue]
,,
CAPITAL STRUCTURE,,
Current Stock Price,$XX.XX,[Link to DCF]
Shares Outstanding (M),XX.X,[Link to DCF]
Market Capitalization ($M),"X,XXX",[Calculated]
,,
Total Debt ($M),XXX,[Yellow input]
Cash & Equivalents ($M),XXX,[Yellow input]
Net Debt ($M),XXX,[Calculated]
,,
Enterprise Value ($M),"X,XXX",[Calculated]
,,
WACC CALCULATION,Weight,Cost,Contribution
Equity,XX.X%,X.X%,X.XX%
Debt,XX.X%,X.X%,X.XX%
,,
WEIGHTED AVERAGE COST OF CAPITAL,X.XX%,[Green output]
```

**關鍵 WACC 公式：**
```
Market Cap = Price × Shares
Net Debt = Total Debt - Cash
Enterprise Value = Market Cap + Net Debt
Equity Weight = Market Cap / EV
Debt Weight = Net Debt / EV
WACC = (Cost of Equity × Equity Weight) + (After-tax Cost of Debt × Debt Weight)
```

### 敏感度分析（DCF 表底部）

**術語提醒**：「靈敏度表」= 簡單的 2D 網格，每個資料單元格中包含行標題、列標題和公式。不是 Excel 的「資料表」功能（資料 → 假設分析 → 資料表）。您將使用 openpyxl 將常規 Excel 公式寫入每個儲存格中。

**位置**：DCF 工作表上的第 87 行以上（不是單獨的工作表）

**三個靈敏度表，垂直堆疊：**

1. **WACC 與最終增長**（第 87-100 行）- 5x5 網格 = 25 個帶有公式的單元格
2. **收入成長與息稅前利潤率**（第 102-115 行）- 5x5 網格 = 25 個帶有公式的單元格
3. **貝塔利率與無風險利率**（第 117-130 行）- 5x5 網格 = 25 個帶有公式的單元格

**要寫的公式總數：75**（這是必需的，不是可選的）

**關鍵**：所有靈敏度表單元格都必須使用 openpyxl 以程式設計方式使用公式填入。不要使用線性近似快捷方式。請勿留下有關手動步驟的佔位符文字或註釋。不要因為「這很複雜」而將單元格留空合理化 - 使用 Python 循環產生公式。

**桌子設定：**
1. 建立帶有行/列標題的表格結構（要測試的假設值）
2. 使用以下公式填充每個資料單元格：
   - 使用行標題值（例如，WACC = 9.0%）
   - 使用列標題值（例如，最終增長 = 3.0%）
   - 使用這些特定假設重新計算完整的 DCF
   - 傳回該場景的隱含股價
3. 所有單元格在交付時必須包含工作公式
4. 使用條件格式設定儲存格格式：綠色刻度表示較高值，紅色刻度表示較低值
5. 將基本狀況單元格加粗
6. 表之間保留 1-2 行空白

**無需手動幹預** - 當使用者開啟文件時，敏感度表必須完全發揮作用。

## 案例選擇器實施

**三種情況框架：**

### 熊箱
- 保守的收入成長（歷史範圍的低端）
- 邊際壓縮或不擴張
- 更高的 WACC（風險溢酬增加）
- 終端增長率較低
- 更高的資本支出假設

### 基本案例
- 共識或管理層指導收入成長
- 基於經營槓桿的適度利潤擴張
- 目前市場上隱含的WACC
- 與 GDP 掛鉤的終端成長 (2.5-3.0%)
- 標準資本支出假設

### 公牛案
- 樂觀的收入成長（預測的高端）
- 利潤率顯著擴大
- 較低的 WACC（降低風險溢酬）
- 更高的終端成長率（3.5-5.0%）
- 降低資本支出強度

**公式實作：**

**不要使用分散的巢狀 IF 公式。 ** 相反，建立一個使用 INDEX 或 OFFSET 公式從適當的場景區塊中提取的合併列。

**推薦模式（使用 INDEX）：**
`=INDEX(B10:D10, 1, $B$6)` 其中 `B10:D10` = 熊市/基礎/牛市值，`1` = 行偏移量，`$B$6` = 狀況選擇器單元格（1、2 或 3）

**然後在所有預測中引用合併列**：
`Revenue Year 1: =D29*(1+$E$10)` 其中 $E$10 是第一年增長的合併列值。

這種方法集中了場景邏輯，使模型更易於審核和維護。

## 可交付成果結構

**檔案命名**：`[Ticker]_DCF_Model_[Date].xlsx`

**兩頁**：
1. **DCF** - 帶有熊市/基本情況/牛市情況的完整模型 + 底部的三個敏感性表（WACC 與最終增長、收入增長與息稅前利潤率、貝塔與無風險利率）
2. **WACC** - 資本成本計算

**主要功能**：案例選擇器 (1/2/3)、帶有 INDEX/OFFSET 公式的合併列、顏色編碼單元格、所有輸入的單元格註釋、專業邊框

## 最佳實踐

### 模型建構
1. **增量構建**：在進入下一個部分之前完成每個部分
2. **建立測試**：輸入樣品編號以驗證公式
3. **使用一致的結構**：類似的計算遵循類似的模式
4. **註釋複雜的公式**：為不常見的計算添加註釋
5. **內建檢查**：適用時進行總和檢查和餘額檢查

### 文件
1. **記錄所有假設**：解釋關鍵輸入背後的推理
2. **引用資料來源**：注意每個資料點的來源
3. **解釋方法**：描述任何非標準方法
4. **標記不確定性**：突出顯示能見度有限的區域

### 品質管制
1. **交叉檢定計算**：以多種方式驗證數學
2. **壓力測試假設**：運行敏感性以確保模型穩健
3. **同儕審查**：讓其他人檢查公式
4. **版本控制**：隨著工作進度儲存版本

## 常見變化

### 高成長科技公司
- 更長的預測期（7-10年）
- 較高的初始成長率 (20-30%)
- 隨著時間的推移，利潤率顯著擴大
- 更高的 WACC（12-15%）
- 單位經濟模型（使用者、ARPU 等）

### 成熟/穩定的公司
- 較短的預測期（3-5年）
- 溫和成長率（GDP +1-3%）
- 利潤穩定
- 較低的 WACC（7-9%）
- 專注於現金產生和資本配置

### 週期性公司
- 經濟週期模型
- 週期中期利潤率標準化
- 考慮低谷和高峰場景
- 調整 Beta 值以適應週期性

### 多部門公司
- 每個業務部門都有單獨的 DCF
- 各細分市場的成長率和利潤率不同
- 部分總和估值
- 考慮協同效應

## 故障排除

**如果遇到錯誤或不合理的結果，請閱讀 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) 以獲得詳細的調試指導。 **

## 工作流程集成

### DCF 建置開始時

1. **收集市場數據**：
   - 檢查可用的 MCP 伺服器以取得當前市場數據
   - 使用網路搜尋/取得股票價格、貝塔值和其他市場指標
   - 如果需要特定數據，請向使用者要求

2. **收集歷史財務數據**：
   - 檢查可用的 MCP 伺服器（Daloopa 等）
   - 如果無法透過 MCP 獲取，則來自使用者的請求
   - 如有必要，手動從 10-K 中提取

3. **使用本技能中詳細介紹的 DCF 方法開始模型建構**

### 模型建構期間

1. **使用 openpyxl 和公式（不是硬編碼值）建立 Excel 模型**
2. **遵循 xlsx 技能約定**進行公式建置與格式化
3. **僅在使用者要求**或提供特定品牌指南時才套用填滿顏色

### 交付模型之前（強制）

1. **驗證結構**：
   - 熊市/基準/多頭市場的情境區塊以及跨預測年份的假設
   - 案例選擇器功能與引用正確場景區塊的公式
   - DCF 表底部的靈敏度表（不是單獨的表）
   - 字體顏色：藍色輸入、黑色公式、綠色工作表鏈接
   - 所有硬編碼輸入的儲存格註釋
   - 主要部分的專業邊界

2. **重新計算公式**：運行`python recalc.py model.xlsx 30`

3. **檢查輸出**：
   - 如果 `status` 為 `"success"` → 繼續步驟 4
   - 如果 `status` 是 `"errors_found"` → 檢查 `error_summary` 並閱讀 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) 以取得偵錯指導

4. **修復錯誤並重新運行 recalc.py** 直到狀態為“成功”

5. **抽查公式**：
   - 測試一個 FCF 公式 - 它是否引用了正確的假設行？
   - 更改案例選擇器 - 合併列是否正確更新？
   - 驗證收入公式引用合併列（不是巢狀 IF 公式）

6. **交付模型**

### 可用資料來源

- **MCP 伺服器**：如果配置（用於歷史財務的 Daloopa）
- **網路搜尋/取得**：用於當前股票價格、貝塔值和市場數據
- **使用者提供的資料**：歷史財務資料、共識估計
- **手動擷取**：SEC EDGAR 檔案作為後備

## 最終輸出清單

交付DCF模型之前：

**必填：**
- 運行 `python recalc.py model.xlsx 30` 直到狀態為“成功”（零公式錯誤）
- 兩兩：DCF（靈敏度在底部）、WACC
- 字體顏色：藍色=輸入，黑色=公式，綠色=工作表鏈接
- 所有硬編碼輸入的儲存格註釋
- 充滿公式的敏感度表
- 主要部分的專業邊界

**驗證：**
- 基於收入（而非毛利）的營運支出
- 終值 EV 的 50-70%
- 終端增長 < WACC
- 稅率21-28%
- 文件命名：`[Ticker]_DCF_Model_[Date].xlsx`
