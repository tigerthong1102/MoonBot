使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。


# 建立、編輯和分析 XLSX

| 任務 | 方法 |
|---|---|
| 使用公式和格式**建立**或**編輯** | `openpyxl` — 參見下方注意事項 |
| **批次匯入或匯出資料** | `pandas`（`read_excel`、`to_excel`） |
| **快速檢視**工作表 | `markitdown file.xlsx` — 每個工作表對應 `## SheetName`；也可讀取 `.xlsm`。沒有單元格座標，因此不要據此規劃編輯 |
| **讀取**模型（公式*和*值） | 兩次 `load_workbook` — 參見注意事項 |

> 首先確認可用的電子表格工具和依賴。已配置的 Mac 上，`startupbot-python` 直譯器包含 openpyxl。否則使用已配置的文件工具或現有 Python 環境。缺少依賴時應說明。

> 以下指令碼路徑相對於此技能目錄。

## 所有輸出的要求

- 除非使用者另有要求，全表使用**專業字型**（Arial、Times New Roman）。
- **零公式錯誤。** `recalc.py` 報告 `errors_found` 時不得交付，唯一例外見下方 `not_computed`。如認為錯誤原已存在，必須證明：用 `data_only=True` 開啟*原檔案*並檢查該單元格。新引入的錯誤與原有錯誤看起來完全一樣。
- **使用公式，不硬編碼計算結果。** 寫入 `sheet['B10'] = '=SUM(B2:B9)'`，不要寫入 Python 算出的總和。輸入變化時工作表必須重新計算。
- **嚴格遵循使用者規格。** 工作表名稱、列標題和指定公式都要準確。即使重新設計更美觀，只要計算了不同內容就不合格。
- **記錄每個假設和硬編碼數字**，放在讀者可見的位置：單元格批註或表格末尾相鄰單元格。有真實來源時註明（`Source: Company 10-K, FY2024, Page 45, Revenue Note, [SEC EDGAR URL]`）；數字來自使用者時明確說明。
- **為別人填寫而新建的工作簿**需要簡短圖例說明可編輯單元格，並給出一行合理的示例值展示格式。不要向只要求編輯的現有檔案新增此行。
- **編輯現有檔案時嚴格遵循原有約定**，優先於本指南。先找到指定輸入單元格，通常以不同字型顏色、填充或底紋標記；只寫入這些單元格，保留所有現有公式。

## 重新計算公式

具備所需 Python 依賴和 LibreOffice 時使用隨附的重算工具。無法重算時保留工作簿，並明確報告公式結果未經驗證。

openpyxl 把公式寫成字串，**沒有快取值**。重算前，讀取快取值的工具（包括 `pandas`、`load_workbook(data_only=True)` 和大多數預覽器）會把公式單元格讀作 `None`。

```bash
python <skill-directory>/scripts/recalc.py output.xlsx [timeout_seconds]   # default 30
```

LibreOffice 在**副本上**計算公式，僅將值寫入檔案，並返回 JSON：`status`（`success` | `errors_found`）、`total_formulas`、`total_errors` 和 `error_summary`，每類錯誤最多列出 100 個單元格（`locations_truncated` 表示省略數量；以 `total_errors` 為準，而非列表長度）。修復後重新執行。**JSON 有 `error` 而非 `status` 表示沒有執行重算**；只有這種情況返回非零狀態，`errors_found` 返回 0，所以不能把正常退出當成工作簿無誤。

**重算成功只能證明公式*能計算*，不能證明*計算正確*。** 範圍偏移一格或引用錯誤行都可能無報錯但結果錯誤。先寫 2–3 個公式並檢查是否取到預期值，再擴充套件到整個區域。

**`not_computed` 列出 LibreOffice 無法計算的公式，即使結果為 `success` 也如此**：包括不支援的函式（`_xlfn.XLOOKUP`、`_xlfn.LET`…）和其他工作簿的連結（`='[1]Returns Analysis'!$B$2`）。它們保留原有值；openpyxl 儲存後在 Excel 開啟前沒有值。如需提前檢視數字，用 `data_only=True` 讀取原檔案並保留公式。正確公式若直接或間接依賴列表中的公式，也會報 `#NAME?`：保留並告知使用者。測試此類單元格的公式（`IFERROR(B1,0)`）會得到 LibreOffice 的後備值，保留的值可能過期，應說明。編輯工作表 XML 後，刪除每個變更公式的 `<v>`：保留了值的錯誤會被列入列表，而不是作為錯誤報告。

## 選擇便於驗證的公式

LibreOffice 支援的函式少於 Excel；不能計算的公式在 Excel 開啟前沒有值。

- **優先使用 Excel 2007 時期的函式** — `SUMIFS`、`INDEX`、`MATCH`、`IFERROR`、`SUMPRODUCT` — 無需字首。
- **六個 2007 年後函式只有帶 `_xlfn.` 字首才能工作**，因為 openpyxl 原樣寫入 XML，而 Excel 儲存新函式名稱時帶字首（介面隱藏該字首）：`_xlfn.TEXTJOIN`、`_xlfn.CONCAT`、`_xlfn.IFS`、`_xlfn.SWITCH`、`_xlfn.MAXIFS`、`_xlfn.MINIFS`。不帶字首會返回 `#NAME?`。
- **需要 LibreOffice 重算的工作簿，在使用 `XLOOKUP`、`XMATCH`、`SORT`、`FILTER`、`UNIQUE` 或 `SEQUENCE` 前要考慮相容性。** 當前 LibreOffice 無法計算它們；即使能計算，也只會填充左上角，因為 openpyxl 寫出的檔案沒有溢位後設資料。查詢使用 `INDEX`/`MATCH`，寫入單元格前用 Python 排序、篩選和去重。
- 缺少 `)` 會報告 `unbalanced brackets`。引數過少（`=ROUND(A1)`）不會這樣報告：LibreOffice 會返回值，Excel 可能提示修復檔案。

## openpyxl 注意事項

- **讀取模型需要載入兩次。** `data_only=True` 返回快取值而沒有公式；預設返回公式字串而沒有值。一次載入無法同時獲得兩者。
- **使用 `data_only=True` 載入後儲存會破壞公式。** 工作簿已不含公式，儲存會永久將每個公式替換為字面值。
- **對 openpyxl 剛寫入的檔案使用 `data_only=True`，公式處會返回 `None`** — 先執行 `recalc.py`。（結果為 `""` 的公式讀回時也是 `None`。）
- **合併單元格只寫左上角錨點。** 其他單元格為 `MergedCell`，其 `.value` 只讀。
- **向 `load_workbook` 傳入 `keep_vba=True`，否則 `.xlsm` 會丟失宏。**
- **跨表引用中，含空格的表名必須加引號**：`='Assumptions Inputs'!$B$5`。不加引號會得到 `#VALUE!`。
- **儲存上傳的檔案會丟失文字框、形狀和切片器。** 先在 `xl/drawings/` 中搜尋 `<xdr:sp `（包含空格），並查詢 `xl/slicers/` 部件；找到後告知使用者或直接編輯工作表 XML。
- **格式錯誤的工作簿不會自動修復**：數字格式中未閉合的引號（`'0.00 "USD'`）、以 `=` 開頭的定義名稱、重複或空表頭會原樣儲存，Excel 可能提示修復。
- **單元格部分粗體或斜體會被扁平化**，除非使用 `load_workbook(rich_text=True)`；此時 `.value` 是 `CellRichText` 而非 `str`。
- **每個新公式都需要自己的 `number_format`**（日期、百分比、貨幣）；不會自動推斷，否則日期顯示為 `45337`、30% 顯示為 `0.3`。
- **每個新圖表設定 `chart.roundedCorners = False`，併為圖例及各個已設定標題（`chart.legend`、`chart.title`、`chart.x_axis.title`…）設定 `.overlay = False`；如有座標軸（非餅圖或環形圖），還要設定 `chart.x_axis.delete = False` 和 `chart.y_axis.delete = False`**，否則 Excel 可能讓標題或圖例覆蓋圖表、將邊框變圓或不繪製座標軸。
- **使用 `DateAxis` 時設定 `chart.y_axis.crossAx = 500`**，否則 Excel 可能提示修復檔案。

## 財務模型

除非使用者另有要求，或現有檔案使用不同約定。

**顏色：** 藍字（`0,0,255`）表示硬編碼輸入和情景引數 · 黑色表示公式 · 綠色（`0,128,0`）表示指向其他工作表的連結 · 紅色（`255,0,0`）表示指向其他檔案的連結 · 黃色填充（`255,255,0`）表示關鍵假設和使用者需填寫的單元格。

**數字：** 貨幣 `$#,##0`，在標題中註明單位（`Revenue ($mm)`） · 零顯示為 `-`，百分比也一樣（`$#,##0;($#,##0);-`） · 負數放在括號內 · 百分比 `0.0%`，**以小數儲存**（`0.15` 顯示為 `15.0%`；儲存 `15` 會顯示為 `1500.0%`） · 估值倍數 `0.0x` · 年份按文字儲存（`"2024"`，而非 `2,024`）。

**結構：** 每個假設放在有標籤的獨立單元格中，由使用它的公式引用（`=B5*(1+$B$6)`，而非 `=B5*1.05`） · 所有預測期間的公式保持一致，因為在一行中單獨修改一個單元格是常見的隱蔽錯誤 · 防止分母為零。

## 依賴

`openpyxl` 用於編輯電子表格。`pandas` 和 `markitdown` 對對應流程是可選的。隨附的重算工具需要 LibreOffice `soffice` 和 openpyxl。
