使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# DCF 模型生成器

## 概述

这项技能可以根据投资银行标准创建机构质量的 DCF 模型，用于股权估值。每次分析都会生成详细的 Excel 模型（DCF 表底部包含敏感性分析）。

## 工具

- 默认使用用户提供的所有信息和可用于数据源的 MCP 服务器。

## 关键限制 - 首先阅读这些

这些约束适用于所有 DCF 模型构建。开始前回顾：

**环境：Office JS 与 Python/openpyxl：**
- **如果在 Excel 中运行（Office 加载项/Office JS 环境）：** 直接使用 Office JS — 不要使用 Python/openpyxl。通过`range.formulas = [["=D19*(1+$B$8)"]]`编写公式。无需单独的重新计算步骤； Excel 本身进行计算。使用 `range.format.*` 进行造型。相同的公式硬编码规则适用：对于派生单元格设置 `.formulas`，而不是 `.values`。
- **如果生成独立的 .xlsx 文件（无实时 Excel 会话）：** 如下所述使用 Python/openpyxl，然后在交付前运行 `recalc.py`。
- 该技能的其余部分使用 openpyxl 示例 - 在该环境中转换为 Office JS API 调用，但所有原则（公式字符串、单元格注释、部分检查点、敏感度表循环）都同样适用。

**⚠️ Office JS 合并单元格陷阱：** 使用合并单元格构建节标题时，请勿调用 `.merge()`，然后在合并范围上设置 `.values` — Office JS 仍会报告范围的原始尺寸并会抛出 `InvalidArgument: The number of rows or columns in the input array doesn't match the size or dimensions of the range`。相反，将值单独写入左上角的单元格，然后合并并格式化整个范围：

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

这适用于 DCF 中的每个合并部分标题（市场数据、情景块、现金流量预测、终值、估值摘要、敏感性表）。

**公式优于硬编码（不可协商）：**
- 每个预测、保证金、折扣因子、PV 和敏感度单元格都必须是实时 Excel 公式 — 绝不能是用 Python 计算并写为数字的值
- 使用openpyxl时：`ws["D20"] = "=D19*(1+$B$8)"`正确； `ws["D20"] = calculated_revenue` 是错误的
- 唯一允许的硬编码数字是：(1) 原始历史输入，(2) 假设驱动因素（增长率、WACC 输入、终端 g），(3) 当前市场数据（股价、债务余额）
- 如果你发现自己在用 Python 计算一些东西并写出结果——停下来。当用户改变假设时，模型必须进行调整。

**与用户一起逐步验证（不要构建端到端）：**
- 数据检索后→向用户显示原始输入块（收入、利润、股票、净债务）并在预测前确认
- 收入预测后→显示预计的收入和增长率，在建立利润率之前确认
- FCF构建后→显示完整的FCF时间表，在计算WACC之前确认逻辑
- WACC后→显示计算和输入，折扣前确认
- 终值+PV→显示权益桥（EV→权益价值→每股）后，在敏感度表前确认
- 在每个阶段捕获错误——建立敏感性表后发现错误的裕度假设意味着重建下游的所有内容

**灵敏度表：**
- **使用奇数行和列**（标准：5×5，有时 7×7）——这保证了真正的中心单元
- **中心单元 = 基本情况。** 构建轴值，使中间行标题和中间列标题完全等于模型的实际假设（例如，如果基本 WACC = 9.0%，则中间行为 9.0%；如果终端 g = 3.0%，则中间列为 3.0%）。因此，中心单元格的输出必须等于模型的实际隐含股价 - 这是表格正确构建的健全性检查。
- **使用中蓝色填充 (`#BDD7EE`) + 粗体突出显示中心单元格**，以便立即看到哪个单元格是基本情况。
- 使用完整的 DCF 重新计算公式填充所有单元格（通常为 3 个表 × 25 个单元格 = 75）
- 使用 openpyxl 循环（或 Office JS 循环）以编程方式编写公式
- 无需占位符文本，无需线性近似，无需手动步骤
- 每个单元必须重新计算该假设组合的完整 DCF

**细胞评论：**
- 创建每个硬编码值时添加单元格注释
- 格式：“来源：[系统/文档]、[日期]、[参考]、[URL（如果适用）”
- 在进入下一部分之前，每个蓝色输入都必须有注释
- 不要推迟结束或写“TODO：添加源”

**模型布局规划：**
- 在编写任何公式之前定义所有部分行位置
- 首先写入所有标题和标签
- 第二个写入所有节分隔符和空白行
- 然后使用锁定的行位置编写公式
- 创建后立即测试公式

**公式重新计算：**
- 发货前运行`python recalc.py model.xlsx 30`
- 修复所有错误，直到状态为“成功”
- 要求零公式错误（#REF!、#DIV/0!、#VALUE! 等）

**场景块：**
- 为空头/基本/牛市情况创建单独的块
- 在每个区块内水平显示跨预测年份的假设
- 使用 IF 公式：`=IF($B$6=1,[Bear cell],IF($B$6=2,[Base cell],[Bull cell]))`
- 验证公式引用正确的场景块单元格

## DCF 流程工作流程

### 第 1 步：数据检索和验证

从 MCP 服务器、用户提供的数据和 Web 获取数据。

**数据源优先级：**
1. **MCP 服务器**（如果配置）- 来自 Daloopa 等提供商的结构化财务数据
2. **用户提供的数据** - 他们研究的历史财务数据
3. **网络搜索/获取** - 当前价格、贝塔值、债务和现金（需要时）

**验证清单：**
- 验证净债务与净现金（对于估值至关重要）
- 确认稀释后的已发行股票（检查最近的回购/发行）
- 验证历史利润率与业务模式一致
- 与行业基准交叉检查收入增长率
- 验证税率是否合理（通常为 21-28%）

### 第2步：历史分析（3-5年）

分析并记录：
- **收入增长趋势**：计算复合年增长率，确定驱动因素
- **利润进展**：跟踪毛利率、息税前利润率、自由现金流利润率
- **资本强度**：D&A 和资本支出占收入的百分比
- **营运资本效率**：NWC随收入增长的百分比变化
- **回报指标**：ROIC、ROE 趋势

创建汇总表显示：
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

### 第 3 步：建立收入预测

**方法论：**
1. 从最新的实际收入开始（LTM 或最近的财政年度）
2. 应用每个预测年的增长率
3. 显示美元金额和计算的增长率

**增长率框架：**
- 第 1-2 年：更高的增长反映了近期的可见性
- 第 3-4 年：逐渐趋向行业平均水平
- 5年以上：接近终端增长率

**公式结构：**
- 收入（N 年）= 收入（N-1 年）×（1 + 增长率）
- 增长率（第 N 年）= 收入（第 N 年）/ 收入（第 N-1 年）- 1

**三种场景方法：**
```
Bear Case: Conservative growth (e.g., 8-12%)
Base Case: Most likely scenario (e.g., 12-16%)
Bull Case: Optimistic growth (e.g., 16-20%)
```

### 第 4 步：运营费用建模

**固定/可变成本分析：**

运营费用应模拟现实的运营杠杆：
- **销售和营销**：通常占收入的 15-40%，具体取决于业务模式
- **研发**：科技公司通常为 10-30%
- **一般和行政**：通常占收入的 8-15%，随着公司规模的扩大而发挥杠杆作用

**关键原则：**
- 所有百分比均基于收入，而非毛利润
- 模型运营杠杆：百分比应随着收入规模而下降
- 为 S&M、R&D、G&A 维护单独的行项目
- 计算 EBIT = 毛利润 - 总运营支出

**利润扩张框架：**
```
Current State → Target State (Year 5)
Gross Margin: X% → Y% (justify based on scale, efficiency)
EBIT Margin: X% → Y% (result of revenue growth + opex leverage)
```

### 第5步：自由现金流计算

**按正确的顺序构建 FCF：**

```
EBIT
(-) Taxes (EBIT × Tax Rate)
= NOPAT (Net Operating Profit After Tax)
(+) D&A (non-cash expense, % of revenue)
(-) CapEx (% of revenue, typically 4-8%)
(-) Δ NWC (change in working capital)
= Unlevered Free Cash Flow
```

**营运资金建模：**
- 计算为收入变化的百分比（增量收入）
- 典型范围：收入变化的 -2% 至 +2%
- 负数=现金来源（营运资金释放）
- 正数 = 现金使用量（营运资金建设）

**维护与增长资本支出：**
- 维护资本支出：维持当前运营（约 2-3% 收入）
- 增长资本支出：支持扩张（额外 2-5% 收入）
- 总资本支出应与公司的增长战略保持一致

### 第 6 步：资本成本 (WACC) 研究

**股本成本的 CAPM 方法：**

```
Cost of Equity = Risk-Free Rate + Beta × Equity Risk Premium

Where:
- Risk-Free Rate = Current 10-Year Treasury Yield
- Beta = 5-year monthly stock beta vs market index
- Equity Risk Premium = 5.0-6.0% (market standard)
```

**债务成本计算：**

```
After-Tax Cost of Debt = Pre-Tax Cost of Debt × (1 - Tax Rate)

Determine Pre-Tax Cost of Debt from:
- Credit rating (if available)
- Current yield on company bonds
- Interest expense / Total Debt from financials
```

**资本结构权重：**

```
Market Value Equity = Current Stock Price × Shares Outstanding
Net Debt = Total Debt - Cash & Equivalents
Enterprise Value = Market Cap + Net Debt

Equity Weight = Market Cap / Enterprise Value
Debt Weight = Net Debt / Enterprise Value

WACC = (Cost of Equity × Equity Weight) + (After-Tax Cost of Debt × Debt Weight)
```

**特殊情况：**
- **净现金头寸**：如果现金>债务，则净债务为负
  - 债务权重可能为负
  - WACC 计算相应调整
- **无债务**：WACC = 股本成本

**典型的 WACC 范围：**
- 大盘股，稳定：7-9%
- 成长型公司：9-12%
- 高增长/风险：12-15%

### 第 7 步：折扣率应用（5-10 年预测）

**年中大会：**
- 假设年中发生的现金流量
- 折扣期：0.5、1.5、2.5、3.5、4.5等
- 折扣系数 = 1 / (1 + WACC)^期间

**现值计算：**
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

**投影周期选择：**
- **5 年**：大多数分析的标准
- **7-10年**：具有更长跑道的高增长公司
- **3年**：成熟、稳定的业务

### 步骤8：终值计算

**永续增长法（首选）：**

```
Terminal FCF = Final Year FCF × (1 + Terminal Growth Rate)
Terminal Value = Terminal FCF / (WACC - Terminal Growth Rate)

Critical Constraint: Terminal Growth < WACC (otherwise infinite value)
```

**最终增长率选择：**
- 保守：2.0-2.5%（GDP增长率）
- 中等：2.5-3.5%
- 激进：3.5-5.0%（仅适用于市场领导者）

**不要超过**：无风险利率或长期GDP增长

**退出多种方法（替代）：**
```
Terminal Value = Final Year EBITDA × Exit Multiple

Where Exit Multiple comes from:
- Industry comparable trading multiples
- Precedent transaction multiples
- Typical range: 8-15x EBITDA
```

**终值现值：**
```
PV of Terminal Value = Terminal Value / (1 + WACC)^Final Period

Where Final Period accounts for timing:
5-year model with mid-year convention: Period = 4.5
```

**终端值健全性检查：**
- 应代表企业价值的 50-70%
- 如果 >75%，模型可能过度依赖最终假设
- 如果<40%，检查最终假设是否过于保守

### 第九步：企业与股权价值的桥梁

**估值概要结构：**

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

**关键调整：**
- **净债务 = 总债务 - 现金及等价物**
  - 如果为正：从 EV 中减去（减少股权价值）
  - 如果为负（净现金）：添加到 EV（增加股权价值）
- **使用稀释股份**：包括期权、RSU、可转换证券
- **其他调整**（如果适用）：
  - 少数利益
  - 养老金负债
  - 经营租赁义务

**评估输出格式：**
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

### 第10步：敏感性分析

在贴现现金流表的底部构建**三个敏感性表**，显示不同假设下估值如何变化：

1. **WACC 与终端增长** - 显示企业价值对贴现率和永续增长的敏感性
2. **收入增长与息税前利润率** - 显示收入增长和运营杠杆的影响
3. **贝塔利率与无风险利率** - 显示对权益成分成本的敏感性

**实现**：这些是简单的 2D 网格（不是 Excel 的“数据表”功能），每个单元格中都有公式。每个单元格必须包含针对该特定假设组合的完整 DCF 重新计算。请参阅“关键约束”部分，了解使用 openpyxl 以编程方式填充所有 75 个单元格的详细要求。

<correct_patterns>

本节包含构建 DCF 模型时要遵循的所有正确模式。

### 场景块选择模式 - 遵循此方法

**针对每个场景，假设被组织在单独的块中：**

**关键结构 - 每个节标题三行：**

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

**每个场景块必须有一个列标题行**，在部分标题的正下方显示预测年份（FY2025E、FY2026E 等）。如果没有这个，用户就无法判断哪个假设值对应于哪一年。

**如何引用假设 - 创建合并列：**
1. 案例选择器单元格（例如 B6）包含 1=Bear、2=Base 或 3=Bull
2. 使用 INDEX 或 OFFSET 公式创建合并列以从正确的场景块中提取
3. 投影公式引用合并列（干净的单元格引用）
4. 每个情景块包含跨预测年份的全套 DCF 假设

**推荐的合并列模式（使用 INDEX）：**
`=INDEX(B10:D10, 1, $B$6)`

**不是这个 - 散布在各处的 IF 语句：**
`=IF($B$6=1,[Bear block cell],IF($B$6=2,[Base block cell],[Bull block cell]))`

合并列方法集中了逻辑并使模型更易于审核。

### 正确的收入预测模式

**使用 INDEX 公式创建合并列，然后在投影中引用它：**

**第 1 步 - 第一财年增长的合并栏：**
`=INDEX([Bear FY1 growth]:[Bull FY1 growth], 1, $B$6)`

**步骤 2 - 收入预测参考合并列：**
`Revenue Year 1: =D29*(1+$E$10)`

其中：
- D29 = 上一年收入
- $E$10 = FY1 增长的合并列单元格（包含 INDEX 公式）
- $B$6 = 案例选择器（1=熊市，2=基础，3=牛市）

**这种方法比在每个预测公式中嵌入 IF 语句更清晰**，并且可以更轻松地审核正在使用的场景假设。

### 正确的 FCF 公式模式

**使用带有 INDEX 公式的合并列，然后在 FCF 计算中引用它们：**

**合并柱方法：**
```csv
Item,Formula,Reference
D&A,=E29*$E$21,$E$21 = consolidation column for D&A %
CapEx,=E29*$E$22,$E$22 = consolidation column for CapEx %
Δ NWC,=(E29-D29)*$E$23,$E$23 = consolidation column for NWC %
Unlevered FCF,=E57+E58-E60-E62,E57=NOPAT E58=D&A E60=CapEx E62=Δ NWC
```

**每个合并列单元格都包含一个 INDEX 公式**，该公式根据案例选择器从适当的场景块中提取。这使投影公式保持干净且可审计。

在编写公式之前，请确认场景块行位置并设置合并列。

### 正确的单元格注释格式

**每个硬编码值都需要这种格式：**

“来源：[系统/文档]、[日期]、[参考]、[URL（如果适用）”

**示例：**
```csv
Item,Source Comment
Stock price,Source: Market data script 2025-10-12 Close price
Shares outstanding,Source: 10-K FY2024 Page 45 Note 12
Historical revenue,Source: 10-K FY2024 Page 32 Consolidated Statements
Beta,Source: Market data script 2025-10-12 5-year monthly beta
Consensus estimates,Source: Management guidance Q3 2024 earnings call
```

### 正确的假设表结构

**关键：每个场景块需要三个结构元素：**

1. **节标题行**（合并单元格）：例如“BEAR CASE ASSUMPTIONS”
2. **列标题行**显示年份 - 这是必需的，请勿跳过
3. **数据行** 与假设值

**结构：**
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

**如果列标题行没有显示预测年份（FY2025E、FY2026E 等），用户无法判断哪个假设值对应于哪个年份。此行是强制性的。**

**然后创建一个合并列**（通常是右侧的下一列），该列使用 INDEX 公式根据案例选择器从选定的场景块中提取。此合并列是您的投影公式引用的内容。

### 正确的行规划过程

**1.首先写入所有标题和标签：**
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

**2.写入所有节分隔线和空白行**

**3.然后使用锁定的行位置编写公式**

**4.创建后立即测试公式**

**把它想象成建筑：**
- 好：浇筑地基，然后建造墙壁（结构稳定）
- 坏：先建墙，然后浇地基（墙倒塌）

**Excel版本：**
- 好：添加标题，然后编写公式（公式稳定）
- 不好：编写公式，然后添加标题（公式中断）

### 正确的灵敏度表实施

**重要**：这些不是 Excel 的“数据表”功能。这些是简单的网格，您可以在其中使用 openpyxl 编写常规公式。是的，这意味着总共大约 75 个公式（每个表格 3 个表格 × 25 个单元格），但这是简单且必需的。

**使用公式进行程序化填充：**

每个敏感性表必须完全填充公式，以重新计算每种假设组合的隐含股价。 **不要使用Excel的数据表功能**（它需要手动干预，并且无法通过openpyxl自动化）。

**实施方法 - 具体示例：**

**表格结构 - 5×5 网格（ODD 尺寸，基本案例居中）：**

如果模型的基础 WACC = 9.0% 且基础终端增长率 = 3.0%，则围绕这些值对称构建轴：

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

**★ = 中心单元格。** 其公式输出必须等于模型的实际隐含股价（来自估值摘要）。对此单元格应用中蓝色填充 (`#BDD7EE`) 和粗体字体，以便在视觉上锚定基本情况。

**轴值规则：** `axis_values = [base - 2*step, base - step, base, base + step, base + 2*step]` — 围绕底座对称，奇数计数保证中心。

**配方模式 - B88 细胞（WACC=8.0%，最终生长=2.0%）：**

B88 中的公式应使用以下方法重新计算隐含价格：
- 行标题中的 WACC：`$A88` (8.0%)
- 列标题的最终增长：`B$87` (2.0%)

**推荐方法：** 参考主要 DCF 计算，但替换这些值。

**公式结构示例：**
`=([SUM of PV FCFs using $A88 as discount rate] + [Terminal Value using B$87 as growth rate and $A88 as WACC] - [Net Debt]) / [Shares]`

**关键 - 为 5x5 网格中的每个单元格编写公式（每个表 25 个单元格，总共 75 个单元格）。** 使用 openpyxl 以编程方式在循环中编写这些公式。不要跳过此步骤或留下占位符文本。

**Python实现模式：**
```python
# Pseudocode for populating sensitivity table
for row_idx, wacc_value in enumerate(wacc_range):
    for col_idx, term_growth_value in enumerate(term_growth_range):
        # Build formula that uses wacc_value and term_growth_value
        formula = f"=<DCF recalc using {wacc_value} and {term_growth_value}>"
        ws.cell(row=start_row+row_idx, column=start_col+col_idx).value = formula
```

**打开模型后，灵敏度表必须立即起作用，无需用户执行手动步骤。**

</correct_patterns>

<common_mistakes>

本节包含构建 DCF 模型时要避免的所有错误模式。

### 错误：简化的灵敏度表近似值或占位符文本

**不要使用线性近似：**

```
// WRONG - Linear approximation
B97: =B88*(1+(0.096-0.116))    // Assumes linear relationship

// WRONG - Division shortcut
B105: =B88/(1+(E48-0.07))      // Doesn't recalculate full DCF
```

**不要留下占位符文本：**
```
// WRONG - Placeholder note
"Note: Use Excel Data Table feature (Data → What-If Analysis → Data Table) to populate sensitivity tables."

// WRONG - Empty cells
[leaving cells blank because "this is complex"]
```

**不要混淆术语：**
- ❌“灵敏度表需要 Excel 的数据表功能”（否 - 这是我们无法使用的特定 Excel 工具）
- ✅“敏感性表是简单的网格，每个单元格中都有公式”（是的 - 这就是我们构建的）

**为什么这些快捷键是错误的：**
- 线性近似公式实际上并不重新计算 DCF - 它们只是应用简单的数学调整
- 关系不是线性的，因此结果不准确
- 占位符文本需要用户手动干预
- 模型交付后不能立即使用
- 不专业或不适合客户
- 空单元格 = 不完整的可交付成果

**拒绝的常见合理化：**
“编写 75 个以上的公式感觉很复杂，所以我会留下注释，让用户手动完成。”

**现实：** 当您在 Python 中通过 openpyxl 使用循环时，编写 75 个公式非常简单。每个公式都遵循相同的模式 - 只需替换行/列值。这是可交付成果的必需部分。

**相反：** 使用公式填充每个敏感度单元格，重新计算该特定假设组合的完整 DCF

### 错误：缺少单元格注释

**不要这样做：**
- 创建所有不带注释的硬编码输入
- 认为“我稍后会添加它们”
- 写入“TODO：添加源”
- 留下蓝色输入而没有文档

**为什么错误：**
- 无法验证数据来自哪里
- 未达到 xlsx 技能要求
- 尚未做好审核准备
- 浪费时间稍后修复

**相反：** 在创建每个硬编码值时添加单元格注释

### 错误：公式行引用关闭

**症状：**
FCF 部分引用了错误的假设行：
`D&A:  =E29*$E$34    // Should be $E$21, but referencing wrong row`
`CapEx: =E29*$E$41   // Should be $E$22, but row shifted`

**为什么会发生这种情况：**
1. 先写公式
2. 然后插入标题
3. 所有行引用均已移动
4. 现在公式指向错误的单元格→#REF！错误

**相反：** 首先锁定行布局，然后编写公式

### 错误：跨场景的每个假设都是单行

**不要构建这样的假设：**
```csv
Assumption,Bear,Base,Bull
Revenue Growth FY1,10%,13%,16%
Revenue Growth FY2,9%,12%,15%
```
这种垂直布局使得很难看到每个场景中多年来的进展。

**为什么错误：**
- 很难看出每个场景中的假设多年来的演变
- 更难比较整个预测期间的情景假设
- 审查场景逻辑不太直观

**相反：**
- 为每个场景创建单独的块（Bear、Base、Bull）
- 在每个块中，水平显示跨预测年份的假设
- 这使得每个场景的假设更容易作为一个有凝聚力的集合进行审查

### 错误：无国界

**不要提供无边界的模型：**
- 无剖面划分
- 所有细胞混合在一起
- 难以阅读且不专业

**为什么错误：**
- 尚未为客户做好准备
- 难以导航
- 看起来很业余

**相反：** 在所有主要部分周围添加边框

### 错误：字体颜色错误或没有字体颜色区别

**不要这样做：**
- 所有文字均为黑色
- 仅使用填充颜色（不更改字体颜色）
- 混淆哪些细胞是蓝色的，哪些是黑色的

**为什么错误：**
- 无法区分输入和公式
- 审计变得不可能
- 违反 xlsx 技能要求

**相反：** 蓝色文本表示所有硬编码输入，黑色文本表示所有公式，绿色文本表示工作表链接

### 错误：基于毛利润的运营费用

**不要这样做：**
`S&M: =E33*0.15    // E33 = Gross Profit (WRONG)`

**为什么错误：**
- 运营费用与收入而非毛利润成正比
- 产生不切实际的利润进展
- 不是企业实际运作的方式

**相反：**
`S&M: =E29*0.15    // E29 = Revenue (CORRECT)`

### 前 5 个错误摘要

1. **公式行引用关闭** → 在编写公式之前定义所有行位置
2. **缺少单元格注释** → 添加注释是在单元格创建时而不是在结束时添加的
3. **简化的灵敏度表** → 使用完整的 DCF 重新计算公式（而不是近似值）填充所有单元格
4. **场景块引用错误** → 确保 IF 公式从正确的 Bear/Base/Bull 块中提取
5. **无边框** → 添加专业的部分边框，以实现客户就绪的外观

此外，请注意以下错误：

### WACC 计算错误
- 在资本结构中混合账面价值和市场价值
- 错误地使用权益贝塔而不是资产/无杠杆贝塔
- 债务成本的税率应用错误
- 无风险利率不正确（必须使用当前10年期国库券）
- 未能调整净债务与净现金头寸

### 增长假设的缺陷
- 终端增长>WACC（创造无限价值）
- 预测增长率与历史表现不一致
- 忽视行业增长限制
- 收入增长与单位经济效益不相符
- 没有运营理由的利润扩张

### 终值错误
- 使用错误的增长方法（永续与退出倍数）
- 最终价值>企业价值的80%（表明过度依赖）
- 终端利润与稳态假设不一致
- 终值贴现期错误

### 现金流量预测错误
- 营业费用基于毛利润而不是收入
- D&A/资本支出百分比与业务模式不一致
- 营运资金变化未正确计算
- 年份之间的税率不一致
- NOPAT 计算错误

**这些错误是最常见的。在开始任何 DCF 构建之前请重新阅读本节。**

</common_mistakes>

## Excel 文件创建

**此技能将 `xlsx` 技能用于所有电子表格操作。** xlsx 技能提供：
- 标准化公式构建规则
- 数字格式约定
- 通过 `recalc.py` 脚本自动重新计算公式
- 全面的错误检查和验证

此技能创建的所有 Excel 文件都必须遵循 xlsx 技能要求，包括零公式错误和正确的重新计算。

## 质量评价标准

每个 DCF 模型必须最大化：
1. **基于历史业绩的实际收入和利润假设**
2. **采用适当的 CAPM 方法计算适当的资本成本**
3. **全面的敏感性分析**显示估值范围
4. **清晰的终值计算**并附有支持理由
5. **专业的模型结构**赋能场景分析
6. 所有关键假设的**透明文档**

## 输入要求

### 所需的最低输入
1. **公司标识符**：股票代码或公司名称
2. **增长假设**：预测期内的收入增长率（或“使用共识”）
3. **可选参数**：
   - 预测期（默认：5年）
   - 情景案例（熊市/基准/牛市增长和利润率假设）
   - 终端增长率（默认：2.5-3.0%）
   - 如果不使用 CAPM，则特定 WACC 输入

## Excel 模型结构

### 片材架构

创建**两张表**：

1. **DCF** - 主要估值模型，底部带有敏感性分析
2. **WACC** - 资本成本计算

**重要**：灵敏度表位于 DCF 表的底部（而不是在单独的表上）。这将所有估值输出放在一起。

### 公式重新计算（强制）

创建或修改 Excel 模型后，使用 xlsx 技能中的 recalc.py 脚本**重新计算所有公式**：

```bash
python recalc.py [path_to_excel_file] [timeout_seconds]
```

示例：
```bash
python recalc.py AAPL_DCF_Model_2025-10-12.xlsx 30
```

该脚本将：
- 使用 LibreOffice 重新计算所有工作表中的所有公式
- 扫描所有单元格是否存在 Excel 错误（#REF!、#DIV/0!、#VALUE!、#NAME?、#NULL!、#NUM!、#N/A）
- 返回包含错误位置和计数的详细 JSON

**预期输出格式：**
```json
{
  "status": "success",           // or "errors_found"
  "total_errors": 0,              // Total error count
  "total_formulas": 42,           // Number of formulas in file
  "error_summary": {}             // Only present if errors found
}
```

**如果发现错误**，输出将包括详细信息：
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

**修复所有错误**并重新运行 recalc.py 直到状态为“成功”，然后再交付模型。

### 格式化标准

**重要**：遵循 xlsx 技巧来了解公式构造规则和数字格式约定。 DCF技能增加了特定的视觉呈现标准。

**配色方案 - 两层**：

**第 1 层：字体颜色（xlsx 技能强制）**
- **蓝色文本（RGB：0,0,255）**：所有硬编码输入（股票价格、股份、历史数据、假设）
- **黑色文本（RGB：0,0,0）**：所有公式和计算
- **绿色文本（RGB：0,128,0）**：其他工作表的链接（WACC 工作表参考）

**第 2 层：填充颜色 - 专业蓝色/灰色调色板（默认值，除非用户另有指定）**
- **保持最小化** - 仅使用蓝色和灰色进行填充。不要引入绿色、黄色、橙色或多种强调色。颜色太多的模型看起来很业余。
- **默认填充调色板：**
  - **节标题**：深蓝色（RGB：31,78,121 / `#1F4E79`）背景，白色粗体文本
  - **子标题/列标题**：浅蓝色（RGB：217,225,242 / `#D9E1F2`）背景，黑色粗体文本
  - **输入单元格**：浅灰色（RGB：242,242,242 / `#F2F2F2`）背景与蓝色字体 - 或者如果您想要最大程度的极简主义，则只需白色与蓝色字体
  - **计算单元格**：白色背景黑色字体
  - **输出/摘要行**（每股价值、EV 等）：中蓝色（RGB：189,215,238 / `#BDD7EE`）背景，黑色粗体字体
- **就是这样 - 3 个蓝色 + 1 个灰色 + 白色。** 抵制添加更多的冲动。
- 用户提供的模板或明确的颜色首选项始终会覆盖这些默认值。

**各层如何协同工作：**
- 输入单元格：蓝色字体+浅灰色填充=“硬编码输入”
- 公式单元格：黑色字体+白色背景=“计算值”
- 工作表链接：绿色字体+白色背景=“参考另一张工作表”
- 主要输出：黑色粗体+中蓝色填充=“这就是答案”

**字体颜色告诉您它是什么（输入/公式/链接）。填充颜色告诉你你在哪里（标题/数据/输出）。**

### 边界标准（专业外观所需）

**主要部分周围的粗边框** (1.5pt)：
- 按键输入部分
- 投影假设部分
- 5 年现金流量预测部分
- 终端值部分
- 估值摘要部分
- 每个敏感性分析表

**小节之间的中边框** (1pt)：
- 公司详情与历史业绩
- 增长假设 vs 息税前利润率 vs FCF 参数

**数据表周围的细边框** (0.5pt)：
- 情景假设表（选择熊市 | 基础 | 牛市 |）
- 历史与预计财务矩阵

**无边框：** 表格内的各个单元格（保持干净、可扫描）

**边框是强制性的** - 没有专业边框的模型不适合客户。

**数字格式**（遵循 xlsx 技能标准）：
- **年**：格式为文本字符串（例如“2024”而不是“2,024”）
- **百分比**：`0.0%`（一位小数）
- **货币**：`$#,##0` 为百万； `$#,##0.00` 每股 - 始终在标题中指定单位（“收入 ($mm)”）
- **零**：使用数字格式将所有零设为“-”（例如，`$#,##0;($#,##0);-`）
- **大数字**：`#,##0` 带千位分隔符
- **负数**：`(#,##0)` 放在括号中（不是减号）

**单元格注释（所有硬编码输入均强制）**：

根据 xlsx 技能，所有硬编码值都必须具有记录源的单元格注释。格式：“来源：[系统/文档]、[日期]、[参考]、[URL（如果适用）”

**重要**：在创建细胞时添加注释。不要推迟到最后。

### DCF板材详细结构

**第 1 部分：标题**
```csv
Row,Content
1,[Company Name] DCF Model
2,Ticker: [XXX] | Date: [Date] | Year End: [FYE]
3,Blank
4,Case Selector Cell (1=Bear 2=Base 3=Bull)
5,Case Name Display (formula: =IF([Selector]=1"Bear"IF([Selector]=2"Base""Bull")))
```

**第 2 部分：市场数据（不依赖于具体情况）**
```csv
Item,Value
Current Stock Price,$XX.XX
Shares Outstanding (M),XX.X
Market Cap ($M),[Formula]
Net Debt ($M),XXX [or Net Cash if negative]
```

**第 3 节：DCF 情景假设**

使用 DCF 特定假设（收入增长率 %、息税前利润率 %、税率 %、D&A 占收入的 %、资本支出占收入的 %、NWC 变化 ΔRev 的百分比、终端增长率、WACC）为每个情景（熊市、基础、牛市）创建单独的假设块，并在预测年份中横向排列。每个块必须包括节标题、显示预测年份（FY1、FY2 等）的列标题行和数据行。有关确切的布局，请参阅 `<correct_patterns>` 部分“正确的假设表结构”。

**第 4 节：历史和预计财务状况**

**引用从场景块中提取的合并列（例如“选定案例”）**，而不是每个投影行中分散的 IF 公式。

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

**关键公式模式**：
- 收入增长：`=E29*(1+$E$10)` 其中 10 美元是第一年增长的合并栏
- 不是：`=E29*(1+IF($B$6=1,$B$10,IF($B$6=2,$C$10,$D$10)))`

这种方法更干净、更容易审核，并通过集中场景逻辑来防止公式错误。

**第 5 节：自由现金流建设**

**关键**：验证行引用指向正确的假设行。创建后立即测试公式。

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

**行参考示例**（基于布局规划）：
- $E$21 = D&A % 假设（合并列，第 21 行）
- $E$22 = 资本支出百分比假设（合并列，第 22 行）
- $E$23 = NWC % 假设（合并列，第 23 行）
- E29 = 年收入（第 29 行）
- E45 = 年份 NOPAT（第 45 行）

**在编写公式之前**：确认这些行号与实际布局匹配。测试一列，然后复制。

**第 6 节：贴现与估价**
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

### WACC 板材结构

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

**关键 WACC 公式：**
```
Market Cap = Price × Shares
Net Debt = Total Debt - Cash
Enterprise Value = Market Cap + Net Debt
Equity Weight = Market Cap / EV
Debt Weight = Net Debt / EV
WACC = (Cost of Equity × Equity Weight) + (After-tax Cost of Debt × Debt Weight)
```

### 敏感性分析（DCF 表底部）

**术语提醒**：“灵敏度表”= 简单的 2D 网格，每个数据单元格中包含行标题、列标题和公式。不是 Excel 的“数据表”功能（数据 → 假设分析 → 数据表）。您将使用 openpyxl 将常规 Excel 公式写入每个单元格中。

**位置**：DCF 工作表上的第 87 行以上（不是单独的工作表）

**三个灵敏度表，垂直堆叠：**

1. **WACC 与最终增长**（第 87-100 行）- 5x5 网格 = 25 个带有公式的单元格
2. **收入增长与息税前利润率**（第 102-115 行）- 5x5 网格 = 25 个带有公式的单元格
3. **贝塔利率与无风险利率**（第 117-130 行）- 5x5 网格 = 25 个带有公式的单元格

**要编写的公式总数：75**（这是必需的，不是可选的）

**关键**：所有灵敏度表单元格都必须使用 openpyxl 以编程方式使用公式填充。不要使用线性近似快捷方式。请勿留下有关手动步骤的占位符文本或注释。不要因为“这很复杂”而将单元格留空合理化 - 使用 Python 循环生成公式。

**桌子设置：**
1. 创建带有行/列标题的表结构（要测试的假设值）
2. 使用以下公式填充每个数据单元格：
   - 使用行标题值（例如，WACC = 9.0%）
   - 使用列标题值（例如，最终增长 = 3.0%）
   - 使用这些特定假设重新计算完整的 DCF
   - 返回该场景的隐含股价
3. 所有单元格在交付时必须包含工作公式
4. 使用条件格式设置单元格格式：绿色刻度表示较高值，红色刻度表示较低值
5. 将基本情况单元格加粗
6. 表之间保留 1-2 行空白

**无需手动干预** - 当用户打开文件时，敏感度表必须完全发挥作用。

## 案例选择器实施

**三种情况框架：**

### 熊箱
- 保守的收入增长（历史范围的低端）
- 边际压缩或不扩张
- 更高的 WACC（风险溢价增加）
- 终端增长率较低
- 更高的资本支出假设

### 基本案例
- 共识或管理层指导收入增长
- 基于经营杠杆的适度利润扩张
- 当前市场隐含的WACC
- 与 GDP 挂钩的终端增长 (2.5-3.0%)
- 标准资本支出假设

### 公牛案
- 乐观的收入增长（预测的高端）
- 利润率显着扩大
- 较低的 WACC（降低风险溢价）
- 更高的终端增长率（3.5-5.0%）
- 降低资本支出强度

**公式实现：**

**不要使用分散的嵌套 IF 公式。** 相反，创建一个使用 INDEX 或 OFFSET 公式从适当的场景块中提取的合并列。

**推荐模式（使用 INDEX）：**
`=INDEX(B10:D10, 1, $B$6)` 其中 `B10:D10` = 熊市/基础/牛市值，`1` = 行偏移量，`$B$6` = 情况选择器单元格（1、2 或 3）

**然后在所有预测中引用合并列**：
`Revenue Year 1: =D29*(1+$E$10)` 其中 $E$10 是第一年增长的合并列值。

这种方法集中了场景逻辑，使模型更易于审核和维护。

## 可交付成果结构

**文件命名**：`[Ticker]_DCF_Model_[Date].xlsx`

**两页**：
1. **DCF** - 带有熊市/基本情况/牛市情况的完整模型 + 底部的三个敏感性表（WACC 与最终增长、收入增长与息税前利润率、贝塔与无风险利率）
2. **WACC** - 资本成本计算

**主要功能**：案例选择器 (1/2/3)、带有 INDEX/OFFSET 公式的合并列、颜色编码单元格、所有输入的单元格注释、专业边框

## 最佳实践

### 模型构建
1. **增量构建**：在进入下一个部分之前完成每个部分
2. **构建测试**：输入样品编号以验证公式
3. **使用一致的结构**：类似的计算遵循类似的模式
4. **注释复杂的公式**：为不常见的计算添加注释
5. **内置检查**：适用时进行总和检查和余额检查

### 文档
1. **记录所有假设**：解释关键输入背后的推理
2. **引用数据源**：注意每个数据点的来源
3. **解释方法**：描述任何非标准方法
4. **标记不确定性**：突出显示能见度有限的区域

### 质量控制
1. **交叉检查计算**：以多种方式验证数学
2. **压力测试假设**：运行敏感性以确保模型稳健
3. **同行评审**：让其他人检查公式
4. **版本控制**：随着工作进展保存版本

## 常见变化

### 高增长科技公司
- 更长的预测期（7-10年）
- 较高的初始增长率 (20-30%)
- 随着时间的推移，利润率显着扩大
- 更高的 WACC（12-15%）
- 单位经济模型（用户、ARPU 等）

### 成熟/稳定的公司
- 更短的预测期（3-5年）
- 温和增长率（GDP +1-3%）
- 利润稳定
- 较低的 WACC（7-9%）
- 专注于现金生成和资本配置

### 周期性公司
- 经济周期模型
- 周期中期利润率标准化
- 考虑低谷和高峰场景
- 调整 Beta 值以适应周期性

### 多部门公司
- 每个业务部门都有单独的 DCF
- 各细分市场的增长率和利润率不同
- 部分总和估值
- 考虑协同效应

## 故障排除

**如果遇到错误或不合理的结果，请阅读 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) 获取详细的调试指导。**

## 工作流程集成

### DCF 构建开始时

1. **收集市场数据**：
   - 检查可用的 MCP 服务器以获取当前市场数据
   - 使用网络搜索/获取股票价格、贝塔值和其他市场指标
   - 如果需要特定数据，请向用户请求

2. **收集历史财务数据**：
   - 检查可用的 MCP 服务器（Daloopa 等）
   - 如果无法通过 MCP 获取，则来自用户的请求
   - 如有必要，手动从 10-K 中提取

3. **使用本技能中详细介绍的 DCF 方法开始模型构建**

### 模型构建期间

1. **使用 openpyxl 和公式（不是硬编码值）构建 Excel 模型**
2. **遵循 xlsx 技能约定**进行公式构建和格式化
3. **仅在用户要求**或提供特定品牌指南时才应用填充颜色

### 交付模型之前（强制）

1. **验证结构**：
   - 熊市/基准/牛市的情景块以及跨预测年份的假设
   - 案例选择器功能与引用正确场景块的公式
   - DCF 表底部的灵敏度表（不是单独的表）
   - 字体颜色：蓝色输入、黑色公式、绿色工作表链接
   - 所有硬编码输入的单元格注释
   - 主要部分的专业边界

2. **重新计算公式**：运行`python recalc.py model.xlsx 30`

3. **检查输出**：
   - 如果 `status` 为 `"success"` → 继续步骤 4
   - 如果 `status` 是 `"errors_found"` → 检查 `error_summary` 并阅读 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) 以获得调试指导

4. **修复错误并重新运行 recalc.py** 直到状态为“成功”

5. **抽查公式**：
   - 测试一个 FCF 公式 - 它是否引用了正确的假设行？
   - 更改案例选择器 - 合并列是否正确更新？
   - 验证收入公式引用合并列（不是嵌套 IF 公式）

6. **交付模型**

### 可用数据源

- **MCP 服务器**：如果配置（用于历史财务的 Daloopa）
- **网络搜索/获取**：用于当前股票价格、贝塔值和市场数据
- **用户提供的数据**：历史财务数据、共识估计
- **手动提取**：SEC EDGAR 文件作为后备

## 最终输出清单

交付DCF模型之前：

**必填：**
- 运行 `python recalc.py model.xlsx 30` 直到状态为“成功”（零公式错误）
- 两张：DCF（灵敏度在底部）、WACC
- 字体颜色：蓝色=输入，黑色=公式，绿色=工作表链接
- 所有硬编码输入的单元格注释
- 充满公式的敏感度表
- 主要部分的专业边界

**验证：**
- 基于收入（而非毛利润）的运营支出
- 终值 EV 的 50-70%
- 终端增长 < WACC
- 税率21-28%
- 文件命名：`[Ticker]_DCF_Model_[Date].xlsx`
