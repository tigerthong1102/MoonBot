使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。


# 创建、编辑和分析 XLSX

| 任务 | 方法 |
|---|---|
| 使用公式和格式**创建**或**编辑** | `openpyxl` — 参见下方注意事项 |
| **批量导入或导出数据** | `pandas`（`read_excel`、`to_excel`） |
| **快速查看**工作表 | `markitdown file.xlsx` — 每个工作表对应 `## SheetName`；也可读取 `.xlsm`。没有单元格坐标，因此不要据此规划编辑 |
| **读取**模型（公式*和*值） | 两次 `load_workbook` — 参见注意事项 |

> 首先确认可用的电子表格工具和依赖。已配置的 Mac 上，`startupbot-python` 解释器包含 openpyxl。否则使用已配置的文档工具或现有 Python 环境。缺少依赖时应说明。

> 以下脚本路径相对于此技能目录。

## 所有输出的要求

- 除非用户另有要求，全表使用**专业字体**（Arial、Times New Roman）。
- **零公式错误。** `recalc.py` 报告 `errors_found` 时不得交付，唯一例外见下方 `not_computed`。如认为错误原已存在，必须证明：用 `data_only=True` 打开*原文件*并检查该单元格。新引入的错误与原有错误看起来完全一样。
- **使用公式，不硬编码计算结果。** 写入 `sheet['B10'] = '=SUM(B2:B9)'`，不要写入 Python 算出的总和。输入变化时工作表必须重新计算。
- **严格遵循用户规格。** 工作表名称、列标题和指定公式都要准确。即使重新设计更美观，只要计算了不同内容就不合格。
- **记录每个假设和硬编码数字**，放在读者可见的位置：单元格批注或表格末尾相邻单元格。有真实来源时注明（`Source: Company 10-K, FY2024, Page 45, Revenue Note, [SEC EDGAR URL]`）；数字来自用户时明确说明。
- **为别人填写而新建的工作簿**需要简短图例说明可编辑单元格，并给出一行合理的示例值展示格式。不要向只要求编辑的现有文件添加此行。
- **编辑现有文件时严格遵循原有约定**，优先于本指南。先找到指定输入单元格，通常以不同字体颜色、填充或底纹标记；只写入这些单元格，保留所有现有公式。

## 重新计算公式

具备所需 Python 依赖和 LibreOffice 时使用随附的重算工具。无法重算时保留工作簿，并明确报告公式结果未经验证。

openpyxl 把公式写成字符串，**没有缓存值**。重算前，读取缓存值的工具（包括 `pandas`、`load_workbook(data_only=True)` 和大多数预览器）会把公式单元格读作 `None`。

```bash
python <skill-directory>/scripts/recalc.py output.xlsx [timeout_seconds]   # default 30
```

LibreOffice 在**副本上**计算公式，仅将值写入文件，并返回 JSON：`status`（`success` | `errors_found`）、`total_formulas`、`total_errors` 和 `error_summary`，每类错误最多列出 100 个单元格（`locations_truncated` 表示省略数量；以 `total_errors` 为准，而非列表长度）。修复后重新运行。**JSON 有 `error` 而非 `status` 表示没有执行重算**；只有这种情况返回非零状态，`errors_found` 返回 0，所以不能把正常退出当成工作簿无误。

**重算成功只能证明公式*能计算*，不能证明*计算正确*。** 范围偏移一格或引用错误行都可能无报错但结果错误。先写 2–3 个公式并检查是否取到预期值，再扩展到整个区域。

**`not_computed` 列出 LibreOffice 无法计算的公式，即使结果为 `success` 也如此**：包括不支持的函数（`_xlfn.XLOOKUP`、`_xlfn.LET`…）和其他工作簿的链接（`='[1]Returns Analysis'!$B$2`）。它们保留原有值；openpyxl 保存后在 Excel 打开前没有值。如需提前查看数字，用 `data_only=True` 读取原文件并保留公式。正确公式若直接或间接依赖列表中的公式，也会报 `#NAME?`：保留并告知用户。测试此类单元格的公式（`IFERROR(B1,0)`）会得到 LibreOffice 的后备值，保留的值可能过期，应说明。编辑工作表 XML 后，删除每个变更公式的 `<v>`：保留了值的错误会被列入列表，而不是作为错误报告。

## 选择便于验证的公式

LibreOffice 支持的函数少于 Excel；不能计算的公式在 Excel 打开前没有值。

- **优先使用 Excel 2007 时期的函数** — `SUMIFS`、`INDEX`、`MATCH`、`IFERROR`、`SUMPRODUCT` — 无需前缀。
- **六个 2007 年后函数只有带 `_xlfn.` 前缀才能工作**，因为 openpyxl 原样写入 XML，而 Excel 存储新函数名称时带前缀（界面隐藏该前缀）：`_xlfn.TEXTJOIN`、`_xlfn.CONCAT`、`_xlfn.IFS`、`_xlfn.SWITCH`、`_xlfn.MAXIFS`、`_xlfn.MINIFS`。不带前缀会返回 `#NAME?`。
- **需要 LibreOffice 重算的工作簿，在使用 `XLOOKUP`、`XMATCH`、`SORT`、`FILTER`、`UNIQUE` 或 `SEQUENCE` 前要考虑兼容性。** 当前 LibreOffice 无法计算它们；即使能计算，也只会填充左上角，因为 openpyxl 写出的文件没有溢出元数据。查找使用 `INDEX`/`MATCH`，写入单元格前用 Python 排序、筛选和去重。
- 缺少 `)` 会报告 `unbalanced brackets`。参数过少（`=ROUND(A1)`）不会这样报告：LibreOffice 会返回值，Excel 可能提示修复文件。

## openpyxl 注意事项

- **读取模型需要加载两次。** `data_only=True` 返回缓存值而没有公式；默认返回公式字符串而没有值。一次加载无法同时获得两者。
- **使用 `data_only=True` 加载后保存会破坏公式。** 工作簿已不含公式，保存会永久将每个公式替换为字面值。
- **对 openpyxl 刚写入的文件使用 `data_only=True`，公式处会返回 `None`** — 先运行 `recalc.py`。（结果为 `""` 的公式读回时也是 `None`。）
- **合并单元格只写左上角锚点。** 其他单元格为 `MergedCell`，其 `.value` 只读。
- **向 `load_workbook` 传入 `keep_vba=True`，否则 `.xlsm` 会丢失宏。**
- **跨表引用中，含空格的表名必须加引号**：`='Assumptions Inputs'!$B$5`。不加引号会得到 `#VALUE!`。
- **保存上传的文件会丢失文本框、形状和切片器。** 先在 `xl/drawings/` 中搜索 `<xdr:sp `（包含空格），并查找 `xl/slicers/` 部件；找到后告知用户或直接编辑工作表 XML。
- **格式错误的工作簿不会自动修复**：数字格式中未闭合的引号（`'0.00 "USD'`）、以 `=` 开头的定义名称、重复或空表头会原样保存，Excel 可能提示修复。
- **单元格部分粗体或斜体会被扁平化**，除非使用 `load_workbook(rich_text=True)`；此时 `.value` 是 `CellRichText` 而非 `str`。
- **每个新公式都需要自己的 `number_format`**（日期、百分比、货币）；不会自动推断，否则日期显示为 `45337`、30% 显示为 `0.3`。
- **每个新图表设置 `chart.roundedCorners = False`，并为图例及各个已设置标题（`chart.legend`、`chart.title`、`chart.x_axis.title`…）设置 `.overlay = False`；如有坐标轴（非饼图或环形图），还要设置 `chart.x_axis.delete = False` 和 `chart.y_axis.delete = False`**，否则 Excel 可能让标题或图例覆盖图表、将边框变圆或不绘制坐标轴。
- **使用 `DateAxis` 时设置 `chart.y_axis.crossAx = 500`**，否则 Excel 可能提示修复文件。

## 财务模型

除非用户另有要求，或现有文件使用不同约定。

**颜色：** 蓝字（`0,0,255`）表示硬编码输入和情景参数 · 黑色表示公式 · 绿色（`0,128,0`）表示指向其他工作表的链接 · 红色（`255,0,0`）表示指向其他文件的链接 · 黄色填充（`255,255,0`）表示关键假设和用户需填写的单元格。

**数字：** 货币 `$#,##0`，在标题中注明单位（`Revenue ($mm)`） · 零显示为 `-`，百分比也一样（`$#,##0;($#,##0);-`） · 负数放在括号内 · 百分比 `0.0%`，**以小数存储**（`0.15` 显示为 `15.0%`；存储 `15` 会显示为 `1500.0%`） · 估值倍数 `0.0x` · 年份按文本存储（`"2024"`，而非 `2,024`）。

**结构：** 每个假设放在有标签的独立单元格中，由使用它的公式引用（`=B5*(1+$B$6)`，而非 `=B5*1.05`） · 所有预测期间的公式保持一致，因为在一行中单独修改一个单元格是常见的隐蔽错误 · 防止分母为零。

## 依赖

`openpyxl` 用于编辑电子表格。`pandas` 和 `markitdown` 对对应流程是可选的。随附的重算工具需要 LibreOffice `soffice` 和 openpyxl。
