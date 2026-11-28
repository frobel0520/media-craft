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

## 複核（2026-11-28）

### 重現

- 以 `main` `c79e795` 的 `web/public/_headers` CSP 作為回應標頭，在同源測試 Worker 重跑 `fetch → Blob → createImageBitmap → OffscreenCanvas`。環境為 Linux headless Chromium 157.0.8103.78，fixture 以 Pillow 13.0.0／pillow-heif 1.9.0 從零產生 64 × 48 色塊（HEIC quality 85、`ftyp` 品牌 `heic`）。
- 結果與上表一致：PNG（157 bytes）解出 64 × 48；HEIC（649 bytes）回 `InvalidStateError`。站外請求 0、console 錯誤 0。
- 不同 pillow-heif 版本產生的 HEIC 位元組不同（本次 SHA-256 前 16 碼 `0c9511e680e25499`，與上方原始紀錄不同），所以只比對解碼結果，不比對雜湊。日後要固定雜湊，需把 fixture 檔本身提交進 repo。

### 候選解碼器（只下載 npm 套件做靜態檢查，未加入專案依賴）

| 候選 | 授權 | 主要檔案大小（原始／gzip） | 現行 CSP 相容性 | 判斷 |
| --- | --- | --- | --- | --- |
| `heic-to@1.6.7` 的 `./csp` 入口 | LGPL-3.0 | `dist/csp/heic-to.js` 3.22 MB／0.79 MB，純 JS、不用 WebAssembly | 不用 `eval`／`new Function`，但以 `createObjectURL` 建立 blob Worker，依賴現行的 `worker-src blob:` | 可用，但體積最大；預設入口含 `new Function`，不能用 |
| `libheif-js@1.23.5` 的 `libheif-wasm/` | LGPL-3.0（libheif） | `libheif.wasm` 1.46 MB／0.48 MB＋`libheif.js` 0.09 MB／0.03 MB | 需要 `'wasm-unsafe-eval'`（現行已允許），可在既有同源 Worker 內載入，不需要 blob Worker | 體積最小，與現有「Rust/WASM＋Worker」架構最接近，建議作為首選驗證對象 |
| `heic2any@0.0.4` | 套件標 MIT，但內含 libheif（LGPL） | 1.36 MB／0.34 MB | 含 `new Function`，需要 `'unsafe-eval'` | 排除：會放寬 CSP，且授權標示與內含元件不一致 |
| `heic-decode@2.1.0` | ISC（包裝 `libheif-js`） | 本身 6.6 KB，實際大小同 `libheif-js` | 同 `libheif-js` | 只是包裝層，直接用 `libheif-js` 即可 |

三個 bundle 都沒有寫死的站外網址。

### 是否達到實作前提

| 前提 | 狀態 |
| --- | --- |
| 確認原生路徑不可行（Chromium） | 已確認 |
| 候選解碼器與 CSP 相容性 | 已比較，建議先驗證 `libheif-js` 的 WASM 版 |
| LGPL-3.0 轉散布義務（提供原始碼、允許替換函式庫） | **未決**，需 Owner 決定可接受的做法 |
| HEVC 專利授權風險 | **未決**，需 Owner 評估；本次不提供法律意見 |
| 按需載入：一般圖片首載不增加解碼資產、HEIC 冷載大小與耗時 | 未量測，需候選原型 |
| 低記憶體裝置、大圖與多影像 HEIF（例如連拍、深度圖）的行為與錯誤提示 | 未驗證，需候選原型與真機 |
| Safari 是否可直接走原生 `createImageBitmap` | 未測（無真機） |

結論：**尚未達到實作前提**。技術上有不放寬 CSP 的路徑，但授權與專利兩項需要 Owner 先決定，之後才值得做原型與效能量測。

**Owner 決定（2026-11-28）**：HEIC 先不做，不導入解碼器，也不開原型單；`progress.md` 將此項移到「暫緩」。
