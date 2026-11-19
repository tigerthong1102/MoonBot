使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# 从工作表数据生成 Google 文档报告

> **先决条件：** 加载以下技能来执行此配方：`gws-sheets`、`gws-docs`、`gws-drive`

从 Google Sheet 读取数据并创建格式化的 Google Docs 报告。

## 步骤

1. 读取数据：`gws sheets +read --spreadsheet SHEET_ID --range "Sales!A1:D"`
2. 创建报告文档：`gws docs documents create --json '{"title": "Sales Report - January 2025"}'`
3. 编写报告：`gws docs +write --document-id DOC_ID --text '## 销售报告 - 2025 年 1 月

### 总结
交易总数：45
收入：125,000 美元

### 热门优惠
1. Acme 公司 - 25,000 美元
2. Widget 公司 - $18,000'`
4. 与利益相关者分享：`gws drive permissions create --params '{"fileId": "DOC_ID"}' --json '{"role": "reader", "type": "user", "emailAddress": "cfo@company.com"}'`
