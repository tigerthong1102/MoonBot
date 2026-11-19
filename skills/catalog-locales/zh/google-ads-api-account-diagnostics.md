使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# Google Ads API 帐户效果诊断技能

此技能提供有关如何使用 Google Ads MCP 服务器工具诊断常见帐户性能问题的说明。

## 工作流程

### 飞行前工具验证
在开始任何诊断任务之前，请验证 Google Ads MCP 服务器是否
工具（`search`、`list_accessible_customers`、`get_resource_metadata` — 暴露
默认服务器前缀为 `search_search`，
`customers_list_accessible_customers` 和 `metadata_get_resource_metadata`）是
在运行时环境中可用：
- **如果 MCP 工具可用**：首先进行实时诊断
  [识别活跃客户账户](#identifying-active-client-accounts)，然后
  通过 `search` 工具运行 GAQL（结构化参数 `customer_id`，
  `resource` 和 `fields`，加上可选的 `conditions`、`orderings`、`limit`、
  和`login_customer_id`）。
- **如果 MCP 工具丢失**：按照 [MCP 工具不可用时的回退](#fallback-when-mcp-tools-are-unavailable) 操作。

### 识别活跃客户账户
大多数诊断任务需要将 GAQL 查询发送到特定客户帐户。如果用户未明确提供客户 ID，您必须首先调用 `list_accessible_customers`（或 `customers_list_accessible_customers`）工具来检索您有权访问的客户资源名称/ID。

获得可访问客户 ID 的列表后，查询`customer_client`资源使用`search`这些客户帐户下的工具可查找活跃的客户客户帐户。确保仅选择已启用的客户帐户并过滤掉经理帐户：
```sql
SELECT
  customer_client.id,
  customer_client.descriptive_name,
  customer_client.status,
  customer_client.manager
FROM customer_client
WHERE customer_client.status = 'ENABLED' AND customer_client.manager = FALSE
```
仅针对从此列表中检索到的启用的客户端客户 ID 运行后续诊断查询。请勿查询已停用帐户或经理帐户，因为这样做会导致 API 错误。

### MCP 工具不可用时的回退
当 Google Ads MCP 工具（`search`、`list_accessible_customers`、
`get_resource_metadata` — 使用默认服务器前缀公开为
`search_search`、`customers_list_accessible_customers` 和
`metadata_get_resource_metadata`) 未在运行时环境中注册：
1. **通知用户**：说明真实帐户效果诊断需要 Google Ads MCP 服务器。
2. **参考设置指南**：引导用户查看以下内容中的设置说明：
   `google-ads-api-mcp-setup` 安装和配置 Google Ads MCP 的技巧
   他们的辅助环境的服务器。
3. **提供 GAQL 模板、问题和补救指南**：制定并输出完整的诊断计划，以便在 Google Ads 查询生成器中或通过 API 集成手动执行：
   - 提供工作流程的所有多步骤 GAQL 查询，包括当前与之前的日期窗口比较（例如流量、展示次数份额、转化细分或更改事件）。
   - 解释所有指标转换和约束问题（`metrics.cost_micros / 1,000,000` 表示货币，展示次数份额以小数形式报告或 `"< 0.10"`、`change_event` 30 天窗口和 `LIMIT 10000` 不含 `metrics.*`，以及 `successful_event_count / total_event_count` 加 `status` 表示上传状况）。
   - 为每个诊断分支概述具体的**可操作的后续步骤**（例如，当 `search_budget_lost_impression_share` 高时提高广告系列预算与当 `search_rank_lost_impression_share` 高时提高广告质量或出价）。
4. **请勿尝试未经授权的本地探测**：请勿**尝试运行 shell 命令、自定义 Python 脚本、本地 SQL/数据库查询或直接 RPC CLI 实用程序来访问帐户数据。这些命令缺乏凭据和 API 访问权限，将会失败。

### 1. 转换和转换价值损失

当转化或转化价值突然下降时，请使用以下步骤来诊断问题。

**步骤：**
1.  **发现字段**：使用 `get_resource_metadata` 并将 `resource_name` 设置为 `campaign` 或 `ad_group` 以确保您拥有正确的字段名称。
2.  **查询性能**：使用`search`检索性能数据。
    *   **资源**：`campaign` 或 `ad_group`
    *   **字段**：包括`campaign.name`、`metrics.conversions`、
        `metrics.conversions_value`、`metrics.cost_micros`，加上段字段
        (`segments.date`, `segments.device`, `segments.conversion_action`)
        在 `fields` 中而不是作为单独的 `segments` 参数。
    *   **条件**：使用有限日期范围（例如，`segments.date >= '{start_date}' AND segments.date <= '{end_date}'`）将下降期间与之前的期间进行比较。
    *   *陷阱*：`metrics.cost_micros` 必须除以 1,000,000 才能得到标准货币金额。
    *   *陷阱（转化操作细分）*：在 GAQL 中，`metrics.cost_micros`分割时无法选择`segments.conversion_action`。单独查询转化操作细分，无需`metrics.cost_micros`.

    **GAQL 查询示例：**
    1. 按日期和设备查询性能和成本：
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

    2. 要按转化操作查询转化细分（不带 `metrics.cost_micros`）：
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

3.  **分析**：检查损失是否仅限于某些设备（例如移动设备与桌面设备）或特定的转化操作。
4.  **检查上传**：如果使用离线导入，请查询 `offline_conversion_upload_conversion_action_summary` 以验证上传管道的运行状况。如果查询未返回结果，则报告该帐户不存在离线上传并继续。

    **GAQL 查询示例：**
    要检查客户帐户的上传管道运行状况 `{customer_id}`：
    ```sql
    SELECT
      offline_conversion_upload_conversion_action_summary.conversion_action_name,
      offline_conversion_upload_conversion_action_summary.successful_event_count,
      offline_conversion_upload_conversion_action_summary.total_event_count,
      offline_conversion_upload_conversion_action_summary.status
    FROM offline_conversion_upload_conversion_action_summary
    ```

### 2. 失去的机会（展示份额）

要确定因广告排名、出价或预算而失去的机会，请分析展示次数份额指标。

**步骤：**
1.  **查询展示份额**：使用 `search` 检索展示份额指标。
    *   **资源**：`campaign`
    *   **字段**：包括`campaign.name`、`metrics.search_impression_share`、`metrics.search_rank_lost_impression_share`、`metrics.search_budget_lost_impression_share`。
    *   *陷阱*：API 中的展示次数份额值以小数形式（例如 0.35 = 35%）或格式化字符串（例如 `"< 0.10"`）返回。

    **GAQL 查询示例：**
    查询客户帐户的展示次数份额指标`{customer_id}`之间`{start_date}`和`{end_date}`:
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
    *   高 `search_budget_lost_impression_share` 表示由于预算有限而失去了机会。
    *   高 `search_rank_lost_impression_share` 表示由于广告评级较低（出价或质量问题）而失去机会。

### 3. 低铅流量诊断

当用户询问“为什么过去几天我的潜在客户流量很低？”时，请遵循这种系统方法。

**步骤：**
1.  **确认删除**：按日期细分查询最近几天与上一时期的转化情况。
2.  **隔离原因**：
    *   检查**流量**（点击次数、展示次数）是否下降。
    *   检查**转化率**（转化/点击）是否下降。

    **GAQL 查询示例（流量和转化趋势）：**
    要查询按日期细分的跨营销活动的流量和转化率指标：
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

3.  **如果流量下降**：检查展示份额指标（请参阅工作流程 2）以查看是否是预算或排名问题，或者搜索量是否普遍下降。
4.  **如果转化率下降**：按 `segments.device` 或 `segments.conversion_action` 检查细分，以查看特定区域是否失败。
5.  **检查更改**：查询 `change_event` 资源，查看在投放开始前后是否对出价、预算或定位进行了任何更改。
    *   *陷阱（change_event 约束）*：对 `change_event` 资源的查询：
        *   必须指定小于或等于 10000 的 `LIMIT` 子句。
        *   必须按过去 30 天内的日期 (`change_event.change_date_time`) 进行过滤。
        *   无法选择性能指标（例如，不支持 `metrics.*`；只能选择 `change_event` 属性和允许的资源字段）。

    **GAQL 查询示例：**
    查询客户账户`{customer_id}`在`{start_date}`和`{end_date}`之间的更改事件：
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

### 4. 离线上传管道诊断

当特定操作（例如商店购买）的离线转化上传停止显示或失败时，请使用以下步骤来诊断问题。

**步骤：**
1.  **检索客户账户**：如果未提供`{customer_id}`，请按照[识别活跃客户账户](#identifying-active-client-accounts) 检索活跃客户客户账户。

2.  **验证管道运行状况**：查询 `offline_conversion_upload_conversion_action_summary` 活动客户帐户。
    *   **字段**：包括 `offline_conversion_upload_conversion_action_summary.conversion_action_name`、`offline_conversion_upload_conversion_action_summary.successful_event_count`、`offline_conversion_upload_conversion_action_summary.total_event_count` 和 `offline_conversion_upload_conversion_action_summary.status`。

    **GAQL 查询示例：**
    ```sql
    SELECT
      offline_conversion_upload_conversion_action_summary.conversion_action_name,
      offline_conversion_upload_conversion_action_summary.successful_event_count,
      offline_conversion_upload_conversion_action_summary.total_event_count,
      offline_conversion_upload_conversion_action_summary.status
    FROM offline_conversion_upload_conversion_action_summary
    ```

3.  **分析**：
    *   *陷阱*：如果对 `offline_conversion_upload_conversion_action_summary` 的查询未返回结果或为空（表明没有为客户帐户配置或激活离线转化上传），请立即停止/中断诊断工作流程。直接向用户报告可访问帐户中不存在离线转化上传数据或摘要，而不是重试或尝试生成自定义脚本。
    *   如果返回结果，请通过比较`successful_event_count`和`total_event_count`来验证上传成功率。检查`status`字段以诊断故障。
