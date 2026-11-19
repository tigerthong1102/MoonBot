使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# Google Analytics 数据 API 入门

Google Analytics Data API v1beta 提供对 Google 的编程访问
分析报告数据。它允许您构建定制的仪表板，
自动化报告工作流程，并将 Google Analytics 数据集成到您的企业中
应用程序。

## 通过 Cloud CLI 启用 API

在进行 API 调用之前，请确保您的 Google Analytics Data API 已启用
谷歌云项目。

如果未找到 `gcloud`，则提示用户先安装 Google Cloud CLI
运行这些命令。

1.  **启用 API：** 使用 Cloud CLI (`gcloud`) 启用
    `analyticsdata.googleapis.com`.

    ```bash
    gcloud services enable analyticsdata.googleapis.com --quiet
    ```

    *原因：启用 API 可确保您的云项目拥有必要的配额
    以及为运行 Google Analytics 报告分配的权限。*

2.  **验证 API 启用：**

    ```bash
    gcloud services list --enabled --filter="analyticsdata.googleapis.com"
    ```

## 认证

要验证您的 API 请求，您必须生成应用程序默认值
凭证 (ADC) 并为您的帐户提供必要的范围。运行以下命令
在你的终端命令：

```bash
gcloud auth application-default login --scopes="https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/analytics.readonly"
```

*原因：这会在您的本地环境中使用所需的云配置 ADC
平台和 Google Analytics 只读范围，允许客户端库
自动验证您的请求。*

## 创建数据 API 报告 (v1beta)

要创建报告，请使用官方 Google Analytics 数据客户端库。
始终更喜欢 API 的 `v1beta` 版本，以获得稳定性和访问权限
当前的 Google Analytics 报告功能。

> [!IMPORTANT] **强制代理指令：** 当用户选择或要求时
> 具体的编程语言，读取对应的客户端库设置
> 下面列出的`references/`中的参考指南。

### 支持的客户端库

#### 蟒蛇

如果您需要安装或设置 Google Analytics Data API 客户端库
对于 Python，请阅读设置指南：

*   [Python安装参考](references/python.md) *(包：
    `google-analytics-data`)*

#### 爪哇

如果您需要安装或设置 Google Analytics Data API 客户端库
对于 Java，请阅读设置指南：

*   [Java安装参考](references/java.md) *(神器：
    `com.google.cloud:google-cloud-analytics-data`)*

#### PHP

如果您需要安装或设置 Google Analytics Data API 客户端库
对于 PHP，请阅读设置指南：

*   [PHP安装参考](references/php.md) *(包：
    `google/analytics-data`)*

#### Node.js

如果您需要安装或设置 Google Analytics Data API 客户端库
对于 Node.js，请阅读设置指南：

*   [Node.js安装参考](references/nodejs.md) *(包：
    `@google-analytics/data`)*

#### 去

如果您需要安装或设置 Google Analytics Data API 客户端库
对于 Go，请阅读设置指南：

*   [Go安装参考](references/go.md) *(安装包：
    `cloud.google.com/go/analytics/data/apiv1beta`)*

#### .NET

如果您需要安装或设置 Google Analytics Data API 客户端库
对于 .NET / C#，请阅读设置指南：

*   [.NET安装参考](references/dotnet.md) *(包：
    `Google.Analytics.Data.V1Beta`)*

#### 红宝石

如果您需要安装或设置 Google Analytics Data API 客户端库
对于 Ruby，请阅读设置指南：

*   [Ruby 安装参考](references/ruby.md) *(Gem:
    `google-analytics-data-v1beta`)*

> [!NOTE] **其他资源**：有关调用数据 API 的更多示例
> 使用 Java、PHP、Node.js、.NET、Python 和 REST，以及有关的提示
> 使用service account进行认证，参考官方
> [数据 API 快速入门](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart)。

### Python 快速入门

1.  **安装客户端库：**

    ```bash
    pip install google-analytics-data
    ```

    如果`pip`不可用，则提示用户先安装`pip`
    安装客户端库。

2.  **运行报告请求：** 下面是一个完整的示例，演示了如何
    查询 Google Analytics 属性以获取按城市和日期分组的活跃用户和会话。
    将 `YOUR-PROPERTY-ID` 替换为您的实际 Google Analytics（分析）媒体资源 ID（例如，
    `1234567`).

    ```python
    from google.analytics.data_v1beta import BetaAnalyticsDataClient
    from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest

    def sample_run_report(property_id: str):
        # Initialize the client.
        # Assumes Application Default Credentials (ADC) are configured in your environment.
        client = BetaAnalyticsDataClient()

        request = RunReportRequest(
            property=f"properties/{property_id}",
            dimensions=[
                Dimension(name="city"),
                Dimension(name="date")
            ],
            metrics=[
                Metric(name="activeUsers"),
                Metric(name="sessions")
            ],
            date_ranges=[
                DateRange(start_date="2026-05-01", end_date="today")
            ],
        )

        response = client.run_report(request)

        print(f"Report result for property {property_id}:")
        for row in response.rows:
            print(
                f"City: {row.dimension_values[0].value}, "
                f"Date: {row.dimension_values[1].value}, "
                f"Active Users: {row.metric_values[0].value}, "
                f"Sessions: {row.metric_values[1].value}"
            )

    if __name__ == "__main__":
        sample_run_report("YOUR-PROPERTY-ID")
    ```

    *原因：使用 `BetaAnalyticsDataClient` 和 `RunReportRequest` 确保
    与 v1beta 端点和强类型请求的兼容性
    验证。*

## 指标和维度架构

构建 `RunReportRequest` 时，您必须使用有效的 API 名称
维度和指标。参考官方
[数据 API 架构文档](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)
获取完整、权威的可用字段列表。

### 常用尺寸

维度代表数据的分类属性。

*   `city`：用户所在的城镇。
*   `country`：用户的国家/地区。
*   `date`：事件的日期，格式为 YYYYMMDD。
*   `deviceCategory`：移动设备的类别（例如桌面、移动、
    平板电脑）。
*   `eventName`：触发事件的名称。
*   `pageTitle`：网页的标题。

### 常用指标

指标代表定量测量。

*   `activeUsers`：活跃用户数。
*   `eventCount`：事件总数。
*   `sessions`：会话总数。
*   `screenPageViews`：查看的应用程序屏幕或网页的数量。
*   `totalRevenue`：购买、订阅和订阅的总收入
    广告。

### 指标和维度兼容性检查

某些维度和指标无法在同一报表中一起查询
请求。如果您遇到有关不兼容的 `INVALID_ARGUMENT` 错误
字段，验证您的字段组合 对于以编程方式访问数据 API
架构，使用 `getMetadata()`。以编程方式检查兼容性
在运行报告之前，请使用特定维度和指标组合
`checkCompatibility()`方法。

```python
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import CheckCompatibilityRequest, Compatibility, Dimension, Metric

def sample_check_compatibility(property_id: str):
    client = BetaAnalyticsDataClient()

    # Define the dimensions and metrics you want to query together.
    # For example, checking if 'itemName' (an e-commerce dimension)
    # is compatible with 'activeUsers' and 'totalRevenue'.
    request = CheckCompatibilityRequest(
        property=f"properties/{property_id}",
        dimensions=[
            Dimension(name="itemName"),
            Dimension(name="date")
        ],
        metrics=[
            Metric(name="activeUsers"),
            Metric(name="totalRevenue")
        ],
    )
    response = client.check_compatibility(request)

    print(f"Compatibility check for property {property_id}:")
    for dim in response.dimension_compatibilities:
        is_compatible = dim.compatibility == Compatibility.COMPATIBLE
        print(f"Dimension '{dim.dimension_metadata.api_name}' is compatible: {is_compatible}")

    for metric in response.metric_compatibilities:
        is_compatible = metric.compatibility == Compatibility.COMPATIBLE
        print(f"Metric '{metric.metric_metadata.api_name}' is compatible: {is_compatible}")

if __name__ == "__main__":
    sample_check_compatibility("YOUR-PROPERTY-ID")
```
