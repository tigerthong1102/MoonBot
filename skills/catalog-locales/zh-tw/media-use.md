原始 HyperFrames 指南與工具依固定版本保留；請參閱 `UPSTREAM.md`、`SOURCE.md` 及以下相關文件。上游說明與使用者要求、隱私、預算或授權衝突時，以使用者要求為準。未經授權，不傳送使用信標或遙測，不註冊或登入服務，不上傳使用者素材，不下載模型、不修改權限或產生費用。使用 `HYPERFRAMES_NO_TELEMETRY=1` 執行已安裝的 HyperFrames CLI；不要使用會自動安裝套件的 `npx`。

區分已有影片、動態圖形、AI 產生的動態鏡頭與虛擬主持人。對靜態圖片平移或縮放不屬於 AI 產生的角色動作。合適時優先使用使用者提供的素材，逐項核實第三方素材的商業使用權、授權、來源和署名要求，將獲准素材與署名放入專案。不要將虛構或圖庫素材描述為真實客戶或地點。

製作電影感動態鏡頭時，檢查裝置上實際可用且獲授權的工具與帳號。HyperFrames 負責算繪和合成；聊天訂閱連線本身不代表可使用 HeyGen、Grok Imagine 或影片產生 API。有已獲授權的服務或相容本機產生工具時使用；否則明確說明缺少什麼。不要將靜態投影片悄悄替代使用者要求的電影鏡頭，應標為草稿。使用 `hyperframes media-use generate --type video` 前先查看 `--help` 並執行 `--plan`；說明服務、上傳內容、預估費用及超額可能，取得使用者授權後才可執行收費或上傳要求。計畫或缺少估價不代表有嚴格費用上限。要求結果不確定時，不要自動切換至其他服務或收費帳號。

19 個 Pixabay 原始音效未被打包，因為尚未確認原檔的再散布權利。資料庫改為提供相同提示名稱的 19 個 CC0 合成替代音效；它們不是原始錄音。來源請見 `SOURCE.md` 和 `audio/assets/sfx/CREDITS.md`；也可使用使用者獲准的音訊。

- `references/resolve.md`：搜尋、匯入與重用專案素材。
- `references/operations.md`：影片準備、生成與本機工具要求。
- `references/heygen.md` 與 `references/setup-providers.md`：服務功能、條件和價格範例；應核實現行條款。
- `references/audio.md` 與 `references/mixing.md`：語音、音樂、音效和混音。
- `references/media-treatments.md` 與 `references/grading.md`：色彩和視覺處理。
- `references/local.md`：本機工具與模型要求。

實際觀看動態結果，檢查鏡頭連續性、音訊和字幕；執行可用的 HyperFrames 檢查並說明未檢查或未試聽的部分。算繪成功本身不代表創意品質達標。
