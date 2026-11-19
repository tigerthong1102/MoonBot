使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# Google Ads API 帳戶效果診斷技能

此技能提供有關如何使用 Google Ads MCP 伺服器工具診斷常見帳戶效能問題的說明。

## 工作流程

### 飛行前工具驗證
在開始任何診斷任務之前，請先驗證 Google Ads MCP 伺服器是否
工具（`search`、`list_accessible_customers`、`get_resource_metadata` — 暴露
預設伺服器前綴為 `search_search`，
`customers_list_accessible_customers` 和 `metadata_get_resource_metadata`）是
在運行時環境中可用：
- **如果 MCP 工具可用**：先進行即時診斷
  [識別活躍客戶帳號](#identifying-active-client-accounts)，然後
  透過 `search` 工具運行 GAQL（結構化參數 `customer_id`，
  `resource` 和 `fields`，加上選購的 `conditions`、`orderings`、`limit`、
  和`login_customer_id`）。
- **如果 MCP 工具遺失**：依照 [MCP 工具不可用時的回退](#fallback-when-mcp-tools-are-unavailable) 操作。

### 識別活躍客戶帳戶
大多數診斷任務需要將 GAQL 查詢傳送到特定客戶帳戶。如果使用者未明確提供客戶 ID，您必須先呼叫 `list_accessible_customers`（或 `customers_list_accessible_customers`）工具來擷取您有權存取的客戶資源名稱/ID。

取得可存取客戶 ID 的清單後，查詢`customer_client`資源使用`search`這些客戶帳戶下的工具可尋找活躍的客戶客戶帳戶。確保僅選擇已啟用的客戶帳戶並過濾掉經理帳戶：
```sql
SELECT
  customer_client.id,
  customer_client.descriptive_name,
  customer_client.status,
  customer_client.manager
FROM customer_client
WHERE customer_client.status = 'ENABLED' AND customer_client.manager = FALSE
```
僅針對從此清單中檢索到的啟用的用戶端客戶 ID 執行後續診斷查詢。請勿查詢已停用帳戶或經理帳戶，因為這樣做會導致 API 錯誤。

### MCP 工具不可用時的回退
當 Google Ads MCP 工具（`search`、`list_accessible_customers`、
`get_resource_metadata` — 使用預設伺服器前綴公開為
`search_search`、`customers_list_accessible_customers` 和
`metadata_get_resource_metadata`) 未在執行環境中註冊：
1. **通知使用者**：說明真實帳戶效果診斷需要 Google Ads MCP 伺服器。
2. **參考設定指南**：引導使用者查看以下內容中的設定說明：
   `google-ads-api-mcp-setup` 安裝與設定 Google Ads MCP 的技巧
   他們的輔助環境的伺服器。
3. **提供 GAQL 範本、問題和補救指南**：制定並輸出完整的診斷計劃，以便在 Google Ads 查詢產生器中或透過 API 整合手動執行：
   - 提供工作流程的所有多步驟 GAQL 查詢，包括目前與先前的日期視窗比較（例如流量、展示次數份額、轉換細分或變更事件）。
   - 解釋所有指標轉換和限制問題（`metrics.cost_micros / 1,000,000` 表示貨幣，展示次數份額以小數形式報告或 `"< 0.10"`、`change_event` 30 天視窗和 `LIMIT 10000` 不含 `metrics.*`，以及 `successful_event_count / total_event_count` 加 `status` 表示上傳狀況）。
   - 為每個診斷分支概述具體的**可操作的後續步驟**（例如，當 `search_budget_lost_impression_share` 高時提高廣告系列預算與當 `search_rank_lost_impression_share` 高時提高廣告品質或出價）。
4. **請勿嘗試未經授權的本機探測**：請勿**嘗試執行 shell 命令、自訂 Python 腳本、本機 SQL/資料庫查詢或直接 RPC CLI 公用程式來存取帳戶資料。這些命令缺乏憑證和 API 存取權限，將會失敗。

### 1. 轉換和轉換價值損失

當轉換或轉換價值突然下降時，請使用以下步驟來診斷問題。

**步驟：**
1.  **發現欄位**：使用 `get_resource_metadata` 並將 `resource_name` 設定為 `campaign` 或 `ad_group` 以確保您擁有正確的欄位名稱。
2.  **查詢效能**：使用`search`檢索效能資料。
    *   **資源**：`campaign` 或 `ad_group`
    *   **字段**：包括`campaign.name`、`metrics.conversions`、
        `metrics.conversions_value`、`metrics.cost_micros`，加上段落字段
        (`segments.date`, `segments.device`, `segments.conversion_action`)
        在 `fields` 中而不是作為單獨的 `segments` 參數。
    *   **條件**：使用有限日期範圍（例如，`segments.date >= '{start_date}' AND segments.date <= '{end_date}'`）將下降期間與先前的期間進行比較。
    *   *陷阱*：`metrics.cost_micros` 必須除以 1,000,000 才能得到標準貨幣金額。
    *   *陷阱（轉換操作細分）*：在 GAQL 中，`metrics.cost_micros`分割時無法選擇`segments.conversion_action`。單獨查詢轉換操作細分，無需`metrics.cost_micros`.

    **GAQL 查詢範例：**
    1. 按日期和設備查詢效能和成本：
    ```sql
    SELECT
      campaign.name,
      metrics.conversions,
      metrics.conversions_value,
      metrics.cost_micros,
      segments.date,
      segments.device
    FROM campaign
    WHERE segments.date >= '{start_date}' AND segments.date <= '{end_date}'
    ```

    2. 若要依轉換操作查詢轉換細分（不含 `metrics.cost_micros`）：
    ```sql
    SELECT
      campaign.name,
      metrics.conversions,
      metrics.conversions_value,
      segments.date,
      segments.conversion_action
    FROM campaign
    WHERE segments.date >= '{start_date}' AND segments.date <= '{end_date}'
    ```

3.  **分析**：檢查損失是否僅限於某些裝置（例如行動裝置與桌上型裝置）或特定的轉換操作。
4.  **檢查上傳**：如果使用離線匯入，請查詢 `offline_conversion_upload_conversion_action_summary` 以驗證上傳管道的運作狀況。如果查詢未傳回結果，則報告該帳戶不存在離線上傳並繼續。

    **GAQL 查詢範例：**
    若要檢查客戶帳戶的上傳管道運作狀況 `{customer_id}`：
    ```sql
    SELECT
      offline_conversion_upload_conversion_action_summary.conversion_action_name,
      offline_conversion_upload_conversion_action_summary.successful_event_count,
      offline_conversion_upload_conversion_action_summary.total_event_count,
      offline_conversion_upload_conversion_action_summary.status
    FROM offline_conversion_upload_conversion_action_summary
    ```

### 2. 失去的機會（展示份額）

若要確定廣告排名、出價或預算而失去的機會，請分析展示次數份額指標。

**步驟：**
1.  **查詢展示份額**：使用 `search` 檢索展示份額指標。
    *   **資源**：`campaign`
    *   **字段**：包括`campaign.name`、`metrics.search_impression_share`、`metrics.search_rank_lost_impression_share`、`metrics.search_budget_lost_impression_share`。
    *   *陷阱*：API 中的展示次數份額值以小數形式（例如 0.35 = 35%）或格式化字串（例如 `"< 0.10"`）傳回。

    **GAQL 查詢範例：**
    查詢客戶帳號的展示次數份額指標`{customer_id}`之間`{start_date}`和`{end_date}`:
    ```sql
    SELECT
      campaign.name,
      metrics.search_impression_share,
      metrics.search_rank_lost_impression_share,
      metrics.search_budget_lost_impression_share
    FROM campaign
    WHERE segments.date >= '{start_date}' AND segments.date <= '{end_date}'
    ```

2.  **分析**：
    *   高 `search_budget_lost_impression_share` 表示由於預算有限而失去了機會。
    *   高 `search_rank_lost_impression_share` 表示由於廣告評級較低（出價或品質問題）而失去機會。

### 3. 低鉛流量診斷

當用戶詢問「為什麼過去幾天我的潛在客戶流量很低？」時，請遵循這種系統方法。

**步驟：**
1.  **確認刪除**：按日期細分查詢最近幾天與上一期的轉換情況。
2.  **隔離原因**：
    *   檢查**流量**（點擊次數、展示次數）是否下降。
    *   檢查**轉換率**（轉換/點擊）是否下降。

    **GAQL 查詢範例（流量和轉換趨勢）：**
    若要查詢按日期細分的跨行銷活動的流量和轉換率指標：
    ```sql
    SELECT
      campaign.id,
      campaign.name,
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.conversions,
      metrics.conversions_from_interactions_rate
    FROM campaign
    WHERE segments.date >= '{start_date}' AND segments.date <= '{end_date}'
    ORDER BY segments.date DESC
    ```

3.  **如果流量下降**：檢查展示份額指標（請參閱工作流程 2）以查看是否為預算或排名問題，或者搜尋量是否普遍下降。
4.  **如果轉換率下降**：按 `segments.device` 或 `segments.conversion_action` 檢查細分，以查看特定區域是否失敗。
5.  **檢查變更**：查詢 `change_event` 資源，查看在投放開始前後是否對出價、預算或定位進行了任何更改。
    *   *陷阱（change_event 限制）*：對 `change_event` 資源的查詢：
        *   必須指定小於或等於 10000 的 `LIMIT` 子句。
        *   必須按過去 30 天內的日期 (`change_event.change_date_time`) 進行過濾。
        *   無法選擇效能指標（例如，不支援 `metrics.*`；只能選擇 `change_event` 屬性和允許的資源欄位）。

    **GAQL 查詢範例：**
    查詢客戶帳號`{customer_id}`在`{start_date}`和`{end_date}`之間的變更事件：
    ```sql
    SELECT
      change_event.change_date_time,
      change_event.change_resource_name,
      change_event.resource_change_operation,
      change_event.changed_fields
    FROM change_event
    WHERE change_event.change_date_time >= '{start_date}' AND change_event.change_date_time <= '{end_date}'
    LIMIT 10000
    ```

### 4. 離線上傳管道診斷

當特定操作（例如商店購買）的離線轉換上傳停止顯示或失敗時，請使用下列步驟來診斷問題。

**步驟：**
1.  **擷取客戶帳號**：如果未提供`{customer_id}`，請依照[識別活躍客戶帳號](#identifying-active-client-accounts) 擷取活躍客戶客戶帳號。

2.  **驗證管道運作狀況**：查詢 `offline_conversion_upload_conversion_action_summary` 活動客戶帳戶。
    *   **字段**：包括 `offline_conversion_upload_conversion_action_summary.conversion_action_name`、`offline_conversion_upload_conversion_action_summary.successful_event_count`、`offline_conversion_upload_conversion_action_summary.total_event_count` 和 `offline_conversion_upload_conversion_action_summary.status`。

    **GAQL 查詢範例：**
    ```sql
    SELECT
      offline_conversion_upload_conversion_action_summary.conversion_action_name,
      offline_conversion_upload_conversion_action_summary.successful_event_count,
      offline_conversion_upload_conversion_action_summary.total_event_count,
      offline_conversion_upload_conversion_action_summary.status
    FROM offline_conversion_upload_conversion_action_summary
    ```

3.  **分析**：
    *   *陷阱*：如果對 `offline_conversion_upload_conversion_action_summary` 的查詢未傳回結果或為空（表示沒有為客戶帳戶配置或啟動離線轉換上傳），請立即停止/中斷診斷工作流程。直接向使用者報告可存取帳戶中不存在離線轉換上傳資料或摘要，而不是重試或嘗試產生自訂腳本。
    *   如果傳回結果，請透過比較`successful_event_count`和`total_event_count`來驗證上傳成功率。檢查`status`欄位以診斷故障。
