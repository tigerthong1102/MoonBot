使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# 驱动器（v3）

> **先决条件：** 阅读 `../gws-shared/SKILL.md` 了解身份验证、全局标志和安全规则。如果缺少，请运行 `gws generate-skills` 创建它。

```bash
gws drive <resource> <method> [flags]
```

## 辅助命令

| 命令 | 说明 |
|---------|-------------|
| `+upload` | 上传带有自动元数据的文件 |

## API资源

### 关于

  - `get` — 获取有关用户、用户的驱动器和系统功能的信息。有关详细信息，请参阅[返回用户信息](https://developers.google.com/workspace/drive/api/guides/user-info)。必需：必须设置`fields`参数。要返回您需要的确切字段，请参阅[返回特定字段](https://developers.google.com/workspace/drive/api/guides/fields-parameter)。

### 访问建议

  - `get` — 按 ID 检索访问建议。有关详细信息，请参阅[管理待处理的访问建议](https://developers.google.com/workspace/drive/api/guides/pending-access)。
  - `list` — 列出文件的访问建议。有关详细信息，请参阅[管理待处理的访问建议](https://developers.google.com/workspace/drive/api/guides/pending-access)。注意：只有批准者才能列出文件的访问建议。如果用户不是审批者，则返回 403 错误。
  - `resolve` — 批准或拒绝访问建议。有关详细信息，请参阅[管理待处理的访问建议](https://developers.google.com/workspace/drive/api/guides/pending-access)。

### 批准

  - `get` — 获得 ID 批准。
  - `list` — 列出文件的批准。

### 应用程序

  - `get` — 获取特定应用程序。有关详细信息，请参阅[返回用户信息](https://developers.google.com/workspace/drive/api/guides/user-info)。
  - `list` — 列出用户安装的应用程序。有关详细信息，请参阅[返回用户信息](https://developers.google.com/workspace/drive/api/guides/user-info)。

### 变化

  - `getStartPageToken` — 获取用于列出未来更改的起始 pageToken。有关详细信息，请参阅[检索更改](https://developers.google.com/workspace/drive/api/guides/manage-changes)。
  - `list` — 列出用户或共享驱动器的更改。有关详细信息，请参阅[检索更改](https://developers.google.com/workspace/drive/api/guides/manage-changes)。
  - `watch` — 订阅用户的更改。有关详细信息，请参阅[资源更改通知](https://developers.google.com/workspace/drive/api/guides/push)。

### 渠道

  - `stop` — 停止通过该频道观看资源。有关详细信息，请参阅[资源更改通知](https://developers.google.com/workspace/drive/api/guides/push)。

### 评论

  - `create` — 在文件上创建注释。欲了解更多信息，请参阅[管理评论和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。必需：必须设置`fields`参数。要返回您需要的确切字段，请参阅[返回特定字段](https://developers.google.com/workspace/drive/api/guides/fields-parameter)。
  - `delete` — 删除评论。欲了解更多信息，请参阅[管理评论和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。
  - `get` — 通过 ID 获取评论。欲了解更多信息，请参阅[管理评论和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。必需：必须设置`fields`参数。要返回您需要的确切字段，请参阅[返回特定字段](https://developers.google.com/workspace/drive/api/guides/fields-parameter)。
  - `list` — 列出文件的注释。欲了解更多信息，请参阅[管理评论和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。必需：必须设置`fields`参数。要返回您需要的确切字段，请参阅[返回特定字段](https://developers.google.com/workspace/drive/api/guides/fields-parameter)。
  - `update` - 使用补丁语义更新注释。欲了解更多信息，请参阅[管理评论和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。必需：必须设置`fields`参数。要返回您需要的确切字段，请参阅[返回特定字段](https://developers.google.com/workspace/drive/api/guides/fields-parameter)。

### 驱动器

  - `create` — 创建共享驱动器。有关详细信息，请参阅[管理共享云端硬盘](https://developers.google.com/workspace/drive/api/guides/manage-shareddrives)。
  - `get` — 按 ID 获取共享驱动器的元数据。有关详细信息，请参阅[管理共享云端硬盘](https://developers.google.com/workspace/drive/api/guides/manage-shareddrives)。
  - `hide` — 在默认视图中隐藏共享驱动器。有关详细信息，请参阅[管理共享云端硬盘](https://developers.google.com/workspace/drive/api/guides/manage-shareddrives)。
  - `list` — 列出用户的共享驱动器。此方法接受 `q` 参数，该参数是组合一个或多个搜索词的搜索查询。有关详细信息，请参阅[搜索共享驱动器](https://developers.google.com/workspace/drive/api/guides/search-shareddrives) 指南。
  - `unhide` — 将共享驱动器恢复为默认视图。有关详细信息，请参阅[管理共享云端硬盘](https://developers.google.com/workspace/drive/api/guides/manage-shareddrives)。
  - `update` — 更新共享驱动器的元数据。有关详细信息，请参阅[管理共享云端硬盘](https://developers.google.com/workspace/drive/api/guides/manage-shareddrives)。

### 文件

  - `copy` — 创建文件的副本并使用补丁语义应用任何请求的更新。有关详细信息，请参阅[创建和管理文件](https://developers.google.com/workspace/drive/api/guides/create-file)。
  - `create` — 创建一个文件。有关详细信息，请参阅[创建和管理文件](https://developers.google.com/workspace/drive/api/guides/create-file)。此方法支持 */upload* URI 并接受具有以下特征的上传媒体： - *最大文件大小：* 5,120 GB - *接受的媒体 MIME 类型：* `*/*` （指定有效的 MIME 类型，而不是文字 `*/*` 值。文字 `*/*` 仅用于指示可以上传任何有效的 MIME 类型。
  - `download` — 下载文件的内容。有关详细信息，请参阅[下载并导出文件](https://developers.google.com/workspace/drive/api/guides/manage-downloads)。操作自创建之日起 24 小时内有效。
  - `export` — 将 Google Workspace 文档导出为请求的 MIME 类型并返回导出的字节内容。有关详细信息，请参阅[下载并导出文件](https://developers.google.com/workspace/drive/api/guides/manage-downloads)。请注意，导出的内容限制为 10 MB。
  - `generateIds` — 生成一组可在创建或复制请求中提供的文件 ID。有关详细信息，请参阅[创建和管理文件](https://developers.google.com/workspace/drive/api/guides/create-file)。
  - `get` — 按 ID 获取文件的元数据或内容。有关详细信息，请参阅[搜索文件和文件夹](https://developers.google.com/workspace/drive/api/guides/search-files)。如果您提供 URL 参数 `alt=media`，则响应将在响应正文中包含文件内容。仅当文件存储在云端硬盘中时，才可以使用 `alt=media` 下载内容。
  - `list` — 列出用户的文件。有关详细信息，请参阅[搜索文件和文件夹](https://developers.google.com/workspace/drive/api/guides/search-files)。此方法接受 `q` 参数，该参数是组合一个或多个搜索词的搜索查询。此方法默认返回*所有*文件，包括已删除的文件。如果您不希望已删除的文件出现在列表中，请使用 `trashed=false` 查询参数从结果中删除已删除的文件。
  - `listLabels` — 列出文件上的标签。有关详细信息，请参阅[列出文件上的标签](https://developers.google.com/workspace/drive/api/guides/list-labels)。
  - `modifyLabels` - 修改应用于文件的标签集。有关详细信息，请参阅[在文件上设置标签字段](https://developers.google.com/workspace/drive/api/guides/set-label)。返回已添加或修改的标签的列表。
  - `update` — 更新文件的元数据、内容或两者。调用此方法时，仅填充请求中要修改的字段。更新字段时，某些字段可能会自动更改，例如`modifiedDate`。该方法支持补丁语义。此方法支持 */upload* URI 并接受具有以下特征的上传媒体： - *最大文件大小：* 5,120 GB - *接受的媒体 MIME 类型：* `*/*`（指定有效的 MIME 类型，而不是文字 `*/*` 值。
  - `watch` — 订阅对文件的更改。有关详细信息，请参阅[资源更改通知](https://developers.google.com/workspace/drive/api/guides/push)。

### 运营

  - `get` — 获取长时间运行的操作的最新状态。客户端可以使用此方法按照API服务建议的时间间隔轮询操作结果。

### 权限

  - `create` — 创建文件或共享驱动器的权限。有关详细信息，请参阅[共享文件、文件夹和驱动器](https://developers.google.com/workspace/drive/api/guides/manage-sharing)。 **警告：** 不支持对同一文件进行并发权限操作；仅应用最后一次更新。
  - `delete` — 删除权限。有关详细信息，请参阅[共享文件、文件夹和驱动器](https://developers.google.com/workspace/drive/api/guides/manage-sharing)。 **警告：** 不支持对同一文件进行并发权限操作；仅应用最后一次更新。
  - `get` — 通过 ID 获取权限。有关详细信息，请参阅[共享文件、文件夹和驱动器](https://developers.google.com/workspace/drive/api/guides/manage-sharing)。
  - `list` — 列出文件或共享驱动器的权限。有关详细信息，请参阅[共享文件、文件夹和驱动器](https://developers.google.com/workspace/drive/api/guides/manage-sharing)。
  - `update` — 使用补丁语义更新权限。有关详细信息，请参阅[共享文件、文件夹和驱动器](https://developers.google.com/workspace/drive/api/guides/manage-sharing)。 **警告：** 不支持对同一文件进行并发权限操作；仅应用最后一次更新。

### 回复

  - `create` — 创建评论回复。欲了解更多信息，请参阅[管理评论和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。
  - `delete` — 删除回复。欲了解更多信息，请参阅[管理评论和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。
  - `get` — 通过 ID 获取回复。欲了解更多信息，请参阅[管理评论和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。
  - `list` — 列出评论的回复。欲了解更多信息，请参阅[管理评论和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。
  - `update` - 使用补丁语义更新回复。欲了解更多信息，请参阅[管理评论和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。

### 修订

  - `delete` — 永久删除文件版本。您只能删除 Google 云端硬盘中包含二进制内容的文件（例如图像或视频）的修订版本。其他文件（例如 Google 文档或表格）的修订以及最后剩余的文件版本无法删除。有关详细信息，请参阅[管理文件修订](https://developers.google.com/drive/api/guides/manage-revisions)。
  - `get` — 按 ID 获取修订的元数据或内容。有关详细信息，请参阅[管理文件修订](https://developers.google.com/workspace/drive/api/guides/manage-revisions)。
  - `list` — 列出文件的修订版本。有关详细信息，请参阅[管理文件修订](https://developers.google.com/workspace/drive/api/guides/manage-revisions)。 **重要提示：** 对于具有大量修订历史记录的文件（包括经常编辑的 Google 文档、表格和幻灯片），此方法返回的修订列表可能不完整。响应中可能会省略较旧的修订版本，这意味着返回的第一个修订版本可能不是最旧的现有修订版本。
  - `update` — 使用补丁语义更新修订版。有关详细信息，请参阅[管理文件修订](https://developers.google.com/workspace/drive/api/guides/manage-revisions)。

### 团队驱动

  - `create` — 已弃用：使用 `drives.create` 代替。
  - `get` — 已弃用：使用 `drives.get` 代替。
  - `list` — 已弃用：使用 `drives.list` 代替。
  - `update` — 已弃用：使用 `drives.update` 代替。

## 发现命令

在调用任何 API 方法之前，请检查它：

```bash
# Browse resources and methods
gws drive --help

# Inspect a method's required params, types, and defaults
gws schema drive.<resource>.<method>
```

使用 `gws schema` 输出来构建 `--params` 和 `--json` 标志。
