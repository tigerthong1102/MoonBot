使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# 检查表单回复

> **先决条件：** 加载以下技能来执行此配方：`gws-forms`

检索并查看 Google 表单的回复。

## 步骤

1. 列出表单：`gws forms forms list`（如果您没有表单 ID）
2. 获取表格详细信息：`gws forms forms get --params '{"formId": "FORM_ID"}'`
3. 获取回复：`gws forms forms responses list --params '{"formId": "FORM_ID"}' --format table`
