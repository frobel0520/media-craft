# HEIC 本機解碼評估（2026-11-26）

以 `52481fa` 檢查圖片工作台。Rust 格式辨識目前支援 AVIF 的 `ftyp`，未識別 HEIC；選檔清單也未列 HEIC。圖片 Worker 依賴 `createImageBitmap` 解碼再交給 `OffscreenCanvas`。HEIC 若要跨瀏覽器支援，須評估自帶解碼路徑。

用 Pillow 13.0.0／pillow-heif 1.3.0 從零產生 64 × 48 的 RGB 色塊，輸出 PNG 和主要品牌 `heic` 的 HEIC（quality 85），兩份都由產生端讀回尺寸。以 Linux headless Chromium 154.0.8037.57 透過同源測試 Worker，套用 `web/public/_headers` 的 CSP，逐份執行 `fetch → Blob → createImageBitmap → OffscreenCanvas`。

| 合成輸入 | 大小 | 結果 |
| --- | ---: | --- |
| PNG | 135 bytes | 64 × 48，輸出 475 bytes PNG |
| HEIC | 839 bytes | `createImageBitmap` 回 `InvalidStateError` |

兩份輸入均無站外請求，console 錯誤數為 0（HEIC 解碼錯誤由 Worker 捕捉並回傳）。HEIC SHA-256 為 `785bea7ad2192b063337325b0ab1dfe2b94dd973602b01f62c78f47a325ae74f`。真機 Safari、Android Chrome 與其他 HEIF 變體尚未測。

## 後續導入判準

- Registry 顯示候選 `heic-to@1.6.7` 宣告 LGPL-3.0，具有 `heic-to/csp` 入口，完整解包約 26.2 MB。此數值涵蓋多種入口及檔案，實際選用的壓縮下載量需由候選 bundle 另外量測。仍需核對轉散布義務、底層解碼元件授權及適用的 HEVC 授權條件。[npm 套件資料](https://www.npmjs.com/package/heic-to/v/1.6.7)
- 首選驗證同源 Worker 中的按需載入，沿用既有 CSP，確認只在 HEIC 輸入時載入解碼 chunk。候選須用合成 fixture 核對方向、色彩、多影像政策、失敗提示與低記憶體裝置行為，並量測一般圖片首載不增加解碼資產、HEIC 冷載大小和耗時。
- 本輪完成原生路徑可行性查證；解碼器選型、依賴、正式支援與真機驗收留在 Phase 2。
