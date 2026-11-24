# media-craft Progress

更新：2026-11-23（Asia/Taipei）。專案級別：**公開級**（100% 純靜態 Cloudflare Pages + Rust WebAssembly，零後端、零資料庫、零月費）。

## 現況

- **線上正式站**：https://media-craft.pages.dev（100% 純靜態 Cloudflare Pages，無 Pages Functions middleware，享免費無上限靜態請求與頻寬；由 Harbor 監控在線健康燈號、CI 狀態與開發進度）。
- **核心引擎（Rust + WebAssembly）**：
  - `crates/media-core`（`#![forbid(unsafe_code)]`，零外部相依，`cargo test` **11/11**、`cargo clippy -- -D warnings` **0 警告**）：
    - 8 種圖片格式偵測與標頭尺寸解析（JPEG / PNG / WebP / AVIF / GIF / BMP / SVG / ICO）。
    - TIFF/EXIF/GPS 隱私掃描與 JPEG/PNG/WebP 無損二進位去 EXIF。
    - 純 Rust 編碼器：24-bit Windows BMP、PNG-in-ICO（`≤ 256px`）、16-bit PCM WAV、IEEE 802.3 CRC-32 ZIP。
    - SVG 安全清理與最佳化（`svg.rs`，分支 `feature/20261123-svg-cleaner`，尚未合併）。
  - `crates/media-wasm`：極輕量 `wasm32-unknown-unknown` 執行檔，透過專屬 Web Worker 執行。
- **Web 工作台與視覺系統（`web/`）**：
  - **GCP × iOS 視覺設計系統**（見 [`docs/04-ui-design-system.md`](docs/04-ui-design-system.md)）：`系統 / 淺色 / 深色` 三段式主題切換（預設跟隨系統）、多彩科技光圈（Prismatic Tech Aperture）Brand Icon 與全套書籤／主畫面縮圖（`favicon.svg`、`apple-touch-icon.png`、`icon-512.png`、`site.webmanifest`）。
  - **Canva × Photoshop 工作台骨架**：單層 `56px` 毛玻璃上方欄＋可收合左側導覽欄（桌面展開 `232px` / 窄軌 `72px`、行動版滑出抽屜）。
  - **圖片工作台**：支援 **8 種輸入**（JPEG/PNG/WebP/AVIF/GIF/BMP/SVG/ICO）與 **6 種輸出**（WebP/JPEG/PNG/AVIF/BMP/ICO）、品質滑桿、最大寬度縮放、純無損去 EXIF、Before/After 拉桿對比、批次 ZIP 下載。
  - **影片轉檔工作台（方案 A）**：支援 **4 種輸入**（MP4/WebM/MOV/OGV），提供 WebM/MP4 本地轉檔（解析度上限、位元率、進度條與中止鈕）、Rust WASM 抽離無損 WAV 音訊（含試聽下載）與時間軸高畫質封面擷取（WebP/PNG/JPEG）。
- **效能與安全驗收通過**：
  - 本機 Headless Chrome 實測通過（見 [`docs/evidence/perf-20261120.md`](docs/evidence/perf-20261120.md)）。
  - 正式網址（`https://media-craft.pages.dev`）HTTP 安全標頭（`_headers` 全數生效）與 7 次清快取線上 Web Vitals 驗收通過（LCP `p50=336ms / p95=460ms`、CLS `0.0004`、TBT `p50=0ms / max=2ms`、WASM `7/7` 就緒、第三方請求與 CSP 違規皆為 `0`，見 [`docs/evidence/live-audit-20261120.md`](docs/evidence/live-audit-20261120.md)）。

## 待辦

- [x] 【中】正式網址（`https://media-craft.pages.dev`）實測效能與安全標頭核對（已完成，見 [`docs/evidence/live-audit-20261120.md`](docs/evidence/live-audit-20261120.md)）。
- [x] 【中】UI 視覺定調與工作台骨架（GCP × iOS 設計系統、系統預設主題、多彩科技光圈 Icon、Canva × Photoshop 單層頂欄與可收合側邊欄）。
- [x] 【中】圖片轉檔格式擴充（8 輸入 × 6 輸出）與影片轉檔工作台方案 A（MP4/WebM/MOV/OGV → WebM/MP4/WAV/封面圖）。
- [ ] 【中】圖片工作台進階編輯（裁切／90° 旋轉與翻轉、自訂輸出檔名規則、批次進度條與取消鈕；評估 HEIC 按需懶載入）。
- [ ] 【低】擴充其餘 Phase 2 多媒體模組（Favicon／PWA 圖示組產生器、GIF 最佳化、音訊輕量剪輯）。
  - Favicon／PWA 圖示組在功能分支完成本機雙寬驗收，待審。見 [圖示驗收](docs/evidence/favicon-pwa-20261123.md)。
- [ ] 【低】SVG 清理工作台（`feature/20261123-svg-cleaner`）：Rust `svg.rs` 8 項單元測試與瀏覽器惡意樣本驗證通過（輸出可重新解析、保留 viewBox、預覽 0 外部請求、0 CSP 違規）；待 PR 合併部署後在正式站實測。WASM 由約 74 KB 增為約 94 KB。
- [ ] 【低】站內 0 成本 SEO 與 AI 搜尋優化（`robots.txt`、`sitemap.xml`、`/llms.txt`、JSON-LD `WebApplication`、OG 分享圖）。
- [ ] 【低】前端補齊自動化單元／元件測試（Vitest）並納入 CI。

## 限制

- 尚未完成實體手機（iOS Safari / Android Chrome）大圖／影片批次處理實測。
- 影片轉檔方案 A 仰賴瀏覽器原生 `MediaRecorder` 與 `AudioContext` 解碼，尚不支援 MKV / AVI 等冷門容器。
- `crates/media-core` 維持零外部相依；若未來模組（如 HEIC 或 FFmpeg.wasm）需引入外部相依，須先於 `docs/03-system-design.md` 記錄體積、授權與安全評估。
