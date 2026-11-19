使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# 表格 (v1)

> **先决条件：** 阅读 `../gws-shared/SKILL.md` 了解身份验证、全局标志和安全规则。如果缺少，请运行 `gws generate-skills` 创建它。

```bash
gws forms <resource> <method> [flags]
```

## API资源

### 形式

  - `batchUpdate` — 通过批量更新更改表单。
  - `create` — 使用请求中提供的表单消息中给出的标题创建一个新表单。 *重要：* 仅 form.info.title 和 form.info.document_title 字段被复制到新表单。不允许使用所有其他字段，包括表单描述、项目和设置。要创建新表单并添加项目，您必须首先调用 forms.create 创建一个带有标题和（可选）文档标题的空表单，然后调用 forms.update 添加项目。
  - `get` — 获取表格。
  - `setPublishSettings` - 更新表单的发布设置。不支持旧表单，因为它们没有 `publish_settings` 字段。
  - `responses` - 对“响应”资源的操作
  - `watches` - 对“手表”资源的操作

## 发现命令

在调用任何 API 方法之前，请检查它：

```bash
# Browse resources and methods
gws forms --help

# Inspect a method's required params, types, and defaults
gws schema forms.<resource>.<method>
```

使用 `gws schema` 输出来构建 `--params` 和 `--json` 标志。
