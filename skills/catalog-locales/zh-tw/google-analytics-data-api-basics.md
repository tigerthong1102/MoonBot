使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# Google Analytics 資料 API 入門

Google Analytics Data API v1beta 提供對 Google 的程式存取
分析報告數據。它允許您建立定制的儀表板，
自動化報告工作流程，並將 Google Analytics 資料整合到您的企業中
應用程式。

## 透過 Cloud CLI 啟用 API

在進行 API 呼叫之前，請確保您的 Google Analytics Data API 已啟用
谷歌雲端專案。

如果找不到 `gcloud`，則提示使用者先安裝 Google Cloud CLI
運行這些命令。

1.  **啟用 API：** 使用 Cloud CLI (`gcloud`) 啟用
    `analyticsdata.googleapis.com`.

    ```bash
    gcloud services enable analyticsdata.googleapis.com --quiet
    ```

    *原因：啟用 API 可確保您的雲端專案擁有必要的配額
    以及為運行 Google Analytics 報告分配的權限。 *

2.  **驗證 API 啟用：**

    ```bash
    gcloud services list --enabled --filter="analyticsdata.googleapis.com"
    ```

## 認證

要驗證您的 API 請求，您必須產生應用程式預設值
憑證 (ADC) 並為您的帳戶提供必要的範圍。運行以下命令
在你的終端機命令：

```bash
gcloud auth application-default login --scopes="https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/analytics.readonly"
```

*原因：這會在您的本地環境中使用所需的雲端來配置 ADC
平台和 Google Analytics 只讀範圍，允許客戶端庫
自動驗證您的請求。 *

## 建立資料 API 報告 (v1beta)

若要建立報告，請使用官方 Google Analytics 資料用戶端庫。
始終更喜歡 API 的 `v1beta` 版本，以獲得穩定性和存取權限
目前的 Google Analytics 報告功能。

> [!IMPORTANT] **強制代理指令：** 當使用者選擇或要求時
> 具體的程式語言，讀取對應的客戶端庫設置
> 以下列出的`references/`中的參考指南。

### 支援的客戶端庫

#### 蟒蛇

如果您需要安裝或設定 Google Analytics Data API 用戶端程式庫
對於 Python，請閱讀設定指南：

*   [Python安裝參考](references/python.md) *(套件：
    `google-analytics-data`)*

#### 爪哇

如果您需要安裝或設定 Google Analytics Data API 用戶端程式庫
對於 Java，請閱讀設定指南：

*   [Java安裝參考](references/java.md) *(神器：
    `com.google.cloud:google-cloud-analytics-data`)*

#### PHP

如果您需要安裝或設定 Google Analytics Data API 用戶端程式庫
對於 PHP，請閱讀設定指南：

*   [PHP安裝參考](references/php.md) *(套件：
    `google/analytics-data`)*

#### Node.js

如果您需要安裝或設定 Google Analytics Data API 用戶端程式庫
對於 Node.js，請閱讀設定指南：

*   [Node.js安裝參考](references/nodejs.md) *(套件：
    `@google-analytics/data`)*

#### 去

如果您需要安裝或設定 Google Analytics Data API 用戶端程式庫
對於 Go，請閱讀設定指南：

*   [Go安裝參考](references/go.md) *(安裝套件：
    `cloud.google.com/go/analytics/data/apiv1beta`)*

#### .NET

如果您需要安裝或設定 Google Analytics Data API 用戶端程式庫
對於 .NET / C#，請閱讀設定指南：

*   [.NET安裝參考](references/dotnet.md) *(套件：
    `Google.Analytics.Data.V1Beta`)*

#### 紅寶石

如果您需要安裝或設定 Google Analytics Data API 用戶端程式庫
對於 Ruby，請閱讀設定指南：

*   [Ruby 安裝參考](references/ruby.md) *(Gem:
    `google-analytics-data-v1beta`)*

> [!NOTE] **其他資源**：有關呼叫資料 API 的更多範例
> 使用 Java、PHP、Node.js、.NET、Python 和 REST，以及相關的提示
> 使用service account進行認證，參考官方
> [資料 API 快速入門](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart)。

### Python 快速入門

1.  **安裝客戶端程式庫：**

    ```bash
    pip install google-analytics-data
    ```

    如果`pip`不可用，則提示使用者先安裝`pip`
    安裝客戶端程式庫。

2.  **運行報告請求：** 下面是一個完整的範例，示範如何
    查詢 Google Analytics 屬性以取得按城市和日期分組的活躍使用者和會話。
    將 `YOUR-PROPERTY-ID` 替換為您的實際 Google Analytics（分析）媒體資源 ID（例如，
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

    *原因：使用 `BetaAnalyticsDataClient` 和 `RunReportRequest` 確保
    與 v1beta 端點和強型別請求的兼容性
    驗證。 *

## 指標和維度架構

建置 `RunReportRequest` 時，您必須使用有效的 API 名稱
維度和指標。參考官方
[資料 API 架構文件](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)
取得完整、權威的可用欄位清單。

### 常用尺寸

維度代表資料的分類屬性。

*   `city`：使用者所在的城鎮。
*   `country`：使用者的國家。
*   `date`：事件的日期，格式為 YYYYMMDD。
*   `deviceCategory`：行動裝置的類別（例如桌面、行動、
    平板電腦）。
*   `eventName`：觸發事件的名稱。
*   `pageTitle`：網頁的標題。

### 常用指標

指標代表定量測量。

*   `activeUsers`：活躍用戶數。
*   `eventCount`：事件總數。
*   `sessions`：會話總數。
*   `screenPageViews`：查看的應用程式螢幕或網頁的數量。
*   `totalRevenue`：購買、訂閱和訂閱的總收入
    廣告。

### 指標和維度相容性檢查

某些維度和指標無法在同一報表中一起查詢
請求。如果您遇到有關不相容的 `INVALID_ARGUMENT` 錯誤
字段，驗證您的字段組合 對於以程式設計方式存取資料 API
架構，使用 `getMetadata()`。以程式設計方式檢查相容性
在運行報告之前，請使用特定維度和指標組合
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
