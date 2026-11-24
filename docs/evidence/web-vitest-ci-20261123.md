# Vitest 與 CI 回歸驗證

2026-11-23，Harbor 任務 `0dece8b7`。原 CI build job 加入 `npm test`，沿用現有 Node 22、鎖檔、Rust／WASM 建置和 Pages job 依賴。

- 本機 Node 24.22.1 與 Node 22.23.5 均通過 5 項 Vitest。測試涵蓋圖片輸入 MIME／副檔名判斷、比較拉桿、下載回呼與 Escape 關閉。
- 注入單一暫時失敗斷言後，正常 CI 測試指令回傳結束碼 1。暫時檔已移除。GitHub 上的新步驟結果待 PR CI。
- `npm ci`、`npm run build`、無 high／critical 的 `npm audit`、Clippy 及瀏覽器 WASM 建置通過。Rust 再用 Node WASI 執行 18 項既有測試，Windows native 仍受 SDK 缺件限制。
- Dev 測試依賴未進產品 bundle。相較同基準的本機建置，主 JavaScript gzip 顯示同為 82.00 kB。沒有產品互動變更，這些指標為本機檢查。
- 若須回滾，可撤回此 PR，恢復原 CI build job 與開發依賴。
