使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# 工作流程+电子邮件到任务

> **先决条件：** 阅读 `../gws-shared/SKILL.md` 了解身份验证、全局标志和安全规则。如果缺少，请运行 `gws generate-skills` 创建它。

将 Gmail 邮件转换为 Google Tasks 条目

## 用途

```bash
gws workflow +email-to-task --message-id <ID>
```

## 旗帜

| 标志 | 必需 | 默认 | 描述 |
|------|----------|---------|-------------|
| `--message-id` | ✓ | — | 要转换的 Gmail 邮件 ID |
| `--tasklist` | — | @default | 任务列表 ID（默认：@default） |

## 示例

```bash
gws workflow +email-to-task --message-id MSG_ID
gws workflow +email-to-task --message-id MSG_ID --tasklist LIST_ID
```

## 温馨提示

- 将电子邮件主题读取为任务标题，将摘要读取为注释。
- 创建一个新任务 - 在执行之前与用户确认。

## 另请参阅

- [gws-shared](../gws-shared/SKILL.md) — 全局标志和身份验证
- `gws workflow --help` — 可用的跨服务工作流程
