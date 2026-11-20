# media-craft Progress

更新：2026-11-20（Asia/Taipei）。專案級別：**公開級**（純靜態 Cloudflare Pages + Rust WebAssembly，零月費）。

## 現況

- **線上正式站**：https://media-craft.pages.dev（Cloudflare Pages，首次部署 run [`44703693924`](https://github.com/frobel0520/media-craft/actions/runs/44703693924) 成功，`main` 分支已開啟禁止 force-push／刪除保護）。
- **Phase 1（MVP — 圖片工作台）已完成**：
  - `crates/media-core`（`#![forbid(unsafe_code)]`，零外部相依）：JPEG/PNG/WebP/GIF/BMP 格式與尺寸偵測、TIFF/EXIF/GPS 隱私掃描、JPEG/PNG/WebP 無損二進位去 EXIF、IEEE 802.3 CRC-32 ZIP 打包（`cargo test` 7/7、`cargo clippy -- -D warnings` 0 警告）。
  - `crates/media-wasm`：編譯為 47 KB `wasm32-unknown-unknown` 執行檔，透過專屬 Web Worker 執行。
  - `web/`：Vite + React + TypeScript，支援壓縮轉檔（WebP/JPEG/PNG + 品質滑桿 + 最大寬度縮放）、純無損去 EXIF、Before/After 對比拉桿、批次下載 ZIP、深淺色雙主題、嚴格 HTTP `_headers`（`connect-src 'self'`、`frame-ancestors 'none'`）。
  - 本機 Headless Chrome 實測通過（LCP `p50=68ms / p95=76ms`、CLS `0.0004`、TBT `0ms`、CSP 違規 `0`、`375×812` & `1280×800` 深淺色 0 溢位、0 小於 `36px` 觸控目標、E2E 互動全過），詳見 [`docs/evidence/perf-20261120.md`](docs/evidence/perf-20261120.md)。
  - **正式網址（`https://media-craft.pages.dev`）效能與安全標頭驗收通過**：Cloudflare `_headers` 全數生效（`connect-src 'self'`、`frame-ancestors 'none'`、`X-Frame-Options: DENY`、WASM `immutable` 快取）、線上 7 次清快取 LCP `p50=336ms / p95=460ms`、CLS `0.0004`、TBT `p50=0ms / max=2ms`、WASM `7/7` 就緒、第三方請求與 CSP 違規皆為 `0`，詳見 [`docs/evidence/live-audit-20261120.md`](docs/evidence/live-audit-20261120.md)。

  - **Harbor 控管接入**：已加入 Cloudflare Pages 伺服器端 [`functions/_middleware.js`](functions/_middleware.js)（對接 `https://harbor-1wk.pages.dev`，slug `media-craft`，fail-open、800ms 逾時、不影響瀏覽器端 `connect-src 'self'` CSP），並同步更新 CI 部署流程以打包 Pages Functions。

## 待辦

- [ ] 【高】Harbor 後台完成納管收尾：於 `https://harbor-1wk.pages.dev` 將 `frobel0520/media-craft` 納入受管專案（暫不設定 `HARBOR_PREVIEW_SECRET`）。
- [x] 【中】正式網址（`https://media-craft.pages.dev`）實測效能與安全標頭核對（已完成，見 [`docs/evidence/live-audit-20261120.md`](docs/evidence/live-audit-20261120.md)）。
- [ ] 【中】圖片工作台進階功能（圖片裁切／旋轉、自訂檔名規則、批次壓縮進度條與取消鈕、更多格式如 AVIF 支援評估）。
- [ ] 【低】擴充 Phase 2 多媒體模組（依優先度挑選：SVG 清理最佳化、Favicon／PWA 圖示組產生器、音訊輕量剪輯／WAV 轉檔、GIF 最佳化）。
- [ ] 【低】前端補齊自動化單元／元件測試（Vitest）與瀏覽器回歸腳本納入 CI。

## 限制

- 尚未完成實體手機（iOS Safari / Android Chrome）大圖批次處理與相簿匯入實測。
- `crates/media-core` 維持零外部相依；若未來模組（如音訊編碼或 AVIF）需引入外部 crate，須先於 `docs/03-system-design.md` 記錄體積、授權與安全評估。
