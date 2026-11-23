# SVG 清理工作台正式站驗證

日期：2026-11-23（Asia/Taipei）。受測網址：https://media-craft.pages.dev/ 。PR #13 已合併至 main `1298b441657ec3f1f9d397f8aa2a8ca3a1406287`；正式站未提供版本端點，本次以實際介面及功能確認，不宣稱獨立讀回部署 SHA。

## 環境與方法

本機 macOS Apple Silicon、Chromium 153.0.8010.12、Playwright、全新隔離瀏覽器 context，1280×800 與 375×812。載入前註冊 `securitypolicyviolation`、request、console error 與 pageerror 監聽；對非本站 HTTP(S) 請求計數。使用實際選檔及下載按鈕，讀取下載檔後以 DOMParser 重新解析，確認元素、屬性與 viewBox。

合成輸入為 285-byte UTF-8 SVG：根元素 `onload`、`script`、矩形的 `onclick`，以及 `image href="https://example.com/x.png"`。腳本只設定合成測試旗標，不含私人資料。原始檔由本機建立並交給檔案選擇器，處理全程在瀏覽器內進行。

## 結果

| 檢查 | 實測 |
|---|---|
| 正式站與導覽 | HTTP 200；側邊欄有「SVG 清理壓縮」，可開啟工作台 |
| 清理與下載 | 實際下載 `malicious-clean.svg`，116 bytes |
| 輸出合法性 | DOMParser 無 parsererror，viewBox 保留 `0 0 100 100` |
| 主動內容 | script 元素 0、on* 事件屬性 0 |
| 外部引用 | 外部 image 已移除，無外部 URL 屬性；標準 SVG xmlns 保留 |
| 預覽與網路 | 清理後圖形可見，整輪非本站 HTTP(S) 請求 0 |
| CSP 與錯誤 | securitypolicyviolation 0、console error 0、pageerror 0 |
| 桌面版面 | viewport 1280px，document scrollWidth 1280px |
| 手機寬度版面 | viewport 375px，document scrollWidth 375px；檢視完整頁面截圖，無橫向溢位 |
| 小檔互動耗時 | 暖頁面、WASM 已就緒，選檔開始至下載按鈕就緒 92ms，n=1 |

## 限制

本次為單一小型合成 SVG 的正式功能回歸，沒有宣稱大檔／批次、p50／p95 或真機效能達標；不取代既有首頁效能報告。375px 為 Chromium viewport 測試，不取代 iOS Safari／Android Chrome 實體手機測試。這次只改文件，不改程式或部署設定。
