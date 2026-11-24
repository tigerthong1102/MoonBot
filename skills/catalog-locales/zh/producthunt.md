使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# 使用配置的 Product Hunt API 启动研究

使用经批准的 Product Hunt 连接器或包含的只读脚本以及配置的凭据存储提供的 PRODUCTHUNT_ACCESS_TOKEN。搜索主题和发布。报告标题、日期、来源链接和搜索限制。总结发布过程中的模式。
## 可用的只读操作

在技能目录中运行脚本，将已配置的凭据放在进程环境中。切勿把令牌放入命令、聊天消息、shell 配置文件或输出中。若没有获批准的连接或凭据，请说明缺少的条件，并在可能时继续使用其他获授权的来源。

- `python3 scripts/get_posts.py --limit 20` 列出帖子。可选筛选包括 `--featured`、`--topic`、`--after`、`--before` 和 `--cursor`。
- `python3 scripts/get_post.py <slug-or-id>` 获取一个帖子。`python3 scripts/get_post_comments.py <post-id> --limit 20` 获取评论。
- `python3 scripts/get_topics.py --query <query> --limit 20` 搜索主题。`python3 scripts/get_topic.py <slug-or-id>` 获取一个主题。
- `python3 scripts/get_user.py <username>` 获取用户资料。`python3 scripts/get_user_posts.py <username> --limit 20` 列出该用户的帖子。
- `python3 scripts/get_collections.py --featured --limit 20` 列出合集。`python3 scripts/get_collection.py <slug-or-id>` 获取一个合集。

使用 `--help` 查看脚本的当前参数。记录查询日期和筛选条件，保留来源链接，不要把观察到的投票数或其他指标说成客户自己发布的结果。
