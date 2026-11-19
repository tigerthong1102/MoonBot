使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# 从模板创建 Google 文档

> **先决条件：** 加载以下技能来执行此配方：`gws-drive`、`gws-docs`

复制 Google 文档模板，填写内容并与协作者共享。

## 步骤

1. 复制模板：`gws drive files copy --params '{"fileId": "TEMPLATE_DOC_ID"}' --json '{"name": "Project Brief - Q2 Launch"}'`
2. 从响应中获取新的文档 ID
3. 添加内容：`gws docs +write --document-id NEW_DOC_ID --text '## 项目：第二季度启动

### 目的
在第二季度末推出新功能。'`
4. 与团队分享：`gws drive permissions create --params '{"fileId": "NEW_DOC_ID"}' --json '{"role": "writer", "type": "user", "emailAddress": "team@company.com"}'`
