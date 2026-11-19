使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# 床单 (v4)

> **先决条件：** 阅读 `../gws-shared/SKILL.md` 了解身份验证、全局标志和安全规则。如果缺少，请运行 `gws generate-skills` 创建它。

```bash
gws sheets <resource> <method> [flags]
```

## 辅助命令

| 命令 | 说明 |
|---------|-------------|
| `+append` | 将行追加到电子表格 |
| `+read` | 从电子表格读取值 |

## API资源

### 电子表格

  - `batchUpdate` — 对电子表格应用一项或多项更新。每个请求在应用之前都会经过验证。如果任何请求无效，则整个请求将失败并且不会应用任何内容。有些请求会得到回复，为您提供一些有关如何应用它们的信息。回复将反映请求。例如，如果您应用了 4 个更新，而第 3 个更新有回复，则响应将按顺序包含 2 个空回复、实际回复和另一个空回复。
  - `create` - 创建电子表格，返回新创建的电子表格。
  - `get`— 返回给定 ID 处的电子表格。调用者必须指定电子表格 ID。默认情况下，不返回网格内的数据。您可以通过以下两种方式之一包含网格数据： * 指定 [字段掩码](https://developers.google.com/workspace/sheets/api/guides/field-masks）使用列出您想要的字段`fields`HTTP 中的 URL 参数 * 将 includeGridData URL 参数设置为 true。
  - `getByDataFilter` — 返回给定 ID 处的电子表格。调用者必须指定电子表格 ID。有关详细信息，请参阅[读取、写入和搜索元数据](https://developers.google.com/workspace/sheets/api/guides/metadata)。此方法与 GetSpreadsheet 的不同之处在于，它允许通过指定 dataFilters 参数来选择要返回的电子表格数据子集。可以指定多个数据过滤器。
  - `developerMetadata` - 对“developerMetadata”资源的操作
  - `sheets` - 对“sheets”资源的操作
  - `values` - 对“值”资源的操作

## 发现命令

在调用任何 API 方法之前，请检查它：

```bash
# Browse resources and methods
gws sheets --help

# Inspect a method's required params, types, and defaults
gws schema sheets.<resource>.<method>
```

使用 `gws schema` 输出来构建 `--params` 和 `--json` 标志。
