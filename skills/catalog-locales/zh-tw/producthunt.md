使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# 使用設定的 Product Hunt API 啟動研究

使用經批准的 Product Hunt 連接器或包含的唯讀腳本以及配置的憑證儲存提供的 PRODUCTHUNT_ACCESS_TOKEN。搜尋主題和發布。報告標題、日期、來源連結和搜尋限制。總結發布過程中的模式。
## 可用的唯讀操作

在技能目錄中執行指令碼，將已設定的憑證放在程序環境中。切勿把令牌放入指令、聊天訊息、shell 設定檔或輸出。若沒有獲批准的連線或憑證，請說明缺少的條件，並在可能時繼續使用其他獲授權的來源。

- `python3 scripts/get_posts.py --limit 20` 列出貼文。選用篩選包含 `--featured`、`--topic`、`--after`、`--before` 和 `--cursor`。
- `python3 scripts/get_post.py <slug-or-id>` 取得一則貼文。`python3 scripts/get_post_comments.py <post-id> --limit 20` 取得留言。
- `python3 scripts/get_topics.py --query <query> --limit 20` 搜尋主題。`python3 scripts/get_topic.py <slug-or-id>` 取得一個主題。
- `python3 scripts/get_user.py <username>` 取得使用者資料。`python3 scripts/get_user_posts.py <username> --limit 20` 列出該使用者的貼文。
- `python3 scripts/get_collections.py --featured --limit 20` 列出合集。`python3 scripts/get_collection.py <slug-or-id>` 取得一個合集。

使用 `--help` 查看指令碼的目前參數。記錄查詢日期與篩選條件、保留來源連結，並避免把觀察到的投票數或其他指標說成客戶自己發布的結果。
